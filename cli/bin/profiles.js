/**
 * Named .env profiles stored independently of the installed package.
 *
 * Profiles use a small .env format so users can inspect or edit them directly:
 *   ~/.subconscious/profiles/default.env
 *   ~/.subconscious/profiles/<name>.env
 */

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { c } from './colors.js';
import { PUBLIC_CATALOG_FALLBACK_MESSAGE } from './models.js';

const registry = JSON.parse(
  readFileSync(new URL('./registry.generated.json', import.meta.url), 'utf-8'),
);

export const DEFAULT_PROFILE = 'default';
export const SUPPORTED_MODELS =
  Array.isArray(registry.defaults.models) && registry.defaults.models.length
    ? registry.defaults.models
    : [registry.defaults.model];
const PREVIOUS_DEFAULT_GATEWAYS = new Set([
  'https://api.subconscious.dev',
  'https://api.subconscious.dev/',
]);
const CONFIG_OVERRIDE = process.env.SUBC_CONFIG_DIR?.trim();
const CONFIG_DIR = CONFIG_OVERRIDE || path.join(os.homedir(), '.subconscious');
export const PROFILES_DIR = path.join(CONFIG_DIR, 'profiles');
const LEGACY_PROFILES_DIR = CONFIG_OVERRIDE
  ? null
  : path.join(os.homedir(), '.subcon', 'profiles');

export const RUNBOOK_DEFAULTS = {
  GATEWAY_URL: registry.defaults.baseUrl,
  API_KEY: '',
  MODEL: registry.defaults.model,
  CLAUDE_CODE_SUBAGENT_MODEL: '',
  CLAUDE_GATEWAY_URL: '',
  CLAUDE_CODE_API_KEY: '',
  CODEX_API_KEY: '',
  OPENCODE_API_KEY: '',
  CURSOR_API_KEY: '',
  COPILOT_API_KEY: '',
  PI_API_KEY: '',
  DEEPSEEK_HARNESS_API_KEY: '',
  CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000',
  CLAUDE_CODE_MAX_CONTEXT_TOKENS: '3000000',
  MAX_CONCURRENT_SUBAGENTS: '4',
  MAX_SUBAGENT_SPAWN_DEPTH: '1',
  CODEX_CONTEXT_WINDOW: '5000000',
  CODEX_MAX_CONTEXT_WINDOW: '5000000',
  CODEX_AUTO_COMPACT_TOKEN_LIMIT: '4500000',
  CODEX_REASONING_EFFORT: 'max',
  CODEX_EXTERNAL_TOOLS: 'false',
  OPENCODE_CONTEXT_LIMIT: '5000000',
  OPENCODE_OUTPUT_LIMIT: '65536',
  PI_CONTEXT_WINDOW: '5000000',
  PI_MAX_TOKENS: '65536',
  DEEPSEEK_HARNESS_CONTEXT_WINDOW: '5000000',
  DEEPSEEK_HARNESS_MAX_TOKENS: '65536',
  COPILOT_MAX_INPUT_TOKENS: '5000000',
  COPILOT_MAX_OUTPUT_TOKENS: '65536',
  VSCODE_APP: '',
};

