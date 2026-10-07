/**
 * Named .env profiles stored independently of the installed package.
 *
 * Profiles use a small .env format so users can inspect or edit them directly:
 *   ~/.subconscious/profiles/default.env
 *   ~/.subconscious/profiles/<name>.env
 */

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { c } from './colors.js';
import { PUBLIC_CATALOG_FALLBACK_MESSAGE } from './models.js';
import {
  profileTemplate,
  RUNBOOK_DEFAULTS,
  SUPPORTED_MODELS,
} from './profile-settings.js';

export {
  PROFILE_SETTING_GROUPS,
  profileSettingsForAgent,
  RUNBOOK_DEFAULTS,
  resolvedProfileValues,
  SUPPORTED_MODELS,
} from './profile-settings.js';

import { runWindows, windowsEditor } from './windows/process.js';

export const DEFAULT_PROFILE = 'default';
const PREVIOUS_DEFAULT_GATEWAYS = new Set([
  'https://api.subconscious.dev',
  'https://api.subconscious.dev/',
]);
const CONFIG_OVERRIDE = process.env.SUBC_CONFIG_DIR?.trim();
const CONFIG_DIR = CONFIG_OVERRIDE || path.join(os.homedir(), '.subconscious');
export const PROFILES_DIR = path.join(CONFIG_DIR, 'profiles');
/** Absolute path of the subc config dir (~/.subconscious or $SUBC_CONFIG_DIR). */
export function configDir() {
  return CONFIG_DIR;
}
const LEGACY_PROFILES_DIR = CONFIG_OVERRIDE
  ? null
  : path.join(os.homedir(), '.subcon', 'profiles');

