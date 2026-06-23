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

import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import os from 'node:os';
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

/**
 * Resolve the install command for the current OS from a per-OS install object.
 * Falls back to the linux command, then any string value present, if the exact
 * `process.platform` key is missing. Tolerates a legacy plain-string `install`.
 * Returns `{ command, fallback }` where `fallback` may be undefined.
 */
function resolveInstall(install) {
  if (typeof install === 'string') return { command: install, fallback: undefined };
  if (!install || typeof install !== 'object') return { command: undefined, fallback: undefined };
  const command =
    install[process.platform] ||
    install.linux ||
    Object.values(install).find((v) => typeof v === 'string');
  return { command, fallback: install.fallback };
}

// --- Build the in-memory registry + alias index.
// Each agent gets a resolved per-OS `install` (string) plus optional
// `installFallback`, while keeping the original per-OS object available.
const AGENTS = registry.agents.map((agent) => {
  const { command, fallback } = resolveInstall(agent.install);
  return { ...agent, install: command, installFallback: fallback };
});
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

/**
 * Common locations a freshly-installed coding-agent binary lands in but which
 * are often NOT on the current process's PATH (e.g. aider/claude install into
 * `~/.local/bin`; npm globals into the npm prefix bin). Best-effort, deduped.
 */
function candidateBinDirs() {
  const home = os.homedir();
  const dirs = [];

  if (process.platform === 'win32') {
    if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, 'npm'));
    if (process.env.USERPROFILE) {
      dirs.push(path.join(process.env.USERPROFILE, '.local', 'bin'));
    }
    if (home) dirs.push(path.join(home, '.local', 'bin'));
  } else {
    dirs.push(path.join(home, '.local', 'bin'));
    dirs.push('/opt/homebrew/bin');
    dirs.push('/usr/local/bin');
  }

  // npm global bin (best-effort — npm may be absent).
  try {
    const prefix = execFileSync('npm', ['prefix', '-g'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (prefix) {
      dirs.push(process.platform === 'win32' ? prefix : path.join(prefix, 'bin'));
    }
  } catch {
    // npm not available — skip.
  }

  // Dedupe, drop empties.
  return [...new Set(dirs.filter(Boolean))];
}

/** Executable extensions to probe (Windows uses PATHEXT). */
function binExts() {
  return process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];
}

/**
 * Resolve `bin` against PATH plus the candidate bin dirs. Returns the directory
 * containing the executable if found, otherwise null. Searching the candidate
 * dirs lets us find binaries installed this session that aren't on PATH yet.
 */
async function resolveBinPath(bin) {
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const dirs = [...pathDirs, ...candidateBinDirs()];
  const exts = binExts();
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, bin + ext);
      try {
        await fs.access(candidate, fsConstants.F_OK);
        return dir;
      } catch {
        // keep scanning
      }
    }
  }
  return null;
}

/**
 * Build a PATH string with `extraDirs` prepended (deduped against PATH).
 * Returns the augmented PATH value for use in a child env.
 */
function augmentPath(extraDirs) {
  const current = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const seen = new Set(current);
  const prepend = extraDirs.filter((d) => d && !seen.has(d));
  return [...prepend, ...current].join(path.delimiter);
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

/** Print the resolved install command (plus any fallback) for an agent. */
function printInstallCommands(agent) {
  console.error(`    ${c.cyan}${agent.install}${c.reset}`);
  if (agent.installFallback) {
    console.error(`  ${c.dim}or, as a fallback:${c.reset}`);
    console.error(`    ${c.cyan}${agent.installFallback}${c.reset}`);
  }
  console.error('');
}

/**
 * Ensure the agent's binary is resolvable. If missing:
 *   - interactive TTY: offer to run the per-OS installer (with fallback), then
 *     re-resolve against PATH + candidate dirs.
 *   - non-interactive: print the resolved install command (+ fallback) and
 *     exit 127 without running anything.
 *
 * Returns the directory containing the bin (to prepend to the child's PATH) on
 * success. May exit the process on failure or when manual action is needed.
 */
async function ensureInstalled(agent) {
  const existing = await resolveBinPath(agent.bin);
  if (existing) return existing;

  const interactive = process.stdin.isTTY && process.stdout.isTTY;

  if (!interactive) {
    console.error(
      `\n  ${c.red}${agent.name} isn't installed${c.reset} ${c.dim}(\`${agent.bin}\` not found on PATH).${c.reset}`,
    );
    console.error(`  Install it with:\n`);
    printInstallCommands(agent);
    process.exit(127);
  }

  console.error(`\n  ${c.bold}${agent.name}${c.reset} isn't installed.`);
  const ok = await askYesNo(`  Install it now? ${c.dim}[Y/n]${c.reset} `);
  if (!ok) {
    console.error(`\n  No problem. Install it yourself with:\n`);
    printInstallCommands(agent);
    process.exit(127);
  }

  console.error(`\n  ${c.dim}Running ${c.reset}${c.cyan}${agent.install}${c.reset}\n`);
  let installed = await runInstaller(agent.install);

  // Primary failed and a fallback exists — try it once.
  if (!installed && agent.installFallback) {
    console.error(
      `\n  ${c.dim}That didn't work. Trying the fallback: ${c.reset}${c.cyan}${agent.installFallback}${c.reset}\n`,
    );
    installed = await runInstaller(agent.installFallback);
  }

  if (!installed) {
    console.error(`\n  ${c.red}Install failed.${c.reset} Try it manually:\n`);
    printInstallCommands(agent);
    process.exit(127);
  }

  // PATH hardening: the freshly-installed binary is often not on the current
  // process's PATH. Re-resolve against PATH + candidate dirs.
  const found = await resolveBinPath(agent.bin);
  if (found) return found;

  console.error(
    `\n  ${c.dim}Installed ${agent.name}, but it isn't on this shell's PATH yet. ` +
      `Open a new terminal (or add a bin dir to PATH) and re-run \`subconscious ${agent.id}\`.${c.reset}\n`,
  );
  process.exit(0);
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

  const binDir = await ensureInstalled(agent);

  const ctx = buildContext(auth.key, model);
  const launch = substituteString(agent.launch, ctx);
  const [bin, ...launchArgs] = launch.split(' ').filter(Boolean);
  const envMap = substitute(agent.env, ctx);

  // Prepend the resolved bin dir + candidate dirs to the child's PATH so the
  // agent (and any subprocess it spawns) resolves correctly this session, even
  // if it was installed into a dir not yet on the parent shell's PATH.
  const extraDirs = [binDir, ...candidateBinDirs()].filter(Boolean);
  const env = { ...process.env, ...envMap, PATH: augmentPath(extraDirs) };
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
      printInstallCommands(agent);
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