const SETTINGS = {
  GATEWAY_URL: {
    key: 'GATEWAY_URL',
    label: 'Gateway URL',
    description: 'Subconscious gateway origin shared by every integration.',
    type: 'url',
    required: true,
  },
  API_KEY: {
    key: 'API_KEY',
    label: 'Shared API key',
    description: 'Default credential used when an agent-specific key is blank.',
    type: 'secret',
  },
  MODEL: {
    key: 'MODEL',
    label: 'Default model',
    description:
      'Initial model used by coding-agent launches and setup. UNSET uses the first live catalog model.',
    type: 'choice',
    choices: SUPPORTED_MODELS,
  },
  CLAUDE_CODE_SUBAGENT_MODEL: {
    key: 'CLAUDE_CODE_SUBAGENT_MODEL',
    label: 'Subagent model',
    description: 'Model used by Claude Code subagents. UNSET follows the default model.',
    type: 'choice',
    choices: SUPPORTED_MODELS,
  },
  CLAUDE_GATEWAY_URL: {
    key: 'CLAUDE_GATEWAY_URL',
    label: 'Claude gateway override',
    description: 'Optional Claude-only gateway origin; blank uses GATEWAY_URL.',
    type: 'url',
  },
  CLAUDE_CODE_API_KEY: {
    key: 'CLAUDE_CODE_API_KEY',
    label: 'Claude API key',
    description: 'Claude-specific credential override; blank uses API_KEY.',
    type: 'secret',
  },
  CLAUDE_CODE_AUTO_COMPACT_WINDOW: {
    key: 'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
    label: 'Auto-compact window',
    description: 'Claude token window before compaction (100000–1000000).',
    type: 'integer',
    min: 100000,
    max: 1000000,
  },
  CLAUDE_CODE_MAX_CONTEXT_TOKENS: {
    key: 'CLAUDE_CODE_MAX_CONTEXT_TOKENS',
    label: 'Maximum context tokens',
    description: 'Maximum context advertised to Claude Code.',
    type: 'integer',
    min: 1,
  },
  MAX_CONCURRENT_SUBAGENTS: {
    key: 'MAX_CONCURRENT_SUBAGENTS',
    label: 'Concurrent subagents',
    description: 'Maximum concurrent Claude/Codex subagent threads.',
    type: 'integer',
    min: 1,
  },
  MAX_SUBAGENT_SPAWN_DEPTH: {
    key: 'MAX_SUBAGENT_SPAWN_DEPTH',
    label: 'Subagent spawn depth',
    description: 'Maximum Claude subagent nesting depth.',
    type: 'integer',
    min: 0,
  },
  CODEX_API_KEY: {
    key: 'CODEX_API_KEY',
    label: 'Codex API key',
    description: 'Codex-specific credential override; blank uses API_KEY.',
    type: 'secret',
  },
  CODEX_CONTEXT_WINDOW: {
    key: 'CODEX_CONTEXT_WINDOW',
    label: 'Context window',
    description: 'Context window written into the Codex model catalog.',
    type: 'integer',
    min: 1,
  },
  CODEX_MAX_CONTEXT_WINDOW: {
    key: 'CODEX_MAX_CONTEXT_WINDOW',
    label: 'Maximum context window',
    description: 'Maximum context window written into the Codex catalog.',
    type: 'integer',
    min: 1,
  },
  CODEX_AUTO_COMPACT_TOKEN_LIMIT: {
    key: 'CODEX_AUTO_COMPACT_TOKEN_LIMIT',
    label: 'Auto-compact token limit',
    description: 'Codex token threshold that triggers automatic compaction.',
    type: 'integer',
    min: 1,
  },
  CODEX_REASONING_EFFORT: {
    key: 'CODEX_REASONING_EFFORT',
    label: 'Reasoning effort',
    description: 'Default Codex reasoning effort.',
    type: 'choice',
    choices: ['none', 'low', 'medium', 'high', 'max'],
  },
  CODEX_EXTERNAL_TOOLS: {
    key: 'CODEX_EXTERNAL_TOOLS',
    label: 'External tools',
    description: 'Enable Codex apps/plugins; may exceed the gateway tool limit.',
    type: 'choice',
    choices: ['false', 'true'],
  },
  OPENCODE_API_KEY: {
    key: 'OPENCODE_API_KEY',
    label: 'OpenCode API key',
    description: 'OpenCode-specific credential override; blank uses API_KEY.',
    type: 'secret',
  },
  OPENCODE_CONTEXT_LIMIT: {
    key: 'OPENCODE_CONTEXT_LIMIT',
    label: 'Context limit',
    description: 'OpenCode provider context limit used for compaction.',
    type: 'integer',
    min: 1,
  },
  OPENCODE_OUTPUT_LIMIT: {
    key: 'OPENCODE_OUTPUT_LIMIT',
    label: 'Output limit',
    description: 'Maximum output tokens advertised to OpenCode.',
    type: 'integer',
    min: 1,
  },
  CURSOR_API_KEY: {
    key: 'CURSOR_API_KEY',
    label: 'Cursor hook API key',
    description: 'Cursor hook credential override; blank uses API_KEY.',
    type: 'secret',
  },
  COPILOT_API_KEY: {
    key: 'COPILOT_API_KEY',
    label: 'Copilot hook API key',
    description: 'Copilot hook credential override; blank uses API_KEY.',
    type: 'secret',
  },
  COPILOT_MAX_INPUT_TOKENS: {
    key: 'COPILOT_MAX_INPUT_TOKENS',
    label: 'Maximum input tokens',
    description: 'Input-token capacity advertised to VS Code.',
    type: 'integer',
    min: 1,
  },
  COPILOT_MAX_OUTPUT_TOKENS: {
    key: 'COPILOT_MAX_OUTPUT_TOKENS',
    label: 'Maximum output tokens',
    description: 'Output-token capacity advertised to VS Code.',
    type: 'integer',
    min: 1,
  },
  VSCODE_APP: {
    key: 'VSCODE_APP',
    label: 'VS Code application',
    description: 'Optional application override; blank enables auto-detection.',
    type: 'choice',
    choices: ['', 'Code', 'Code - Insiders', 'VSCodium'],
  },
  PI_API_KEY: {
    key: 'PI_API_KEY',
    label: 'Pi API key',
    description: 'Pi-specific credential override; blank uses API_KEY.',
    type: 'secret',
  },
  PI_CONTEXT_WINDOW: {
    key: 'PI_CONTEXT_WINDOW',
    label: 'Context window',
    description: 'Pi context window used to determine compaction.',
    type: 'integer',
    min: 1,
  },
  PI_MAX_TOKENS: {
    key: 'PI_MAX_TOKENS',
    label: 'Maximum output tokens',
    description: 'Maximum output tokens advertised to Pi.',
    type: 'integer',
    min: 1,
  },
  DEEPSEEK_HARNESS_API_KEY: {
    key: 'DEEPSEEK_HARNESS_API_KEY',
    label: 'DeepSeek Harness API key',
    description: 'DeepSeek Harness credential override; blank uses API_KEY.',
    type: 'secret',
  },
  DEEPSEEK_HARNESS_CONTEXT_WINDOW: {
    key: 'DEEPSEEK_HARNESS_CONTEXT_WINDOW',
    label: 'Context window',
    description: 'Context capacity advertised to DeepSeek Harness.',
    type: 'integer',
    min: 1,
  },
  DEEPSEEK_HARNESS_MAX_TOKENS: {
    key: 'DEEPSEEK_HARNESS_MAX_TOKENS',
    label: 'Maximum output tokens',
    description: 'Output capacity advertised to DeepSeek Harness.',
    type: 'integer',
    min: 1,
  },
};

