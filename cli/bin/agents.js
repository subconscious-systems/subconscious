/**
 * Coding-agent launcher.
 *
 * `subconscious <agent>` resolves your saved API key, injects the env vars that
 * point the agent at your hosted Subconscious model, and exec's the real CLI —
 * nothing is written to the agent's own config. Each entry here mirrors the
 * matching example under `examples/<agent>` (its `subconscious.agent` block),
 * which stays the source of truth.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { c } from './colors.js';
import { getApiKey } from './auth.js';

// Subconscious endpoints. The Anthropic-style base has no `/v1`; the
// OpenAI-compatible base does.
const API_BASE = 'https://api.subconscious.dev';
const API_BASE_V1 = 'https://api.subconscious.dev/v1';
const DEFAULT_MODEL = 'subconscious/tim-qwen3.6-27b';

/**
 * Agent registry. Each entry:
 *   name    — display name
 *   aliases — accepted subcommands (first is canonical)
 *   install — how to install the underlying CLI (shown when it's missing)
 *   bin     — executable we exec and probe on PATH
 *   env     — (key, model) => extra env vars merged over process.env
 *   args    — (model) => array of args passed to `bin`
 */
const AGENTS = [
  {
    name: 'Claude Code',
    aliases: ['claude-code', 'claude', 'claudecode'],
    install: 'npm i -g @anthropic-ai/claude-code',
    bin: 'claude',
    env: (key, model) => ({
      ANTHROPIC_BASE_URL: API_BASE,
      ANTHROPIC_AUTH_TOKEN: key,
      ANTHROPIC_MODEL: model,
      ANTHROPIC_SMALL_FAST_MODEL: model,
      // Let Subconscious manage context instead of client-side compaction.
      DISABLE_AUTO_COMPACT: 'true',
    }),
    args: () => [],
  },
  {
    name: 'OpenCode',
    aliases: ['open-code', 'opencode'],
    install: 'npm i -g opencode-ai',
    bin: 'opencode',
    env: (key, model) => ({
      SUBCONSCIOUS_API_KEY: key,
      // OpenCode deep-merges this at startup; nothing touches ~/.config/opencode.
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        provider: {
          subconscious: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Subconscious',
            options: { baseURL: API_BASE_V1, apiKey: '{env:SUBCONSCIOUS_API_KEY}' },
            models: { [model]: { name: 'Subconscious', tools: true } },
          },
        },
        model: `subconscious/${model}`,
      }),
    }),
    args: () => [],
  },
  {
    name: 'Aider',
    aliases: ['aider'],
    install: 'python -m pip install aider-install && aider-install',
    bin: 'aider',
    env: (key) => ({
      OPENAI_API_BASE: API_BASE_V1,
      OPENAI_API_KEY: key,
    }),
    args: (model) => ['--model', `openai/${model}`],
  },
  {
    name: 'Codex CLI',
    aliases: ['codex'],
    install: 'npm i -g @openai/codex',
    bin: 'codex',
    env: (key) => ({ SUBCONSCIOUS_API_KEY: key }),
    // `-c model=…` (not `--model`, which is codex's Ollama shortcut).
    args: (model) => [
      '-c', 'model_providers.subconscious.name=Subconscious',
      '-c', `model_providers.subconscious.base_url=${API_BASE_V1}`,
      '-c', 'model_providers.subconscious.env_key=SUBCONSCIOUS_API_KEY',
      '-c', 'model_provider=subconscious',
      '-c', `model=${model}`,
    ],
  },
];

const BY_ALIAS = new Map();
for (const agent of AGENTS) {
  for (const alias of agent.aliases) BY_ALIAS.set(alias, agent);
}

export function resolveAgent(name) {
  return BY_ALIAS.get(name) ?? null;
}

export function agentList() {
  return AGENTS.map((a) => ({ name: a.name, alias: a.aliases[0] }));
}

/**
 * Pull a `--model <value>` / `--model=<value>` flag out of the passthrough
 * args (so it sets the Subconscious model rather than reaching the agent).
 * Falls back to SUBCONSCIOUS_MODEL, then the default.
 */
function extractModel(argv) {
  let model = process.env.SUBCONSCIOUS_MODEL?.trim() || DEFAULT_MODEL;
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

  if (!(await isOnPath(agent.bin))) {
    console.error(
      `\n  ${c.red}${agent.name} isn't installed${c.reset} ${c.dim}(\`${agent.bin}\` not found on PATH).${c.reset}`,
    );
    console.error(`  Install it with:\n`);
    console.error(`    ${c.cyan}${agent.install}${c.reset}\n`);
    process.exit(127);
  }

  const env = { ...process.env, ...agent.env(auth.key, model) };
  const args = [...agent.args(model), ...rest];

  console.log(
    `  ${c.dim}Launching ${c.reset}${c.bold}${agent.name}${c.reset} ${c.dim}on Subconscious ${c.reset}${c.dim}(${model})${c.reset}\n`,
  );

  const child = spawn(agent.bin, args, { stdio: 'inherit', env });

  child.on('error', (err) => {
    if (err.code === 'ENOENT') {
      console.error(
        `\n  ${c.red}Could not launch \`${agent.bin}\`.${c.reset} Install it with:\n`,
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
