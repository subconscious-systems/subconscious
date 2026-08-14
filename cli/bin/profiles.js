/**
 * Runbook-compatible profiles stored independently of the installed package.
 *
 * Profiles use a small .env format so users can inspect or edit them directly:
 *   ~/.subconscious/profiles/default.env
 *   ~/.subconscious/profiles/<name>.env
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { c } from './colors.js';

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
  CLAUDE_GATEWAY_URL: '',
  CLAUDE_CODE_API_KEY: '',
  CODEX_API_KEY: '',
  OPENCODE_API_KEY: '',
  CURSOR_API_KEY: '',
  COPILOT_API_KEY: '',
  PI_API_KEY: '',
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
    description: 'Initial model used by coding-agent launches and setup.',
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
};

const AGENT_SETTING_KEYS = {
  'claude-code': [
    'CLAUDE_GATEWAY_URL',
    'CLAUDE_CODE_API_KEY',
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
# Generated by subc. Values are shared by the packaged ol-runbook integrations.

GATEWAY_URL={GATEWAY_URL}
API_KEY={API_KEY}
# Available models:
${modelComments}
MODEL={MODEL}

# Optional per-agent keys. Leave blank to use API_KEY above.
CLAUDE_GATEWAY_URL={CLAUDE_GATEWAY_URL}
CLAUDE_CODE_API_KEY={CLAUDE_CODE_API_KEY}
CODEX_API_KEY={CODEX_API_KEY}
OPENCODE_API_KEY={OPENCODE_API_KEY}
CURSOR_API_KEY={CURSOR_API_KEY}
COPILOT_API_KEY={COPILOT_API_KEY}
PI_API_KEY={PI_API_KEY}

# Claude Code
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

# GitHub Copilot
COPILOT_MAX_INPUT_TOKENS={COPILOT_MAX_INPUT_TOKENS}
COPILOT_MAX_OUTPUT_TOKENS={COPILOT_MAX_OUTPUT_TOKENS}
VSCODE_APP={VSCODE_APP}
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

async function writeProfile(file, text) {
  await fs.mkdir(PROFILES_DIR, { recursive: true });
  await fs.writeFile(file, text, { encoding: 'utf-8', mode: 0o600 });
  await fs.chmod(file, 0o600);
}

export async function loadProfile(name = DEFAULT_PROFILE) {
  const file = profilePath(name);
  try {
    const text = await fs.readFile(file, 'utf-8');
    const migratedText = migrateDefaultGateway(text);
    if (migratedText !== text) await writeProfile(file, migratedText);
    return { name, path: file, exists: true, values: parseProfile(migratedText) };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  // Migrate an existing profile on first use, leaving the legacy copy intact.
  if (LEGACY_PROFILES_DIR) {
    try {
      const text = migrateDefaultGateway(
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

function redact(key, value) {
  if (!key.endsWith('API_KEY') || !value) return value;
  return value.length <= 8 ? '********' : `${value.slice(0, 4)}…${value.slice(-4)}`;
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

function printProfile(profile) {
  console.log(`\n  ${c.bold}Profile: ${profile.name}${c.reset}`);
  console.log(`  ${c.dim}Path:    ${profile.path}${c.reset}`);
  if (!profile.exists) {
    console.log(`  ${c.yellow}Not configured.${c.reset}\n`);
    return;
  }
  for (const key of ['GATEWAY_URL', 'API_KEY', 'MODEL']) {
    console.log(`  ${c.dim}${key.padEnd(12)}${c.reset}${redact(key, profile.values[key] || '')}`);
  }
  console.log();
}

function createPrompter() {
  let muted = false;
  let rejectPending = null;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });

  rl.on('SIGINT', () => {
    const error = new Error('Interactive configuration cancelled.');
    error.code = 'SUBC_CANCELLED';
    rejectPending?.(error);
  });

  return {
    question(prompt, options = {}) {
      return new Promise((resolve, reject) => {
        rejectPending = reject;
        if (options.secret) {
          process.stdout.write(prompt);
          muted = true;
        }
        rl.question(options.secret ? '' : prompt, (answer) => {
          if (options.secret) {
            muted = false;
            process.stdout.write('\n');
          }
          rejectPending = null;
          resolve(answer);
        });
      });
    },
    close() {
      muted = false;
      rejectPending = null;
      rl.close();
    },
  };
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

async function promptSetting(prompter, setting, current) {
  console.log(`\n  ${c.bold}${setting.label}${c.reset} ${c.dim}(${setting.key})${c.reset}`);
  console.log(`  ${c.dim}${setting.description}${c.reset}`);

  if (setting.type === 'choice') {
    setting.choices.forEach((choice, index) => {
      const label = choice || '(auto-detect)';
      const selected = choice === current ? ` ${c.green}current${c.reset}` : '';
      console.log(`    ${index + 1}. ${label}${selected}`);
    });
    while (true) {
      const answer = (await prompter.question('  Select a number (Enter keeps current): ')).trim();
      if (!answer) return current;
      const index = Number(answer) - 1;
      if (Number.isInteger(index) && setting.choices[index] !== undefined) {
        return setting.choices[index];
      }
      if (setting.choices.includes(answer)) return answer;
      console.log(`  ${c.yellow}Choose one of the listed values.${c.reset}`);
    }
  }

  const currentLabel = setting.type === 'secret' ? (current ? 'set' : 'not set') : current || 'blank';
  const suffix = setting.required ? 'Enter keeps current' : 'Enter keeps current; - clears';
  while (true) {
    const answer = (
      await prompter.question(
        `  Value [${currentLabel}] (${suffix}): `,
        { secret: setting.type === 'secret' },
      )
    ).trim();
    if (!answer) return current;
    const value = answer === '-' && !setting.required ? '' : answer;
    const error = validateSettingValue(setting, value);
    if (!error) return value;
    console.log(`  ${c.yellow}${error}.${c.reset}`);
  }
}

function uniqueSettings(groups) {
  const settings = new Map();
  for (const group of groups) {
    for (const setting of group.settings) settings.set(setting.key, setting);
  }
  return [...settings.values()];
}

async function interactiveConfig(profileName) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Interactive settings require a terminal. Use subc config flags in scripts.');
  }

  const prompter = createPrompter();
  try {
    const profiles = await listProfiles();
    console.log(`\n  ${c.bold}Interactive coding-agent settings${c.reset}`);
    if (profiles.length) {
      console.log(`  ${c.dim}Existing profiles: ${profiles.join(', ')}${c.reset}`);
    }
    const requestedName = (
      await prompter.question(`  Profile name [${profileName}]: `)
    ).trim();
    const targetName = validateProfileName(requestedName || profileName);
    const profile = await loadProfile(targetName);
    const baseValues = resolvedProfileValues(profile);
    const updates = {};

    while (true) {
      console.log(`\n  ${c.bold}Profile: ${targetName}${c.reset}`);
      PROFILE_SETTING_GROUPS.forEach((group, index) => {
        console.log(`    ${index + 1}. ${group.label}`);
      });
      const allIndex = PROFILE_SETTING_GROUPS.length + 1;
      const saveIndex = allIndex + 1;
      console.log(`    ${allIndex}. All settings`);
      console.log(`    ${saveIndex}. Save and exit`);
      console.log('    0. Cancel');
      if (Object.keys(updates).length) {
        console.log(`  ${c.dim}${Object.keys(updates).length} pending change(s)${c.reset}`);
      }

      const answer = (await prompter.question('  Choose a section: ')).trim();
      if (answer === '0') {
        console.log(`\n  ${c.dim}No settings were written.${c.reset}\n`);
        return;
      }
      if (answer === String(saveIndex)) {
        const confirmation = (
          await prompter.question(`  Save profile '${targetName}'? [Y/n] `)
        ).trim().toLowerCase();
        if (confirmation && !['y', 'yes'].includes(confirmation)) continue;
        const saved = Object.keys(updates).length
          ? await updateProfile(targetName, updates)
          : await ensureProfile(targetName);
        console.log(`\n  ${c.green}${c.bold}✓ Saved profile '${targetName}'.${c.reset}`);
        console.log(`  ${c.dim}${saved.path}${c.reset}\n`);
        return;
      }

      let selectedSettings;
      if (answer === String(allIndex)) {
        selectedSettings = uniqueSettings(PROFILE_SETTING_GROUPS);
      } else {
        const group = PROFILE_SETTING_GROUPS[Number(answer) - 1];
        if (!group) {
          console.log(`  ${c.yellow}Choose a listed section.${c.reset}`);
          continue;
        }
        selectedSettings = group.settings;
      }

      for (const setting of selectedSettings) {
        const current = updates[setting.key] ?? baseValues[setting.key] ?? '';
        const value = await promptSetting(prompter, setting, current);
        if (value === (baseValues[setting.key] ?? '')) {
          delete updates[setting.key];
        } else if (value !== current) {
          updates[setting.key] = value;
        }
      }
    }
  } catch (error) {
    if (error.code === 'SUBC_CANCELLED') {
      console.log(`\n  ${c.dim}No settings were written.${c.reset}\n`);
      return;
    }
    throw error;
  } finally {
    prompter.close();
  }
}

export async function configCommand(argv, profileName = DEFAULT_PROFILE) {
  let action = 'show';
  const updates = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (['show', 'path', 'list', 'delete', 'interactive'].includes(arg)) {
      action = arg;
    } else if (arg === '--gateway-url' || arg === '--api-key' || arg === '--model') {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a value`);
      const key = {
        '--gateway-url': 'GATEWAY_URL',
        '--api-key': 'API_KEY',
        '--model': 'MODEL',
      }[arg];
      updates[key] = value;
    } else if (arg === '-h' || arg === '--help') {
      console.log(`
Usage:
  subc config [show|path|list|delete|interactive]
              [--gateway-url URL] [--api-key KEY] [--model MODEL]
  subc --profile NAME config [...]

Interactive wizard:
  subc settings
  subc --profile NAME config interactive
`);
      return;
    } else {
      throw new Error(`Unknown config argument: ${arg}`);
    }
  }

  if (action === 'interactive') {
    await interactiveConfig(profileName);
    return;
  }

  if (action === 'list') {
    const profiles = await listProfiles();
    if (!profiles.length) {
      console.log(`\n  ${c.dim}No profiles yet. Run subc login.${c.reset}\n`);
      return;
    }
    console.log();
    for (const name of profiles) console.log(`  ${name}  ${profilePath(name)}`);
    console.log();
    return;
  }

  if (action === 'path') {
    console.log(profilePath(profileName));
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
    printProfile(profile);
    return;
  }

  printProfile(await loadProfile(profileName));
}

export function modelsCommand() {
  console.log(`\n  ${c.bold}Available models${c.reset}\n`);
  for (const model of SUPPORTED_MODELS) {
    const suffix = model === registry.defaults.model ? ` ${c.dim}(default)${c.reset}` : '';
    console.log(`  ${c.cyan}${model}${c.reset}${suffix}`);
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