const AGENT_SETTING_KEYS = {
  'claude-code': [
    'CLAUDE_GATEWAY_URL',
    'CLAUDE_CODE_API_KEY',
    'CLAUDE_CODE_SUBAGENT_MODEL',
    'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
    'CLAUDE_CODE_MAX_CONTEXT_TOKENS',
    'MAX_CONCURRENT_SUBAGENTS',
    'MAX_SUBAGENT_SPAWN_DEPTH',
  ],
  codex: [
    'CODEX_API_KEY',
    'CODEX_CONTEXT_WINDOW',
    'CODEX_MAX_CONTEXT_WINDOW',
    'CODEX_AUTO_COMPACT_TOKEN_LIMIT',
    'CODEX_REASONING_EFFORT',
    'CODEX_EXTERNAL_TOOLS',
    'MAX_CONCURRENT_SUBAGENTS',
  ],
  opencode: ['OPENCODE_API_KEY', 'OPENCODE_CONTEXT_LIMIT', 'OPENCODE_OUTPUT_LIMIT'],
  cursor: ['CURSOR_API_KEY'],
  copilot: [
    'COPILOT_API_KEY',
    'COPILOT_MAX_INPUT_TOKENS',
    'COPILOT_MAX_OUTPUT_TOKENS',
    'VSCODE_APP',
  ],
  pi: ['PI_API_KEY', 'PI_CONTEXT_WINDOW', 'PI_MAX_TOKENS'],
  'deepseek-harness': [
    'DEEPSEEK_HARNESS_API_KEY',
    'DEEPSEEK_HARNESS_CONTEXT_WINDOW',
    'DEEPSEEK_HARNESS_MAX_TOKENS',
  ],
};

