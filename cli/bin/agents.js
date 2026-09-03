/**
 * Coding-agent launcher.
 *
 * `subc <agent>` resolves your saved API key and runs the packaged integration.
 * Terminal agents launch ephemerally; IDE/config-based
 * agents and Pi persist a surgical integration via `subc <agent> install`.
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
import { fileURLToPath } from 'node:url';
import { c } from './colors.js';
import { getApiKey } from './auth.js';
import { profileSettingsForAgent, resolvedProfileValues } from './profiles.js';
import { isLiveModelSource, PUBLIC_CATALOG_FALLBACK_MESSAGE, resolveModelCatalog } from './models.js';
import { compareVersions } from './update-check.js';

export const MIN_CLAUDE_CODE_VERSION = '2.1.242';

// --- Registry (single source of truth, generated copy shipped in the package).
const registry = JSON.parse(
  readFileSync(new URL('./registry.generated.json', import.meta.url), 'utf-8'),
);
const DEFAULTS = registry.defaults;
const PACKAGED_MODELS =
  Array.isArray(DEFAULTS.models) && DEFAULTS.models.length
    ? DEFAULTS.models
    : [DEFAULTS.model];
const RUNBOOK_DIR = fileURLToPath(new URL('./runbook/', import.meta.url));

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
const AGENTS = registry.agents
  .filter((agent) => agent.cli !== false)
  .map((agent) => {
    const { command, fallback } = resolveInstall(agent.install);
    return { ...agent, install: command, installFallback: fallback };
  });
const BY_ALIAS = new Map();
for (const agent of AGENTS) {
  BY_ALIAS.set(agent.id, agent);
  if (agent.command) BY_ALIAS.set(agent.command, agent);
  for (const alias of agent.aliases || []) BY_ALIAS.set(alias, agent);
}

export function resolveAgent(name) {
  return BY_ALIAS.get(name) ?? null;
}

export function agentList() {
  return AGENTS.map((a) => ({
    id: a.id,
    name: a.name,
    alias: a.command || a.id,
    action: a.runbook?.mode === 'setup' ? 'Configure' : 'Launch',
    description: a.description || '',
    launch: a.runbook?.mode !== 'setup',
  }));
}

const SETUP_ACTIONS = new Set(['install', 'status', 'uninstall']);
const DROPPED_SETUP_HELPERS = new Set(['use', 'env', 'unset']);

export function agentSetupActions(agent) {
  return Array.isArray(agent.runbook?.setupActions) ? agent.runbook.setupActions : [];
}

export function agentCommandName(agent) {
  return agent.command || agent.id;
}

export function parseAgentAction(agent, argv = []) {
  const command = agentCommandName(agent);
  const first = argv[0];
  const actions = agentSetupActions(agent);

  if (DROPPED_SETUP_HELPERS.has(first)) {
    throw new Error(
      `${agent.name} no longer supports '${first}'. Launch with subc ${command}.`,
    );
  }

  if (SETUP_ACTIONS.has(first)) {
    if (!agent.runbook?.setupScript || !actions.includes(first)) {
      if (first === 'install') {
        const uninstallHint = actions.includes('uninstall')
          ? ` To remove leftover files: subc ${command} uninstall.`
          : '';
        throw new Error(
          `${agent.name} is launch-only. Run subc ${command}.${uninstallHint}`,
        );
      }
      throw new Error(
        `${agent.name} does not support '${first}'. Try subc ${command} help.`,
      );
    }
    return { action: first, args: argv };
  }

  if (agent.runbook?.mode === 'setup') {
    return { action: 'install', args: argv };
  }

  return { action: 'launch', args: argv };
}

const AGENT_HELP = {
  'claude-code': {
    usage: 'subc [-p NAME] claude [help|status|uninstall] [Claude arguments...]',
    behavior:
      'Launches Claude Code with the active Subconscious profile and model picker. Persistent files are leftover-only: subc claude uninstall.',
    options: [
      ['help', 'Show this help'],
      ['status', 'Inspect leftover ~/.claude/subconscious-gateway.env'],
      ['uninstall', 'Remove leftover ~/.claude/subconscious-gateway.env'],
      ['--model MODEL', 'Override the profile model for this launch'],
      ['--compact-window N', 'Override the Claude auto-compact window'],
      ['--max-context-tokens N', 'Override the maximum context tokens'],
      ['-- ARGS...', 'Pass remaining arguments to Claude Code'],
    ],
  },
  codex: {
    usage: 'subc [-p NAME] codex [help|install|status|uninstall] [Codex arguments...]',
    behavior:
      'Launches Codex with a temporary Subconscious provider catalog. Compaction hooks are merged into ~/.codex/hooks.json and removed with subc codex uninstall.',
    options: [
      ['help', 'Show this help'],
      ['install', 'Install only the Subconscious compaction hooks'],
      ['status', 'Inspect the installed compaction hooks'],
      ['uninstall', 'Remove only the Subconscious Codex hooks'],
      ['--model MODEL', 'Override the profile model for this launch'],
      ['--context-window N', 'Override catalog context_window'],
      ['--max-context-window N', 'Override catalog max_context_window'],
      ['--auto-compact-token-limit N', 'Override the automatic compaction threshold'],
      ['--reasoning-effort LEVEL', 'Use none, low, medium, high, or max'],
      ['--external-tools', 'Enable Codex apps/plugins for this launch'],
      ['--subagents', 'Use the pinned legacy Codex subagent mode'],
      ['-- ARGS...', 'Pass remaining arguments to Codex'],
    ],
  },
  opencode: {
    usage: 'subc [-p NAME] opencode [help|status|uninstall] [OpenCode arguments...]',
    behavior:
      'Launches OpenCode with an ephemeral provider containing every Subconscious model. Persistent files are leftover-only: subc opencode uninstall.',
    options: [
      ['help', 'Show this help'],
      ['status', 'Inspect leftover OpenCode Subconscious config'],
      ['uninstall', 'Remove only the Subconscious OpenCode provider and plugin'],
      ['--model MODEL', 'Override the profile model for this launch'],
      ['ARGS...', 'Pass arguments directly to OpenCode'],
    ],
  },
  cursor: {
    usage: 'subc [-p NAME] cursor [help|install|status|uninstall]',
    behavior:
      'Manages Cursor correlation hooks; model endpoint setup is completed in Cursor Settings.',
    options: [
      ['help', 'Show this help'],
      ['install', 'Install or update the Cursor hooks (default action)'],
      ['status', 'Inspect the installed hook configuration'],
      ['uninstall', 'Remove only the Subconscious Cursor hooks'],
    ],
  },
  copilot: {
    usage: 'subc [-p NAME] copilot [help|install|status|uninstall]',
    behavior: 'Manages the VS Code model provider and Copilot correlation hooks.',
    options: [
      ['help', 'Show this help'],
      ['install', 'Install or update the provider and hooks (default action)'],
      ['status', 'Inspect the installed provider and hooks'],
      ['uninstall', 'Remove the Subconscious provider and hooks'],
    ],
  },
  pi: {
    usage: 'subc [-p NAME] pi [help|install|status|uninstall] [Pi arguments...]',
    behavior:
      'Refreshes the persistent Subconscious provider from the live catalog, then launches Pi.',
    options: [
      ['help', 'Show this help'],
      ['install', 'Refresh the Subconscious provider without launching Pi'],
      ['status', 'Inspect the persistent Pi provider'],
      ['uninstall', 'Remove only the Subconscious Pi provider and extension'],
      ['--model MODEL', 'Override the profile model for this launch'],
      ['ARGS...', 'Pass arguments directly to Pi'],
    ],
  },
  'deepseek-harness': {
    usage: 'subc [-p NAME] dsh [web|headless] [--model MODEL] [Harness arguments...]',
    behavior:
      'Launches DeepSeek Harness with a temporary Subconscious provider containing every live gateway model. Web mode is the default.',
    options: [
      ['help', 'Show this help'],
      ['web', 'Launch the DeepSeek Harness Web UI (default)'],
      ['headless PROMPT', 'Run one headless task and exit'],
      ['--model MODEL', 'Set the initial model for new Harness sessions'],
      ['ARGS...', 'Pass remaining arguments to the selected Harness mode'],
    ],
  },
};

export function isAgentHelpRequest(argv = []) {
  return ['help', '-h', '--help'].includes(argv[0]);
}

function displayProfileValue(setting, value, values) {
  if (setting.type === 'secret') {
    if (value) return '(set)';
    return setting.key !== 'API_KEY' && values.API_KEY ? '(shared key)' : '(not set)';
  }
  return value || '(auto)';
}

export function printAgentHelp(agent, profile) {
  const details = AGENT_HELP[agent.id] || {
    usage: `subc [--profile NAME] ${agent.command || agent.id} [arguments...]`,
    behavior: agent.description,
    options: [],
  };
  const settings = profileSettingsForAgent(agent.id);
  const values = resolvedProfileValues(profile);
  const optionWidth = Math.max(0, ...details.options.map(([option]) => option.length));
  const settingWidth = Math.max(0, ...settings.map((setting) => setting.key.length));

  console.log(`\n  ${c.bold}${agent.name} + Subconscious${c.reset}\n`);
  console.log(`  ${details.behavior}\n`);
  console.log(`  ${c.bold}Usage${c.reset}\n    ${details.usage}\n`);
  if (details.options.length) {
    console.log(`  ${c.bold}Commands and options${c.reset}`);
    for (const [option, description] of details.options) {
      console.log(`    ${c.cyan}${option.padEnd(optionWidth)}${c.reset}  ${description}`);
    }
    console.log();
  }
  console.log(`  ${c.bold}Profile settings${c.reset} ${c.dim}(${profile?.name || 'default'})${c.reset}`);
  for (const setting of settings) {
    const value = displayProfileValue(setting, values[setting.key], values);
    console.log(`    ${c.cyan}${setting.key.padEnd(settingWidth)}${c.reset}  ${value}`);
    console.log(`    ${' '.repeat(settingWidth)}  ${c.dim}${setting.description}${c.reset}`);
  }
  const command = agentCommandName(agent);
  const profileFlag = profile?.name || 'default';
  console.log(
    `\n  Edit the env file with ${c.cyan}subc -p ${profileFlag} config edit${c.reset}.`,
  );
  const actions = agentSetupActions(agent);
  if (actions.includes('install')) {
    console.log(
      `  Install the persistent integration with ${c.cyan}subc ${command} install${c.reset}.`,
    );
  }
  if (actions.includes('uninstall')) {
    console.log(
      `  Remove it with ${c.cyan}subc ${command} uninstall${c.reset}.`,
    );
  }
  console.log();
}

/**
 * Resolve the substitution context for a launch:
 *   model     — --model flag → SUBCONSCIOUS_MODEL → registry default
 *   baseUrl   — SUBCONSCIOUS_BASE_URL → registry default
 *   baseUrlV1 — `${baseUrl}/v1` (so an override flows to both)
 */