export function validateProfileName(name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
    throw new Error(
      `Invalid profile name '${name}' (use letters, digits, _ or -)`,
    );
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
    const match = trimmed.match(
      /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/,
    );
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
  return profileTemplate().replace(/\{([A-Z0-9_]+)\}/g, (_, key) =>
    encodeValue(values[key]),
  );
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
  for (const [key, value] of remaining)
    output.push(`${key}=${encodeValue(value)}`);
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
    updates.COPILOT_MAX_INPUT_TOKENS =
      RUNBOOK_DEFAULTS.COPILOT_MAX_INPUT_TOKENS;
  }
  if (values.COPILOT_MAX_OUTPUT_TOKENS === '4096') {
    updates.COPILOT_MAX_OUTPUT_TOKENS =
      RUNBOOK_DEFAULTS.COPILOT_MAX_OUTPUT_TOKENS;
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
    return {
      name,
      path: file,
      exists: true,
      values: parseProfile(migratedText),
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  // Migrate an existing profile on first use, leaving the legacy copy intact.
  if (LEGACY_PROFILES_DIR) {
    try {
      const text = migrateDefaults(
        await fs.readFile(
          path.join(LEGACY_PROFILES_DIR, `${name}.env`),
          'utf-8',
        ),
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
              profile.values[key] === undefined ||
              (key === 'API_KEY' && apiKey !== undefined),
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

// PI_MAX_TOKENS=65536 is a budget, not a credential. Anything else under a
// *_TOKENS name, such as a key pasted onto the wrong line, stays redacted.
function isTokenBudget(key, value) {
  return (
    /_TOKENS$|_TOKEN_LIMIT$/i.test(key) &&
    /^\d+$/.test(value) &&
    Number.isSafeInteger(Number(value))
  );
}

function isSecretKey(key, value) {
  const upper = key.toUpperCase();
  return (
    upper.endsWith('API_KEY') ||
    (upper.includes('TOKEN') && !isTokenBudget(key, value)) ||
    upper.includes('SECRET') ||
    upper.includes('PASSWORD') ||
    upper.includes('AUTH')
  );
}

function redact(key, value) {
  if (!value || !isSecretKey(key, value)) return value;
  return value.length <= 8
    ? '********'
    : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function redactEnvLine(line) {
  const match = line.match(
    /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)=(.*)$/,
  );
  if (!match) return line;
  const [, prefix, key, raw] = match;
  const value = decodeValue(raw);
  if (!value || !isSecretKey(key, value)) return line;
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
    text.replace(/\n$/, '').split('\n').map(redactEnvLine).join('\n'),
  );
  console.log();
}

export function isUnsetSetting(value) {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase();
  return (
    normalized === 'UNSET' ||
    normalized === 'FOLLOW-GATEWAY' ||
    normalized === 'FOLLOW-DEFAULT'
  );
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

const ALLOWED_EDITORS = new Set(
  process.platform === 'win32'
    ? ['notepad', 'code', 'code-insiders', 'vim', 'nano']
    : ['vim', 'nano'],
);

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
  throw new Error(
    'No editor found. Install vim or nano, or set $VISUAL / $EDITOR.',
  );
}

async function editProfile(profileName, requestedEditor) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('Editing a profile requires a terminal.');
    console.error(profilePath(profileName));
    process.exitCode = 1;
    return;
  }

  const profile = await ensureProfile(profileName);
  if (process.platform === 'win32') {
    const { command, args } = windowsEditor(requestedEditor);
    const code = await runWindows(command, [...args, profile.path]);
    if (code) process.exitCode = code;
    return;
  }
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
  subc config edit [${process.platform === 'win32' ? 'notepad|code|code-insiders|vim|nano' : 'vim|nano'}]
  subc -p NAME config edit [${process.platform === 'win32' ? 'notepad|code|code-insiders|vim|nano' : 'vim|nano'}]
  subc config [show|path|list|create|delete]
              [--gateway-url URL] [--platform-url URL] [--api-key KEY]
              [--model MODEL|UNSET]
              [--subagent-model MODEL|UNSET]

  subc config                      List every profile and its file path
  subc -p NAME config              Print that profile's path and env file
  subc config edit                 Open the selected profile in ${process.platform === 'win32' ? 'VISUAL, EDITOR, or Notepad' : '$VISUAL, $EDITOR, vim, or nano'}
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
    console.log(
      `    ${c.cyan}${name}${c.reset}${active}  ${c.dim}${profilePath(name)}${c.reset}`,
    );
  }
  console.log();
}

export async function configCommand(
  argv,
  profileName = DEFAULT_PROFILE,
  options = {},
) {
  let action = 'default';
  let editor;
  const updates = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === 'help' || arg === '-h' || arg === '--help') {
      printConfigHelp();
      return;
    } else if (
      [
        'show',
        'path',
        'list',
        'create',
        'delete',
        'edit',
        'interactive',
      ].includes(arg)
    ) {
      action = arg === 'interactive' ? 'edit' : arg;
    } else if (
      arg === '--gateway-url' ||
      arg === '--platform-url' ||
      arg === '--api-key' ||
      arg === '--model' ||
      arg === '--subagent-model'
    ) {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a value`);
      const key = {
        '--gateway-url': 'GATEWAY_URL',
        '--platform-url': 'PLATFORM_URL',
        '--api-key': 'API_KEY',
        '--model': 'MODEL',
        '--subagent-model': 'CLAUDE_CODE_SUBAGENT_MODEL',
      }[arg];
      updates[key] =
        (arg === '--model' || arg === '--subagent-model') &&
        isUnsetSetting(value)
          ? ''
          : value;
    } else if (action === 'edit' && ALLOWED_EDITORS.has(arg)) {
      if (editor) throw new Error('Specify only one editor');
      editor = arg;
    } else if (action === 'edit') {
      throw new Error(
        `Unknown editor '${arg}' (use ${[...ALLOWED_EDITORS].join(', ')})`,
      );
    } else {
      throw new Error(`Unknown config argument: ${arg}`);
    }
  }

  if (action === 'edit') {
    if (Object.keys(updates).length) {
      throw new Error(
        'config edit cannot be combined with --gateway-url, --platform-url, --api-key, --model, or --subagent-model',
      );
    }
    await editProfile(profileName, editor);
    return;
  }

  if (
    action === 'list' ||
    (action === 'default' &&
      !options.profileExplicit &&
      !Object.keys(updates).length)
  ) {
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
    if (existing.exists)
      throw new Error(`Profile '${profileName}' already exists`);
    const profile = await ensureProfile(profileName);
    console.log(`Created profile '${profileName}'.`);
    await printProfile(profile);
    return;
  }

  if (action === 'delete') {
    if (profileName === DEFAULT_PROFILE) {
      throw new Error(
        'Refusing to delete the default profile; use subc logout to clear its key',
      );
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
  const selectedModel =
    options.selectedModel || models[0] || RUNBOOK_DEFAULTS.MODEL;
  console.log(`\n  ${c.bold}Available models${c.reset}\n`);
  for (const model of models) {
    const suffix =
      model === selectedModel ? ` ${c.dim}(default)${c.reset}` : '';
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

export function validateOriginUrl(rawUrl, label = 'URL') {
  const normalized = String(rawUrl ?? '')
    .trim()
    .replace(/\/+$/, '');
  if (!normalized) {
    throw new Error(`${label} cannot be blank`);
  }
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`${label} must be a valid http:// or https:// URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error(`${label} must be a valid http:// or https:// URL`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} cannot contain embedded credentials`);
  }
  if (parsed.search || parsed.hash) {
    throw new Error(`${label} cannot contain a query string or fragment`);
  }
  return normalized;
}