const GROUP_KEYS = [
  { id: 'shared', label: 'Shared settings', keys: ['GATEWAY_URL', 'API_KEY', 'MODEL'] },
  ...registry.agents
    .filter((agent) => agent.cli !== false)
    .map((agent) => ({
      id: agent.id,
      label: agent.name,
      keys: AGENT_SETTING_KEYS[agent.id] || [],
    })),
];

export const PROFILE_SETTING_GROUPS = GROUP_KEYS.map((group) => ({
  ...group,
  settings: group.keys.map((key) => SETTINGS[key]),
}));

export function profileSettingsForAgent(agentId) {
  const shared = PROFILE_SETTING_GROUPS.find((group) => group.id === 'shared');
  const agent = PROFILE_SETTING_GROUPS.find((group) => group.id === agentId);
  return [...(shared?.settings || []), ...(agent?.settings || [])];
}

export function resolvedProfileValues(profile) {
  return { ...RUNBOOK_DEFAULTS, ...(profile?.values || {}) };
}

function profileTemplate() {
  const modelComments = SUPPORTED_MODELS.map((model) => `#   ${model}`).join('\n');
  return `# Subconscious coding-agent profile
# Generated by subc. Extra KEY=value lines are passed through to launches.

GATEWAY_URL={GATEWAY_URL}
API_KEY={API_KEY}
# Available models (MODEL=UNSET uses the first live catalog model):
${modelComments}
MODEL={MODEL}

# Optional per-agent keys. Leave blank to use API_KEY above.
CLAUDE_CODE_API_KEY={CLAUDE_CODE_API_KEY}
CODEX_API_KEY={CODEX_API_KEY}
OPENCODE_API_KEY={OPENCODE_API_KEY}
CURSOR_API_KEY={CURSOR_API_KEY}
COPILOT_API_KEY={COPILOT_API_KEY}
PI_API_KEY={PI_API_KEY}
DEEPSEEK_HARNESS_API_KEY={DEEPSEEK_HARNESS_API_KEY}

# Claude Code
# Leave CLAUDE_GATEWAY_URL blank to use GATEWAY_URL above.
CLAUDE_GATEWAY_URL={CLAUDE_GATEWAY_URL}
# CLAUDE_CODE_SUBAGENT_MODEL=UNSET follows MODEL above.
CLAUDE_CODE_SUBAGENT_MODEL={CLAUDE_CODE_SUBAGENT_MODEL}
CLAUDE_CODE_AUTO_COMPACT_WINDOW={CLAUDE_CODE_AUTO_COMPACT_WINDOW}
CLAUDE_CODE_MAX_CONTEXT_TOKENS={CLAUDE_CODE_MAX_CONTEXT_TOKENS}
MAX_CONCURRENT_SUBAGENTS={MAX_CONCURRENT_SUBAGENTS}
MAX_SUBAGENT_SPAWN_DEPTH={MAX_SUBAGENT_SPAWN_DEPTH}

# Codex
CODEX_CONTEXT_WINDOW={CODEX_CONTEXT_WINDOW}
CODEX_MAX_CONTEXT_WINDOW={CODEX_MAX_CONTEXT_WINDOW}
CODEX_AUTO_COMPACT_TOKEN_LIMIT={CODEX_AUTO_COMPACT_TOKEN_LIMIT}
CODEX_REASONING_EFFORT={CODEX_REASONING_EFFORT}
CODEX_EXTERNAL_TOOLS={CODEX_EXTERNAL_TOOLS}

# OpenCode
OPENCODE_CONTEXT_LIMIT={OPENCODE_CONTEXT_LIMIT}
OPENCODE_OUTPUT_LIMIT={OPENCODE_OUTPUT_LIMIT}

# Pi
PI_CONTEXT_WINDOW={PI_CONTEXT_WINDOW}
PI_MAX_TOKENS={PI_MAX_TOKENS}

# DeepSeek Harness
DEEPSEEK_HARNESS_CONTEXT_WINDOW={DEEPSEEK_HARNESS_CONTEXT_WINDOW}
DEEPSEEK_HARNESS_MAX_TOKENS={DEEPSEEK_HARNESS_MAX_TOKENS}

# GitHub Copilot
COPILOT_MAX_INPUT_TOKENS={COPILOT_MAX_INPUT_TOKENS}
COPILOT_MAX_OUTPUT_TOKENS={COPILOT_MAX_OUTPUT_TOKENS}
VSCODE_APP={VSCODE_APP}

# Extra KEY=value lines are passed through to launches.
`;
}