function buildContext(apiKey, model, profile) {
  const baseUrl = (
    process.env.SUBCONSCIOUS_BASE_URL?.trim() ||
    profile?.values?.GATEWAY_URL?.trim() ||
    DEFAULTS.baseUrl
  ).replace(/\/+$/, '');
  return { apiKey, model, baseUrl, baseUrlV1: `${baseUrl}/v1` };
}

/**
 * Pull a `--model <value>` / `--model=<value>` flag out of the passthrough
 * args (so it sets the Subconscious model rather than reaching the agent).
 * Falls back to SUBCONSCIOUS_MODEL, then the registry default.
 */
function extractModel(argv, profile) {
  const environmentModel = process.env.SUBCONSCIOUS_MODEL?.trim();
  const profileModel = profile?.values?.MODEL?.trim();
  let model = environmentModel || profileModel || DEFAULTS.model;
  let modelSource = environmentModel ? 'environment' : profileModel ? 'profile' : 'default';
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model') {
      const v = argv[i + 1];
      if (v && !v.startsWith('-')) {
        model = v;
        modelSource = 'command';
        i++;
      }
      continue;
    }
    if (a.startsWith('--model=')) {
      model = a.slice('--model='.length);
      modelSource = 'command';
      continue;
    }
    rest.push(a);
  }
  return { model, modelSource, rest };
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

  // Agents without an installer are launch-only. Their setup integration may
  // configure the provider, but `subc <agent>` must never install the binary.
  if (!agent.install) {
    console.error(
      `\n  ${c.red}${agent.name} isn't installed${c.reset} ${c.dim}(\`${agent.bin}\` not found on PATH).${c.reset}`,
    );
    console.error(`  Install ${agent.name} separately, then re-run ${c.cyan}subc ${agent.command || agent.id}${c.reset}.\n`);
    process.exit(127);
  }

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
      `Open a new terminal (or add a bin dir to PATH) and re-run \`subc ${agent.command || agent.id}\`.${c.reset}\n`,
  );
  process.exit(0);
}

