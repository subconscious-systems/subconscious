/**
 * Coding-agent launcher.
 *
 * `subconscious <agent>` resolves your saved API key, injects the env vars that
 * point the agent at your hosted Subconscious model, and exec's the real CLI —
 * nothing is written to the agent's own config.
 *
 * There is NO hardcoded agent data here: everything is read from
 * `registry.generated.json` (shipped under `bin/`), which is generated from the
 * single source of truth `agents/registry.json`. Run `pnpm generate` to update.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { c } from './colors.js';
import { getApiKey } from './auth.js';

// --- Registry (single source of truth, generated copy shipped in the package).
const registry = JSON.parse(
  readFileSync(new URL('./registry.generated.json', import.meta.url), 'utf-8'),
);
const DEFAULTS = registry.defaults;

// --- Token substitution — same rules as scripts/lib/registry.js.
// Replaces {apiKey}, {model}, {baseUrl}, {baseUrlV1}. NEVER touches {env:...}.
const TOKENS = ['apiKey', 'model', 'baseUrl', 'baseUrlV1'];

function substituteString(str, ctx) {
  let out = str;
  for (const token of TOKENS) {
    if (ctx[token] === undefined) continue;
    out = out.split(`{${token}}`).join(ctx[token]);
  }
  return out;
}

function substitute(value, ctx) {
  if (typeof value === 'string') return substituteString(value, ctx);
  if (Array.isArray(value)) return value.map((v) => substitute(v, ctx));
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === '$json') {
      return JSON.stringify(substitute(value.$json, ctx));
    }
    const out = {};
    for (const key of keys) out[substituteString(key, ctx)] = substitute(value[key], ctx);
    return out;
  }
  return value;
}

// --- Build the in-memory registry + alias index.
const AGENTS = registry.agents;
const BY_ALIAS = new Map();
for (const agent of AGENTS) {
  BY_ALIAS.set(agent.id, agent);
  for (const alias of agent.aliases || []) BY_ALIAS.set(alias, agent);
}

export function resolveAgent(name) {
  return BY_ALIAS.get(name) ?? null;
}

export function agentList() {
  return AGENTS.map((a) => ({ name: a.name, alias: a.id }));
}

/**
 * Resolve the substitution context for a launch:
 *   model     — --model flag → SUBCONSCIOUS_MODEL → registry default
 *   baseUrl   — SUBCONSCIOUS_BASE_URL → registry default
 *   baseUrlV1 — `${baseUrl}/v1` (so an override flows to both)
 */
function buildContext(apiKey, model) {
  const baseUrl = process.env.SUBCONSCIOUS_BASE_URL?.trim() || DEFAULTS.baseUrl;
  return { apiKey, model, baseUrl, baseUrlV1: `${baseUrl}/v1` };
}

/**
 * Pull a `--model <value>` / `--model=<value>` flag out of the passthrough
 * args (so it sets the Subconscious model rather than reaching the agent).
 * Falls back to SUBCONSCIOUS_MODEL, then the registry default.
 */
function extractModel(argv) {
  let model = process.env.SUBCONSCIOUS_MODEL?.trim() || DEFAULTS.model;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model') {
      const v = argv[i + 1];
      if (v && !v.startsWith('-')) {
        model = v;
        i++;
      }
      continue;
    }
    if (a.startsWith('--model=')) {
      model = a.slice('--model='.length);
      continue;
    }
    rest.push(a);
  }
  return { model, rest };
}

/** Is `bin` an executable resolvable on PATH? */
async function isOnPath(bin) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
      : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, bin + ext);
      try {
        await fs.access(candidate, fsConstants.F_OK);
        return true;
      } catch {
        // keep scanning
      }
    }
  }
  return false;
}

/** Ask a yes/no question on the TTY. Empty answer counts as yes. */
function askYesNo(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === '' || a === 'y' || a === 'yes');
    });
  });
}

/** Run the agent's install command (may contain `&&`, so shell:true). */
function runInstaller(install) {
  return new Promise((resolve) => {
    const child = spawn(install, { shell: true, stdio: 'inherit' });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

/**
 * Ensure the agent's binary is on PATH. If missing:
 *   - interactive TTY: offer to run the installer, then re-check PATH
 *   - non-interactive: print the install command and exit 127
 * Returns true if the bin is available (proceed to launch).
 */
async function ensureInstalled(agent) {
  if (await isOnPath(agent.bin)) return true;

  const interactive = process.stdin.isTTY && process.stdout.isTTY;

  if (!interactive) {
    console.error(
      `\n  ${c.red}${agent.name} isn't installed${c.reset} ${c.dim}(\`${agent.bin}\` not found on PATH).${c.reset}`,
    );
    console.error(`  Install it with:\n`);
    console.error(`    ${c.cyan}${agent.install}${c.reset}\n`);
    process.exit(127);
  }

  console.error(`\n  ${c.bold}${agent.name}${c.reset} isn't installed.`);
  const ok = await askYesNo(`  Install it now? ${c.dim}[Y/n]${c.reset} `);
  if (!ok) {
    console.error(`\n  No problem. Install it yourself with:\n`);
    console.error(`    ${c.cyan}${agent.install}${c.reset}\n`);
    process.exit(127);
  }

  console.error(`\n  ${c.dim}Running ${c.reset}${c.cyan}${agent.install}${c.reset}\n`);
  const installed = await runInstaller(agent.install);

  if (installed && (await isOnPath(agent.bin))) return true;

  if (installed) {
    console.error(
      `\n  ${c.red}Install finished but \`${agent.bin}\` still isn't on your PATH.${c.reset}`,
    );
    console.error(`  ${c.dim}You may need to restart your shell or adjust PATH.${c.reset}\n`);
  } else {
    console.error(`\n  ${c.red}Install failed.${c.reset} Try it manually:\n`);
    console.error(`    ${c.cyan}${agent.install}${c.reset}\n`);
  }
  process.exit(127);
}

/**
 * Launch a coding agent against Subconscious. `argv` is everything after the
 * agent name; unknown flags pass straight through to the underlying CLI.
 */
export async function runAgent(agent, argv) {
  const { model, rest } = extractModel(argv);

  const auth = await getApiKey();
  if (!auth) {
    console.error(`\n  ${c.red}Not logged in.${c.reset}`);
    console.error(
      `  Run ${c.cyan}subconscious login${c.reset} (or set ${c.dim}SUBCONSCIOUS_API_KEY${c.reset}) first.\n`,
    );
    process.exit(1);
  }

  await ensureInstalled(agent);

  const ctx = buildContext(auth.key, model);
  const launch = substituteString(agent.launch, ctx);
  const [bin, ...launchArgs] = launch.split(' ').filter(Boolean);
  const envMap = substitute(agent.env, ctx);

  const env = { ...process.env, ...envMap };
  const args = [...launchArgs, ...rest];

  console.log(
    `  ${c.dim}Launching ${c.reset}${c.bold}${agent.name}${c.reset} ${c.dim}on Subconscious ${c.reset}${c.dim}(${model})${c.reset}\n`,
  );

  const child = spawn(bin, args, { stdio: 'inherit', env });

  child.on('error', (err) => {
    if (err.code === 'ENOENT') {
      console.error(
        `\n  ${c.red}Could not launch \`${bin}\`.${c.reset} Install it with:\n`,
      );
      console.error(`    ${c.cyan}${agent.install}${c.reset}\n`);
      process.exit(127);
    }
    console.error(`\n  ${c.red}${err.message}${c.reset}\n`);
    process.exit(1);
  });

  // Mirror the child's exit status so callers/scripts see the real result.
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}