export function validateProfileName(name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
    throw new Error(`Invalid profile name '${name}' (use letters, digits, _ or -)`);
  }
  return name;
}

export function profilePath(name = DEFAULT_PROFILE) {
  return path.join(PROFILES_DIR, `${validateProfileName(name)}.env`);
}

function decodeValue(raw) {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

export function parseProfile(text) {
  const values = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    values[match[1]] = decodeValue(match[2]);
  }
  return values;
}

function encodeValue(value) {
  const string = String(value ?? '');
  if (string.includes('\n') || string.includes('\r')) {
    throw new Error('Profile values cannot contain newlines');
  }
  return /^[A-Za-z0-9_./:@+-]*$/.test(string) ? string : JSON.stringify(string);
}

function renderTemplate(values) {
  return profileTemplate().replace(/\{([A-Z0-9_]+)\}/g, (_, key) => encodeValue(values[key]));
}

function upsertValues(text, updates) {
  const lines = text.replace(/\n$/, '').split('\n');
  const remaining = new Map(Object.entries(updates));
  const output = lines.map((line) => {
    const match = line.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!match || !remaining.has(match[2])) return line;
    const value = remaining.get(match[2]);
    remaining.delete(match[2]);
    return `${match[1]}${match[2]}=${encodeValue(value)}`;
  });
  for (const [key, value] of remaining) output.push(`${key}=${encodeValue(value)}`);
  return `${output.join('\n')}\n`;
}

function migrateDefaultGateway(text) {
  const gateway = parseProfile(text).GATEWAY_URL;
  return PREVIOUS_DEFAULT_GATEWAYS.has(gateway)
    ? upsertValues(text, { GATEWAY_URL: RUNBOOK_DEFAULTS.GATEWAY_URL })
    : text;
}

function migrateCopilotTokenDefaults(text) {
  const values = parseProfile(text);
  const updates = {};
  if (values.COPILOT_MAX_INPUT_TOKENS === '12288') {
    updates.COPILOT_MAX_INPUT_TOKENS = RUNBOOK_DEFAULTS.COPILOT_MAX_INPUT_TOKENS;
  }
  if (values.COPILOT_MAX_OUTPUT_TOKENS === '4096') {
    updates.COPILOT_MAX_OUTPUT_TOKENS = RUNBOOK_DEFAULTS.COPILOT_MAX_OUTPUT_TOKENS;
  }
  return Object.keys(updates).length ? upsertValues(text, updates) : text;
}

function migrateDefaults(text) {
  return migrateCopilotTokenDefaults(migrateDefaultGateway(text));
}

async function writeProfile(file, text) {
  await fs.mkdir(PROFILES_DIR, { recursive: true });
  await fs.writeFile(file, text, { encoding: 'utf-8', mode: 0o600 });
  await fs.chmod(file, 0o600);
}