export function parseClaudeVersion(text) {
  const match = String(text ?? '').match(/v?(\d+\.\d+\.\d+)/);
  return match?.[1] ?? null;
}

export function claudeVersionNeedsUpgrade(installed, minimum = MIN_CLAUDE_CODE_VERSION) {
  return Boolean(installed && minimum && compareVersions(installed, minimum) < 0);
}

export function readClaudeVersion(bin, binDir, options = {}) {
  const execFile = options.execFileSync || execFileSync;
  try {
    const stdout = execFile(bin, ['--version'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: augmentPath([binDir, ...candidateBinDirs()].filter(Boolean)) },
      timeout: options.timeoutMs ?? 3000,
    });
    return parseClaudeVersion(typeof stdout === 'string' ? stdout : stdout?.toString?.());
  } catch {
    return null;
  }
}

async function ensureClaudeCompatible(agent, binDir) {
  if (agent.id !== 'claude-code') return;
  const version = readClaudeVersion(agent.bin, binDir);
  if (!claudeVersionNeedsUpgrade(version)) return;

  console.error(
    `\n  Minimum supported Claude Code version is ${MIN_CLAUDE_CODE_VERSION}. Your version is ${version}. Upgrade to get the best experience.\n`,
  );
  console.error(`  Upgrade it with:`);
  console.error(`    ${c.cyan}${agent.install}${c.reset}`);
  if (agent.installFallback) {
    console.error(`  or`);
    console.error(`    ${c.cyan}${agent.installFallback}${c.reset}`);
  }
  console.error('');
}