export async function updateUrlCommand(argv = [], options = {}) {
  if (argv.length !== 1 || !argv[0]?.trim()) {
    throw new Error('Usage: subc update-url <gateway-url>');
  }

  const gatewayUrl = validateOriginUrl(argv[0], 'Gateway URL');

  const profileName = options.profileName || DEFAULT_PROFILE;
  const profile = await updateProfile(profileName, { GATEWAY_URL: gatewayUrl });

  console.log(`\n  ${c.green}${c.bold}✓ Gateway URL updated.${c.reset}`);
  console.log(
    `  ${c.dim}Updated profile automatically: ${profile.path}${c.reset}`,
  );
  console.log(`  ${c.dim}URL:     ${gatewayUrl}${c.reset}`);
  if (process.env.SUBCONSCIOUS_BASE_URL?.trim()) {
    console.log(
      `\n  ${c.yellow}SUBCONSCIOUS_BASE_URL is set and will override this saved URL.${c.reset}`,
    );
  }
  const claudeOverride =
    process.env.CLAUDE_GATEWAY_URL?.trim() ||
    profile.values.CLAUDE_GATEWAY_URL?.trim();
  if (claudeOverride) {
    console.log(
      `  ${c.yellow}CLAUDE_GATEWAY_URL is set, so Claude Code will continue using ${claudeOverride}.${c.reset}`,
    );
  }
  console.log();
}

export async function updatePlatformUrlCommand(argv = [], options = {}) {
  if (argv.length !== 1 || !argv[0]?.trim()) {
    throw new Error('Usage: subc update-platform-url <platform-url>');
  }

  const platformUrl = validateOriginUrl(argv[0], 'Platform URL');

  const profileName = options.profileName || DEFAULT_PROFILE;
  const profile = await updateProfile(profileName, {
    PLATFORM_URL: platformUrl,
  });

  console.log(`\n  ${c.green}${c.bold}✓ Platform URL updated.${c.reset}`);
  console.log(
    `  ${c.dim}Updated profile automatically: ${profile.path}${c.reset}`,
  );
  console.log(`  ${c.dim}URL:     ${platformUrl}${c.reset}`);
  if (process.env.SUBCONSCIOUS_URL?.trim()) {
    console.log(
      `\n  ${c.yellow}SUBCONSCIOUS_URL is set and will override this saved URL.${c.reset}`,
    );
  }
  console.log();
}