export async function loadProfile(name = DEFAULT_PROFILE) {
  const file = profilePath(name);
  try {
    const text = await fs.readFile(file, 'utf-8');
    const migratedText = migrateDefaults(text);
    if (migratedText !== text) await writeProfile(file, migratedText);
    return { name, path: file, exists: true, values: parseProfile(migratedText) };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  // Migrate an existing profile on first use, leaving the legacy copy intact.
  if (LEGACY_PROFILES_DIR) {
    try {
      const text = migrateDefaults(
        await fs.readFile(path.join(LEGACY_PROFILES_DIR, `${name}.env`), 'utf-8'),
      );
      await writeProfile(file, text);
      return { name, path: file, exists: true, values: parseProfile(text) };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  return { name, path: file, exists: false, values: {} };
}

export async function ensureProfile(name = DEFAULT_PROFILE, apiKey) {
  const profile = await loadProfile(name);
  const values = { ...RUNBOOK_DEFAULTS };
  if (apiKey !== undefined) values.API_KEY = apiKey;

  const text = profile.exists
    ? upsertValues(
        await fs.readFile(profile.path, 'utf-8'),
        Object.fromEntries(
          Object.entries(values).filter(
            ([key]) =>
              profile.values[key] === undefined || (key === 'API_KEY' && apiKey !== undefined),
          ),
        ),
      )
    : renderTemplate(values);

  await writeProfile(profile.path, text);
  return loadProfile(name);
}

export async function updateProfile(name, updates) {
  const profile = await ensureProfile(name);
  const text = upsertValues(await fs.readFile(profile.path, 'utf-8'), updates);
  await writeProfile(profile.path, text);
  return loadProfile(name);
}

export async function clearProfileApiKey(name = DEFAULT_PROFILE) {
  const profile = await loadProfile(name);
  if (!profile.exists || !profile.values.API_KEY) return false;
  await updateProfile(name, { API_KEY: '' });
  return true;
}

function isSecretKey(key) {
  const upper = key.toUpperCase();
  return (
    upper.endsWith('API_KEY') ||
    upper.includes('TOKEN') ||
    upper.includes('SECRET') ||
    upper.includes('PASSWORD') ||
    upper.includes('AUTH')
  );
}

function redact(key, value) {
  if (!isSecretKey(key) || !value) return value;
  return value.length <= 8 ? '********' : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function redactEnvLine(line) {
  const match = line.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) return line;
  const [, prefix, key, raw] = match;
  const value = decodeValue(raw);
  if (!isSecretKey(key) || !value) return line;
  return `${prefix}${key}=${redact(key, value)}`;
}

export async function listProfiles() {
  try {
    const entries = await fs.readdir(PROFILES_DIR, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.env'))
      .map((entry) => entry.name.slice(0, -4))
      .sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function printProfile(profile) {
  console.log(`\n  ${c.bold}Profile: ${profile.name}${c.reset}`);
  console.log(`  ${c.dim}${profile.path}${c.reset}\n`);
  if (!profile.exists) {
    console.log(`  ${c.yellow}Not configured.${c.reset}\n`);
    return;
  }
  const text = await fs.readFile(profile.path, 'utf-8');
  console.log(
    text
      .replace(/\n$/, '')
      .split('\n')
      .map(redactEnvLine)
      .join('\n'),
  );
  console.log();
}

export function isUnsetSetting(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'UNSET' || normalized === 'FOLLOW-GATEWAY' || normalized === 'FOLLOW-DEFAULT';
}

export function resolvedModelSetting(value) {
  const trimmed = String(value ?? '').trim();
  return isUnsetSetting(trimmed) ? '' : trimmed;
}

export function validateSettingValue(setting, value) {
  if (!value) {
    if (setting.required) return `${setting.label} cannot be blank`;
    return null;
  }
  if (setting.type === 'url') {
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
        return 'Enter a valid http:// or https:// URL';
      }
      if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        return 'URL cannot include credentials, a query string, or a fragment';
      }
    } catch {
      return 'Enter a valid http:// or https:// URL';
    }
  }
  if (setting.type === 'integer') {
    if (!/^\d+$/.test(value)) return 'Enter a whole number';
    const number = Number(value);
    if (!Number.isSafeInteger(number)) return 'Number is too large';
    if (setting.min !== undefined && number < setting.min) {
      return `Value must be at least ${setting.min}`;
    }
    if (setting.max !== undefined && number > setting.max) {
      return `Value must be at most ${setting.max}`;
    }
  }
  return null;
}

const ALLOWED_EDITORS = new Set(['vim', 'nano']);

function commandExists(bin) {
  try {
    execFileSync('which', [bin], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function parseEditorCommand(editor) {
  const parts = String(editor || '')
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) throw new Error('Editor is empty');
  return { cmd: parts[0], args: parts.slice(1) };
}

function resolveEditor(requested) {
  if (requested) return { cmd: requested, args: [] };
  const fromEnv = process.env.VISUAL?.trim() || process.env.EDITOR?.trim();
  if (fromEnv) return parseEditorCommand(fromEnv);
  if (commandExists('vim')) return { cmd: 'vim', args: [] };
  if (commandExists('nano')) return { cmd: 'nano', args: [] };
  throw new Error('No editor found. Install vim or nano, or set $VISUAL / $EDITOR.');
}

async function editProfile(profileName, requestedEditor) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('Editing a profile requires a terminal.');
    console.error(profilePath(profileName));
    process.exitCode = 1;
    return;
  }

  const profile = await ensureProfile(profileName);
  const { cmd, args } = resolveEditor(requestedEditor);
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, [...args, profile.path], { stdio: 'inherit' });
    child.on('error', (error) => {
      reject(new Error(`Failed to launch editor '${cmd}': ${error.message}`));
    });
    child.on('close', (code) => {
      if (code && code !== 0) process.exitCode = code;
      resolve();
    });
  });
}