/** Resolve and validate a script inside the packaged runbook directory. */
function runbookScriptPath(agent, relativeScript = agent.runbook.script) {
  const script = path.resolve(RUNBOOK_DIR, relativeScript);
  const relative = path.relative(RUNBOOK_DIR, script);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Invalid runbook script path for ${agent.name}`);
  }
  return script;
}

/** Spawn a runbook script and mirror its exit status/signals. */
function spawnRunbook(agent, args, env, relativeScript) {
  return new Promise((resolve, reject) => {
    const script = runbookScriptPath(agent, relativeScript);
    const child = spawn('bash', [script, ...args], { stdio: 'inherit', env });

    child.on('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(
          new Error('These coding-agent integrations require `bash`, but it was not found on PATH.'),
        );
        return;
      }
      reject(error);
    });

    child.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      if (code) process.exitCode = code;
      resolve(code ?? 0);
    });
  });
}

function isSetupWithoutAuth(argv) {
  return ['status', 'uninstall', '-h', '--help', 'help'].includes(argv[0]);
}

function optionValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1]?.trim() || null : null;
}

function agentApiKeySetting(agent) {
  return profileSettingsForAgent(agent.id).find(
    (setting) => setting.key !== 'API_KEY' && setting.key.endsWith('_API_KEY'),
  );
}

export async function getAgentApiKey(profile, agent) {
  const specificSetting = agentApiKeySetting(agent);
  const specificKey = specificSetting?.key;
  const specificEnvKey = specificKey && process.env[specificKey]?.trim();
  if (specificEnvKey) return { key: specificEnvKey, source: `${specificKey} env var` };

  const sharedEnvKey = process.env.SUBCONSCIOUS_API_KEY?.trim();
  if (sharedEnvKey) {
    return { key: sharedEnvKey, source: 'SUBCONSCIOUS_API_KEY env var' };
  }

  const profileKey = specificKey && profile?.values?.[specificKey]?.trim();
  if (profileKey) return { key: profileKey, source: profile.path };

  return getApiKey(profile);
}

async function requireApiKey(profile, agent) {
  const auth = await getAgentApiKey(profile, agent);
  if (auth) return auth.key;
  const login =
    profile?.name && profile.name !== 'default'
      ? `subc --profile ${profile.name} login`
      : 'subc login';

  console.error(`\n  ${c.red}Not logged in.${c.reset}`);
  console.error(
    `  Run ${c.cyan}${login}${c.reset} (or set ${c.dim}SUBCONSCIOUS_API_KEY${c.reset}) first.\n`,
  );
  process.exitCode = 1;
  return null;
}

const CLAUDE_MODEL_PICKER_KEYS = [
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME',
  'ANTHROPIC_DEFAULT_FABLE_MODEL_DESCRIPTION',
  'ANTHROPIC_CUSTOM_MODEL_OPTION',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_NAME',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION',
];

const CLAUDE_MODEL_PICKER_ID_KEYS = [
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_CUSTOM_MODEL_OPTION',
];

function uniqueCatalogModels(models, fallbackModel) {
  const unique = [];
  for (const model of models) {
    if (model && !unique.includes(model)) unique.push(model);
  }
  if (unique.length === 0 && fallbackModel) unique.push(fallbackModel);
  return unique;
}

export function claudePickerSettings(models, fallbackModel) {
  const unique = uniqueCatalogModels(models, fallbackModel);
  return {
    availableModels: unique,
    modelPicker: {
      replaceBuiltInOptions: true,
      options: unique.map((model) => ({
        model,
        label: model,
        description: `Subconscious model ${model}`,
      })),
    },
  };
}

function claudeModelPickerEnv(agent, ctx, models) {
  if (agent.id !== 'claude-code') return {};
  // Only the live catalog belongs in Claude's picker. Packaged registry slots
  // (Haiku → DeepSeek, etc.) must not be unioned back in — that advertised
  // models the key cannot call.
  //
  // Pad through Fable so the built-in `fable` alias cannot resolve to Anthropic
  // Fable 5. The /model menu itself is replaced via claudePickerSettings.
  const pickerModels = uniqueCatalogModels(models, ctx.model);
  while (pickerModels.length < 4) pickerModels.push(pickerModels.at(-1) || ctx.model);

  const roles = ['OPUS', 'SONNET', 'HAIKU', 'FABLE'];
  const env = {};
  for (let index = 0; index < roles.length; index++) {
    const role = roles[index];
    const model = pickerModels[index];
    if (!model) continue;
    env[`ANTHROPIC_DEFAULT_${role}_MODEL`] = model;
    env[`ANTHROPIC_DEFAULT_${role}_MODEL_NAME`] = model;
    env[`ANTHROPIC_DEFAULT_${role}_MODEL_DESCRIPTION`] = `Subconscious model ${model}`;
  }
  const customModel = pickerModels[4];
  if (customModel) {
    env.ANTHROPIC_CUSTOM_MODEL_OPTION = customModel;
    env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME = customModel;
    env.ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION = `Subconscious model ${customModel}`;
  }
  return Object.fromEntries(
    CLAUDE_MODEL_PICKER_KEYS.map((key) => [key, env[key]]).filter(([, value]) => value),
  );
}

function applyClaudePickerCatalog(env, picker, models) {
  if (Object.keys(picker).length === 0) return env;
  const allowed = new Set(models);

  for (const key of CLAUDE_MODEL_PICKER_KEYS) {
    if (!picker[key]) {
      delete env[key];
    }
  }

  for (const key of CLAUDE_MODEL_PICKER_ID_KEYS) {
    if (!picker[key] || !env[key] || allowed.has(env[key])) continue;
    env[key] = picker[key];
    const nameKey = `${key}_NAME`;
    const descriptionKey = `${key}_DESCRIPTION`;
    if (picker[nameKey]) env[nameKey] = picker[nameKey];
    if (picker[descriptionKey]) env[descriptionKey] = picker[descriptionKey];
  }
  return env;
}

export function runbookEnv(
  apiKey,
  model,
  binDir,
  profile,
  agent,
  models = PACKAGED_MODELS,
) {
  const ctx = buildContext(apiKey, model, profile);
  const extraDirs = [binDir, ...candidateBinDirs()].filter(Boolean);
  const specificApiKey = agentApiKeySetting(agent)?.key;
  const picker = claudeModelPickerEnv(agent, ctx, models);
  return applyClaudePickerCatalog(
    {
      ...picker,
      ...(profile?.values || {}),
      ...process.env,
      GATEWAY_URL: ctx.baseUrl,
      API_KEY: apiKey,
      ...(specificApiKey ? { [specificApiKey]: apiKey } : {}),
      MODEL: model,
      SUBCONSCIOUS_MODELS: models.join('\n'),
      ...(agent.id === 'claude-code'
        ? {
            SUBC_CLAUDE_SETTINGS: JSON.stringify(claudePickerSettings(models, model)),
            CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '0',
          }
        : {}),
      SUBC_ENV_FILE: os.devNull,
      PATH: augmentPath(extraDirs),
    },
    picker,
    models,
  );
}

async function resolvedModelsForLaunch(profile, apiKey, selectedModel) {
  const ctx = buildContext(apiKey, selectedModel, profile);
  const catalog = await resolveModelCatalog({
    baseUrl: ctx.baseUrl,
    apiKey,
    selectedModel,
    fallbackModels: PACKAGED_MODELS,
  });
  if (catalog.source === 'public' && apiKey) {
    console.error(`  ${c.dim}${PUBLIC_CATALOG_FALLBACK_MESSAGE}${c.reset}\n`);
  } else if (catalog.error) {
    console.error(
      `  ${c.yellow}Could not fetch the live model catalog; using packaged defaults.${c.reset}`,
    );
    console.error(`  ${c.dim}${catalog.error.message}${c.reset}\n`);
  }
  return catalog;
}

export function selectLaunchModel(requestedModel, modelSource, catalog) {
  const useLiveDefault =
    isLiveModelSource(catalog.source) &&
    catalog.models.length > 0 &&
    !catalog.models.includes(requestedModel) &&
    (modelSource === 'profile' || modelSource === 'default');
  return useLiveDefault ? catalog.models[0] : requestedModel;
}

async function runRunbookSetup(agent, argv, profile, relativeScript = agent.runbook.script) {
  if (isSetupWithoutAuth(argv)) {
    return spawnRunbook(agent, argv, {
      ...(profile?.values || {}),
      ...process.env,
      SUBC_ENV_FILE: os.devNull,
    }, relativeScript);
  }

  const { model: requestedModel, modelSource, rest } = extractModel(argv, profile);
  const apiKey = optionValue(rest, '--api-key') || (await requireApiKey(profile, agent));
  if (!apiKey) return 1;
  const catalog = await resolvedModelsForLaunch(profile, apiKey, requestedModel);
  const model = selectLaunchModel(requestedModel, modelSource, catalog);
  if (model !== requestedModel) {
    console.error(
      `  ${c.yellow}Configured model ${requestedModel} is not in the live catalog; using ${model}.${c.reset}\n`,
    );
  }
  const ctx = buildContext(apiKey, model, profile);
  const authArgs = substitute(agent.runbook.authArgs || [], ctx);

  console.log(
    `  ${c.dim}Configuring ${c.reset}${c.bold}${agent.name}${c.reset} ${c.dim}for Subconscious (${model})${c.reset}\n`,
  );
  const code = await spawnRunbook(
    agent,
    [...authArgs, ...rest],
    runbookEnv(apiKey, model, undefined, profile, agent, catalog.models),
    relativeScript,
  );
  const installed = !['status', 'uninstall'].includes(rest[0]);
  if (code !== 0 || !installed) return code;

  if (agent.id === 'pi') {
    console.log(`\n  ${c.dim}Start a fresh session with ${c.reset}${c.cyan}subc pi${c.reset}${c.dim}.${c.reset}\n`);
  }
  return code;
}

/**
 * Launch a coding agent against Subconscious. `argv` is everything after the
 * agent name; unknown flags pass straight through to the underlying CLI.
 */
export async function runAgent(agent, argv, options = {}) {
  const profile = options.profile;
  if (isAgentHelpRequest(argv)) {
    printAgentHelp(agent, profile);
    return 0;
  }

  const parsed = parseAgentAction(agent, argv);
  if (parsed.action !== 'launch') {
    if (!agent.runbook?.setupScript) {
      throw new Error(`No persistent integration is available for ${agent.name}`);
    }
    const setupArgs =
      parsed.args[0] === parsed.action ? parsed.args : [parsed.action, ...parsed.args];
    const code = await runRunbookSetup(
      agent,
      setupArgs,
      profile,
      agent.runbook.setupScript,
    );
    if (code === 0) {
      const message =
        parsed.action === 'status'
          ? `${agent.name} status check complete.`
          : parsed.action === 'uninstall'
            ? `${agent.name} integration removed.`
            : `${agent.name} setup complete.`;
      console.log(`\n  ${c.green}${c.bold}✓ ${message}${c.reset}\n`);
    }
    return code;
  }

  const { model: requestedModel, modelSource, rest } = extractModel(argv, profile);
  const apiKey = await requireApiKey(profile, agent);
  if (!apiKey) return 1;

  const binDir = await ensureInstalled(agent);
  await ensureClaudeCompatible(agent, binDir);
  const catalog = await resolvedModelsForLaunch(profile, apiKey, requestedModel);
  const model = selectLaunchModel(requestedModel, modelSource, catalog);
  if (model !== requestedModel) {
    console.error(
      `  ${c.yellow}Configured model ${requestedModel} is not in the live catalog; using ${model}.${c.reset}\n`,
    );
  }

  if (agent.runbook?.mode === 'launch') {
    console.log(
      `  ${c.dim}Launching ${c.reset}${c.bold}${agent.name}${c.reset} ${c.dim}on Subconscious ${c.reset}${c.dim}(${model})${c.reset}\n`,
    );
    return spawnRunbook(
      agent,
      rest,
      runbookEnv(apiKey, model, binDir, profile, agent, catalog.models),
    );
  }

  const ctx = buildContext(apiKey, model, profile);
  const launch = substituteString(agent.launch, ctx);
  const [bin, ...launchArgs] = launch.split(' ').filter(Boolean);
  const envMap = substitute(agent.env, ctx);

  // Prepend the resolved bin dir + candidate dirs to the child's PATH so the
  // agent (and any subprocess it spawns) resolves correctly this session, even
  // if it was installed into a dir not yet on the parent shell's PATH.
  const extraDirs = [binDir, ...candidateBinDirs()].filter(Boolean);
  const env = {
    ...envMap,
    ...(profile?.values || {}),
    ...process.env,
    PATH: augmentPath(extraDirs),
  };
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