export function printConfigHelp() {
  console.log(`
Usage:
  subc config
  subc config help
  subc -p NAME config
  subc config edit [vim|nano]
  subc -p NAME config edit [vim|nano]
  subc config [show|path|list|create|delete]
              [--gateway-url URL] [--api-key KEY]
              [--model MODEL|UNSET]
              [--subagent-model MODEL|UNSET]

  subc config                      List every profile and its file path
  subc -p NAME config              Print that profile's path and env file
  subc config edit                 Open the selected profile in $VISUAL, $EDITOR, vim, or nano
  subc config edit vim             Open the selected profile in vim
  subc config edit nano            Open the selected profile in nano
  subc config path                 Print the selected profile path
  subc -p NAME config create       Create a new profile with default settings
  subc -p NAME config delete       Delete a non-default profile

  --model UNSET                    Clear MODEL so launches use the first live catalog model
  --subagent-model UNSET           Clear the Claude subagent override so it follows MODEL
`);
}

async function printProfileList(activeName) {
  const profiles = await listProfiles();
  if (!profiles.length) {
    console.log(`\n  ${c.dim}No profiles yet. Run subc login.${c.reset}\n`);
    return;
  }
  console.log(`\n  ${c.bold}Profiles${c.reset}`);
  for (const name of profiles) {
    const active = name === activeName ? ` ${c.green}(active)${c.reset}` : '';
    console.log(`    ${c.cyan}${name}${c.reset}${active}  ${c.dim}${profilePath(name)}${c.reset}`);
  }
  console.log();
}

export async function configCommand(argv, profileName = DEFAULT_PROFILE, options = {}) {
  let action = 'default';
  let editor;
  const updates = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === 'help' || arg === '-h' || arg === '--help') {
      printConfigHelp();
      return;
    } else if (['show', 'path', 'list', 'create', 'delete', 'edit', 'interactive'].includes(arg)) {
      action = arg === 'interactive' ? 'edit' : arg;
    } else if (
      arg === '--gateway-url' ||
      arg === '--api-key' ||
      arg === '--model' ||
      arg === '--subagent-model'
    ) {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a value`);
      const key = {
        '--gateway-url': 'GATEWAY_URL',
        '--api-key': 'API_KEY',
        '--model': 'MODEL',
        '--subagent-model': 'CLAUDE_CODE_SUBAGENT_MODEL',
      }[arg];
      updates[key] =
        (arg === '--model' || arg === '--subagent-model') && isUnsetSetting(value) ? '' : value;
    } else if (action === 'edit' && ALLOWED_EDITORS.has(arg)) {
      if (editor) throw new Error('Specify only one editor (vim or nano)');
      editor = arg;
    } else if (action === 'edit') {
      throw new Error(`Unknown editor '${arg}' (use vim or nano)`);
    } else {
      throw new Error(`Unknown config argument: ${arg}`);
    }
  }

  if (action === 'edit') {
    if (Object.keys(updates).length) {
      throw new Error(
        'config edit cannot be combined with --gateway-url, --api-key, --model, or --subagent-model',
      );
    }
    await editProfile(profileName, editor);
    return;
  }

  if (action === 'list' || (action === 'default' && !options.profileExplicit && !Object.keys(updates).length)) {
    await printProfileList(profileName);
    return;
  }

  if (action === 'path') {
    console.log(profilePath(profileName));
    return;
  }

  if (action === 'create') {
    if (Object.keys(updates).length) {
      throw new Error('config create cannot be combined with profile updates');
    }
    const existing = await loadProfile(profileName);
    if (existing.exists) throw new Error(`Profile '${profileName}' already exists`);
    const profile = await ensureProfile(profileName);
    console.log(`Created profile '${profileName}'.`);
    await printProfile(profile);
    return;
  }

  if (action === 'delete') {
    if (profileName === DEFAULT_PROFILE) {
      throw new Error('Refusing to delete the default profile; use subc logout to clear its key');
    }
    const profile = await loadProfile(profileName);
    if (!profile.exists) {
      console.log(`Profile '${profileName}' does not exist.`);
      return;
    }
    await fs.unlink(profile.path);
    console.log(`Deleted profile '${profileName}'.`);
    return;
  }

  if (Object.keys(updates).length) {
    const profile = await updateProfile(profileName, updates);
    console.log(`Updated profile '${profileName}'.`);
    await printProfile(profile);
    return;
  }

  await printProfile(await loadProfile(profileName));
}

export function modelsCommand(models = SUPPORTED_MODELS, options = {}) {
  const selectedModel = options.selectedModel || models[0] || registry.defaults.model;
  console.log(`\n  ${c.bold}Available models${c.reset}\n`);
  for (const model of models) {
    const suffix = model === selectedModel ? ` ${c.dim}(default)${c.reset}` : '';
    console.log(`  ${c.cyan}${model}${c.reset}${suffix}`);
  }
  if (options.source === 'public' && options.hasApiKey) {
    console.error(`\n  ${c.dim}${PUBLIC_CATALOG_FALLBACK_MESSAGE}${c.reset}`);
  } else if (options.error) {
    console.error(
      `\n  ${c.yellow}Could not fetch the live model catalog; showing packaged defaults.${c.reset}`,
    );
    console.error(`  ${c.dim}${options.error.message}${c.reset}`);
  }
  console.log();
}

export async function updateUrlCommand(argv = [], options = {}) {
  if (argv.length !== 1 || !argv[0]?.trim()) {
    throw new Error('Usage: subc update-url <gateway-url>');
  }

  const gatewayUrl = argv[0].trim().replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(gatewayUrl);
  } catch {
    throw new Error('Gateway URL must be a valid http:// or https:// URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('Gateway URL must be a valid http:// or https:// URL');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Gateway URL cannot contain embedded credentials');
  }
  if (parsed.search || parsed.hash) {
    throw new Error('Gateway URL cannot contain a query string or fragment');
  }

  const profileName = options.profileName || DEFAULT_PROFILE;
  const profile = await updateProfile(profileName, { GATEWAY_URL: gatewayUrl });

  console.log(`\n  ${c.green}${c.bold}✓ Gateway URL updated.${c.reset}`);
  console.log(`  ${c.dim}Updated profile automatically: ${profile.path}${c.reset}`);
  console.log(`  ${c.dim}URL:     ${gatewayUrl}${c.reset}`);
  if (process.env.SUBCONSCIOUS_BASE_URL?.trim()) {
    console.log(
      `\n  ${c.yellow}SUBCONSCIOUS_BASE_URL is set and will override this saved URL.${c.reset}`,
    );
  }
  const claudeOverride =
    process.env.CLAUDE_GATEWAY_URL?.trim() || profile.values.CLAUDE_GATEWAY_URL?.trim();
  if (claudeOverride) {
    console.log(
      `  ${c.yellow}CLAUDE_GATEWAY_URL is set, so Claude Code will continue using ${claudeOverride}.${c.reset}`,
    );
  }
  console.log();
}
