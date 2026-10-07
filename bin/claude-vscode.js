import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agentById, agentInputs } from './agent-data.js';
import { resolveAgentEnv, resolveInputs } from './agent-launch.js';
import { CLAUDE_MODEL_PICKER_KEYS } from './claude-picker.js';

// ── Subconscious API Gateway — Claude Code VS Code extension ─────────────────
// Configures the Claude Code extension for the VS Code family (Code, Code -
// Insiders, VSCodium, Cursor) through `claudeCode.environmentVariables` and
// `claudeCode.disableLoginPrompt` in each editor's user settings.json.
//
// Before the first write, subc snapshots the prior values of exactly those
// two keys; `subc claude vscode uninstall` restores them, deleting keys that
// were absent before the install. Comments and every other setting stay
// byte-identical.
//
// Unix runs this through bin/runbook/claude-code/vscode.sh; Windows calls
// these exports from bin/windows/setup.js.

export const VSCODE_APPS = Object.freeze([
  'Code',
  'Code - Insiders',
  'VSCodium',
  'Cursor',
]);
export const VSCODE_OWNED_SETTINGS_KEYS = Object.freeze([
  'claudeCode.environmentVariables',
  'claudeCode.disableLoginPrompt',
]);
/** Marks a snapshot key to remove rather than restore. */
export const SETTINGS_DELETE = Symbol('settings-delete');

const SNAPSHOT_FILE = 'claude-vscode-snapshot.json';

// ── JSONC document splicing ──────────────────────────────────────────────────
// settings.json is user-owned JSONC: comments and trailing commas are legal.
// The splice replaces a member's value, drops a member, or inserts one, and
// preserves every other byte, including comments outside the touched member.

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);

function skipIgnorable(text, i) {
  for (;;) {
    while (i < text.length && WHITESPACE.has(text[i])) i++;
    if (text[i] !== '/') return i;
    if (text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      if (i >= text.length)
        throw new Error('settings.json has an unterminated comment');
      i += 2;
      continue;
    }
    return i;
  }
}

/** End index (exclusive) of the string that starts with the quote at `i`. */
function scanString(text, i) {
  if (text[i] !== '"')
    throw new Error(`settings.json: expected a string at position ${i}`);
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === '\\') {
      j++;
      continue;
    }
    if (text[j] === '"') return j + 1;
  }
  throw new Error('settings.json has an unterminated string');
}

/** End index (exclusive) of the `{...}` or `[...]` starting at `i`. */
function scanContainer(text, i) {
  const close = text[i] === '{' ? '}' : ']';
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const ch = text[j];
    if (ch === '"') {
      j = scanString(text, j);
      j--;
      continue;
    }
    if (ch === '/' && (text[j + 1] === '/' || text[j + 1] === '*')) {
      j = skipIgnorable(text, j);
      j--;
      continue;
    }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0 && ch === close) return j + 1;
    }
  }
  throw new Error('settings.json has an unbalanced object or array');
}

/** End index (exclusive) of the JSON value starting at `i`. */
function scanValue(text, i) {
  const ch = text[i];
  if (ch === '"') return scanString(text, i);
  if (ch === '{' || ch === '[') return scanContainer(text, i);
  let j = i;
  while (
    j < text.length &&
    !WHITESPACE.has(text[j]) &&
    text[j] !== ',' &&
    text[j] !== '}' &&
    text[j] !== ']' &&
    text[j] !== '/'
  )
    j++;
  if (j === i)
    throw new Error(`settings.json: cannot read the value at position ${i}`);
  return j;
}

/** Blank out comments so a JSONC slice parses as strict JSON (newlines kept). */
function stripComments(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      const end = scanString(text, i);
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      out += '  ';
      i += 2;
      while (i < text.length && text[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        out += text[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i >= text.length)
        throw new Error('settings.json has an unterminated comment');
      out += '  ';
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Members of a JSONC document's root object: each with the span of its key
 * and value, and its parsed value. First occurrence wins for duplicate keys.
 * Throws on anything that is not a single JSON object.
 */
export function parseTopMembers(text) {
  const doc = String(text);
  let i = skipIgnorable(doc, 0);
  if (doc[i] !== '{')
    throw new Error('settings.json must hold a single JSON object');
  const rootOpen = i;
  const members = [];
  i = skipIgnorable(doc, i + 1);
  for (;;) {
    if (doc[i] === '}') break;
    if (doc[i] !== '"')
      throw new Error(
        `settings.json: expected a setting name at position ${i}`,
      );
    const start = i;
    const keyEnd = scanString(doc, start);
    const key = JSON.parse(doc.slice(start, keyEnd));
    i = skipIgnorable(doc, keyEnd);
    if (doc[i] !== ':')
      throw new Error(`settings.json: expected ':' at position ${i}`);
    i = skipIgnorable(doc, i + 1);
    const valueStart = i;
    const end = scanValue(doc, valueStart);
    if (!members.some((member) => member.key === key)) {
      members.push({
        key,
        start,
        valueStart,
        end,
        value: JSON.parse(stripComments(doc.slice(valueStart, end))),
      });
    }
    i = skipIgnorable(doc, end);
    if (doc[i] === ',') {
      i = skipIgnorable(doc, i + 1);
      continue;
    }
    break;
  }
  if (doc[i] !== '}') throw new Error("settings.json: expected ',' or '}'");
  return { rootOpen, rootClose: i, members };
}

/** First comma outside strings and comments; -1 when there is none. */
function firstCommaIndex(text) {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      i = scanString(text, i);
      i--;
      continue;
    }
    if (ch === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      i = skipIgnorable(text, i);
      i--;
      continue;
    }
    if (ch === ',') return i;
  }
  return -1;
}

// Between two consecutive emitted members a gap must hold exactly one comma.
function fixSeparator(gap, needsComma) {
  const comma = firstCommaIndex(gap);
  if (needsComma && comma < 0)
    // The gap keeps the user's comments; the comma goes at its front.
    return `,${gap}`;
  if (!needsComma && comma >= 0)
    return `${gap.slice(0, comma)}${gap.slice(comma + 1)}`;
  return gap;
}

/**
 * Splice updates into a JSONC document. `updates` maps a top-level key to a
 * new value, or to SETTINGS_DELETE to remove the member. Comments and the
 * members subc does not own are preserved verbatim. Returns the new text;
 * it equals the input when nothing changed.
 */
export function spliceSettingsDocument(text, updates) {
  const raw = String(text);
  const { rootOpen, rootClose, members } = parseTopMembers(raw);
  const pending = { ...updates };
  // Only whitespace and separator commas: pure noise around a member.
  const separatorOnly = (value) => /^[\s,]*$/.test(value);
  let out = raw.slice(0, rootOpen + 1);
  let cursor = rootOpen + 1;
  let gap = '';
  let emittedAny = false;

  for (const member of members) {
    const fresh = raw.slice(cursor, member.start);
    cursor = member.end;
    const update = pending[member.key];
    if (update !== undefined) delete pending[member.key];
    if (update === SETTINGS_DELETE) {
      // A dropped member takes only its own separator-only surroundings:
      // its indentation and the comma after the previous member. Gaps
      // holding comments survive, so nothing a user wrote is lost; the
      // residue at most re-anchors a comma subc introduced.
      if (!separatorOnly(fresh)) gap += fresh;
      continue;
    }
    gap += fresh;
    out += fixSeparator(gap, emittedAny);
    gap = '';
    if (update === undefined) {
      out += raw.slice(member.start, member.end);
    } else {
      const serialized = JSON.stringify(update);
      const current = stripComments(raw.slice(member.valueStart, member.end));
      out += raw.slice(member.start, member.valueStart);
      out +=
        current === serialized
          ? raw.slice(member.valueStart, member.end)
          : serialized;
    }
    emittedAny = true;
  }

  gap += raw.slice(cursor, rootClose);
  const insertions = Object.keys(pending).filter(
    (key) => pending[key] !== SETTINGS_DELETE,
  );
  if (insertions.length) {
    // New members go after the last existing one, on their own lines. The
    // trailing whitespace of the gap becomes the closing brace's own lead-in.
    const [, lead = '', whitespace = ''] = /^(.*?)([ \t\r\n]*)$/s.exec(gap);
    const items = insertions
      .map((key) => `${JSON.stringify(key)}: ${JSON.stringify(pending[key])}`)
      .join(',\n  ');
    out += `${fixSeparator(lead, emittedAny)}\n  ${items}${whitespace}`;
  } else {
    // Any comma left in the trailing gap predates subc (a deleted member's
    // separator-only gap was dropped above); JSONC accepts it as-is.
    out += gap;
  }
  return out + raw.slice(rootClose);
}

// ── The extension env subc owns ──────────────────────────────────────────────

/**
 * The `claudeCode.environmentVariables` array: what a `subc claude` launch
 * injects, resolved from agent data so it cannot drift from launches. Order:
 * the agent.json env block, then exported inputs, then model picker keys.
 * The caller's process env is never read; only resolved agent env is.
 */
export function claudeVscodeEnvironment(agent, resolvedEnv) {
  const names = [
    ...agent.env.map((entry) => entry.name),
    ...agentInputs(agent)
      .filter((input) => input.export)
      .map((input) => input.name),
    ...CLAUDE_MODEL_PICKER_KEYS,
  ];
  const entries = [];
  const seen = new Set();
  for (const name of names) {
    if (seen.has(name) || name === 'CLAUDE_CODE_API_KEY' || name === 'PATH')
      continue;
    const value = resolvedEnv[name];
    if (value === undefined || value === null || value === '') continue;
    seen.add(name);
    entries.push({ name, value: String(value) });
  }
  return entries;
}

// ── Locations ────────────────────────────────────────────────────────────────

function resolveConfigDir({ configDir, home }) {
  return (
    configDir ||
    process.env.SUBC_CONFIG_DIR?.trim() ||
    path.join(home, '.subconscious')
  );
}

function hostOptions(options = {}, env = process.env) {
  return {
    home: options.home || os.homedir(),
    configDir: options.configDir || env.SUBC_CONFIG_DIR?.trim(),
    platform: options.platform || process.platform,
    appData: options.appData || env.APPDATA?.trim(),
  };
}

export function appUserDir(app, host) {
  if (host.platform === 'win32') {
    const appData = host.appData || path.join(host.home, 'AppData', 'Roaming');
    return path.join(appData, app, 'User');
  }
  if (host.platform === 'darwin')
    return path.join(host.home, 'Library', 'Application Support', app, 'User');
  return path.join(host.home, '.config', app, 'User');
}

function settingsPathFor(app, host) {
  return path.join(appUserDir(app, host), 'settings.json');
}

function detectedApps(host) {
  return VSCODE_APPS.filter((app) => fs.existsSync(appUserDir(app, host)));
}

function resolveApps(selection, host) {
  if (!selection || selection === 'all') return detectedApps(host);
  if (!VSCODE_APPS.includes(selection))
    throw new Error(
      `Unknown editor '${selection}'. Use one of: ${VSCODE_APPS.join(', ')}, or 'all'.`,
    );
  if (!fs.existsSync(appUserDir(selection, host)))
    throw new Error(
      `No user settings directory for ${selection} (${appUserDir(selection, host)}). Install the editor first.`,
    );
  return [selection];
}

// ── Snapshot store ──────────────────────────────────────────────────────────

function snapshotFile(configDirectory) {
  return path.join(configDirectory, SNAPSHOT_FILE);
}

class CorruptSnapshot extends Error {
  constructor(file) {
    super(
      `Cannot read the snapshot file ${file}. Re-run with --force to start over.`,
    );
    this.corrupt = true;
  }
}

function readSnapshot(configDirectory) {
  const file = snapshotFile(configDirectory);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, apps: {} };
    throw error;
  }
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !data.apps)
      throw new Error('missing apps');
    return data;
  } catch {
    throw new CorruptSnapshot(file);
  }
}

function writeSnapshot(configDirectory, data) {
  fs.mkdirSync(configDirectory, { recursive: true, mode: 0o700 });
  const file = snapshotFile(configDirectory);
  const temp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}

function atomicWrite(file, text) {
  // Keep the mode the file already had; the user owns this file, not subc.
  const mode = fs.existsSync(file) ? fs.statSync(file).mode & 0o777 : 0o644;
  const temp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, text, { mode });
  fs.renameSync(temp, file);
}

function subcVersion() {
  try {
    return JSON.parse(
      fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ).version;
  } catch {
    return 'unknown';
  }
}

function ownedValues(raw) {
  const { members } = parseTopMembers(raw);
  const keys = {};
  for (const key of VSCODE_OWNED_SETTINGS_KEYS)
    keys[key] = members.find((member) => member.key === key)?.value ?? null;
  return keys;
}

function settingsOrThrow(settingsPath) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  if (!fs.existsSync(settingsPath)) return '{\n}';
  const raw = fs.readFileSync(settingsPath, 'utf8');
  try {
    parseTopMembers(raw);
  } catch (error) {
    throw new Error(
      `${settingsPath} cannot be parsed (${error.message}); leaving it unchanged`,
    );
  }
  return raw;
}

// ── Commands ────────────────────────────────────────────────────────────────

function installApp(app, entries, { host, snapshot, log }) {
  const settingsPath = settingsPathFor(app, host);
  const existed = fs.existsSync(settingsPath);
  const raw = settingsOrThrow(settingsPath);

  // The first install captures the prior values; re-installs only refresh
  // the keys subc owns and keep the original snapshot.
  if (!snapshot.apps[app]) {
    snapshot.apps[app] = {
      captured_at: new Date().toISOString(),
      subc_version: subcVersion(),
      settings_path: settingsPath,
      created_file: !existed,
      keys: ownedValues(raw),
    };
  }

  const next = spliceSettingsDocument(raw, {
    'claudeCode.environmentVariables': entries,
    'claudeCode.disableLoginPrompt': true,
  });
  const changed = next !== raw;
  if (changed) atomicWrite(settingsPath, next);
  log(
    `${app}: ${!existed ? 'created settings.json with' : changed ? 'wrote' : 'already holds'} ${entries.length} env vars (${settingsPath})`,
  );
}

export function claudeVscodeInstall(agent, env, options = {}) {
  const host = hostOptions(options, env);
  const log = options.log || console.log;
  const resolved = resolveAgentEnv(
    agent,
    resolveInputs(agent, env, {}, { strict: false }),
  );
  const entries = claudeVscodeEnvironment(agent, resolved);

  const apps = resolveApps(options.app, host);
  if (apps.length === 0)
    throw new Error(
      `No VS Code-family editor user settings found. Install the editor, or pass --app ${VSCODE_APPS.join('|')}.`,
    );

  const configDirectory = resolveConfigDir(host);
  let snapshot;
  try {
    snapshot = readSnapshot(configDirectory);
  } catch (error) {
    if (!options.force || !error.corrupt) throw error;
    fs.renameSync(
      snapshotFile(configDirectory),
      `${snapshotFile(configDirectory)}.invalid`,
    );
    log(
      `Set aside the corrupt snapshot file: ${snapshotFile(configDirectory)}.invalid`,
    );
    snapshot = { version: 1, apps: {} };
  }

  for (const app of apps) installApp(app, entries, { host, snapshot, log });
  writeSnapshot(configDirectory, snapshot);

  log(
    `Snapshot of prior settings: ${snapshotFile(configDirectory)} (subc claude vscode uninstall restores them)`,
  );
  log(
    '  Warning: the gateway token sits in plain text inside settings.json, by the extension design.',
  );
  log('  Restart the editor to load the new settings.');
  return 0;
}

function uninstallApp(app, record, { host, log }) {
  const settingsPath = settingsPathFor(app, host);
  if (!fs.existsSync(settingsPath)) {
    log(`${app}: ${settingsPath} is gone; dropping the snapshot record`);
    return;
  }
  const raw = fs.readFileSync(settingsPath, 'utf8');
  try {
    parseTopMembers(raw);
  } catch (error) {
    throw new Error(
      `${settingsPath} cannot be parsed (${error.message}); leaving it unchanged`,
    );
  }
  const updates = {};
  for (const key of VSCODE_OWNED_SETTINGS_KEYS) {
    if (record) {
      // null means "absent before subc installed": remove the member.
      updates[key] =
        record.keys[key] === null ? SETTINGS_DELETE : record.keys[key];
    } else {
      updates[key] = SETTINGS_DELETE;
    }
  }
  const next = spliceSettingsDocument(raw, updates);
  if (next !== raw) atomicWrite(settingsPath, next);
  if (record?.created_file) {
    const { members } = parseTopMembers(next);
    if (members.length === 0) {
      fs.rmSync(settingsPath, { force: true });
      log(`${app}: removed the settings.json subc had created`);
    }
  }
  log(`${app}: restored prior settings (${settingsPath})`);
}

export function claudeVscodeUninstall(options = {}) {
  const host = hostOptions(options);
  const log = options.log || console.log;
  const configDirectory = resolveConfigDir(host);
  let snapshot;
  try {
    snapshot = readSnapshot(configDirectory);
  } catch (error) {
    if (!options.force || !error.corrupt) throw error;
    fs.renameSync(
      snapshotFile(configDirectory),
      `${snapshotFile(configDirectory)}.invalid`,
    );
    log(
      `Set aside the corrupt snapshot file: ${snapshotFile(configDirectory)}.invalid`,
    );
    snapshot = { version: 1, apps: {} };
  }

  const explicit = options.app && options.app !== 'all' ? [options.app] : null;
  let apps = explicit || Object.keys(snapshot.apps);
  // With no records, --force still strips the owned keys from every
  // detected editor; without --force there is nothing safe to do.
  if (apps.length === 0 && options.force) apps = detectedApps(host);
  if (apps.length === 0) {
    log(
      `No snapshot records in ${snapshotFile(configDirectory)}; nothing to restore.`,
    );
    return 0;
  }
  const missing = apps.filter((app) => !snapshot.apps[app]);
  if (missing.length && !options.force)
    throw new Error(
      `No snapshot record for ${missing.join(', ')}; nothing was restored. Re-run with --force to strip the subc-owned keys.`,
    );
  for (const app of apps)
    uninstallApp(app, snapshot.apps[app] || null, { host, log });
  for (const app of apps) delete snapshot.apps[app];
  if (Object.keys(snapshot.apps).length === 0) {
    fs.rmSync(snapshotFile(configDirectory), { force: true });
    log('Removed the snapshot file.');
  } else {
    writeSnapshot(configDirectory, snapshot);
  }
  return 0;
}

export function claudeVscodeStatus(options = {}) {
  const host = hostOptions(options);
  const log = options.log || console.log;
  const configDirectory = resolveConfigDir(host);
  let snapshot = { apps: {} };
  try {
    snapshot = readSnapshot(configDirectory);
  } catch {
    log(
      `snapshot file: present but unreadable (${snapshotFile(configDirectory)}); --force starts over`,
    );
  }
  const scope =
    options.app && options.app !== 'all' ? [options.app] : VSCODE_APPS;
  for (const app of scope) {
    const settingsPath = settingsPathFor(app, host);
    if (!fs.existsSync(settingsPath)) {
      log(`${app}: not detected`);
      continue;
    }
    try {
      const { members } = parseTopMembers(
        fs.readFileSync(settingsPath, 'utf8'),
      );
      const envMember = members.find(
        (member) => member.key === VSCODE_OWNED_SETTINGS_KEYS[0],
      );
      const count = Array.isArray(envMember?.value)
        ? envMember.value.length
        : 0;
      log(
        `${app}: ${count > 0 ? `installed (${count} env vars)` : 'not configured'} (values are never printed)`,
      );
    } catch {
      log(`${app}: settings.json cannot be parsed (${settingsPath})`);
    }
    const record = snapshot.apps[app];
    log(
      `  snapshot: ${record ? `${record.captured_at} (subc ${record.subc_version})` : 'none (uninstall would need --force to strip the keys)'}`,
    );
  }
  return 0;
}

// ── CLI entry (unix) and shared entry (Windows) ──────────────────────────────

const USAGE = `Usage:
  subc claude vscode install   [--app APP] [--api-key KEY] [--model MODEL]
  subc claude vscode uninstall [--app APP] [--force]
  subc claude vscode status    [--app APP]
  subc claude vscode help

APP is one of ${VSCODE_APPS.join(', ')}, or 'all' (default). The install
writes claudeCode.environmentVariables and claudeCode.disableLoginPrompt into
the editor's user settings.json, snapshots the prior values, and the
uninstall restores them exactly.`;

/**
 * `argv` starts at the subcommand ('install', 'uninstall', ...); a leading
 * 'vscode' word from the runbook dispatch is accepted and dropped. `env` is
 * the resolved launch env (runbook env); install resolves the agent env
 * block from it.
 */
export async function claudeVscodeMain(argv, options = {}) {
  const words = argv.filter((word) => !word.startsWith('--'));
  const action = words[words[0] === 'vscode' ? 1 : 0] || 'help';
  const log = options.log || console.log;
  const flags = {};
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--app' || argv[i] === '--vscode-app')
      flags.app = argv[++i];
    else if (argv[i]?.startsWith('--app='))
      flags.app = argv[i].slice('--app='.length);
    else if (argv[i] === '--force') flags.force = true;
  }

  if (['help', '-h', '--help'].includes(action)) {
    log(USAGE);
    return 0;
  }
  const agent = options.agent || agentById('claude-code');
  const env = options.env || process.env;
  const shared = {
    ...hostOptions(options, env),
    log,
    app: flags.app || env.VSCODE_APP?.trim() || '',
    force: flags.force,
  };
  if (!['install', 'uninstall', 'status'].includes(action)) {
    console.error(`Unknown vscode command: ${action}`);
    console.error(USAGE);
    return 1;
  }
  if (action === 'install') return claudeVscodeInstall(agent, env, shared);
  if (action === 'uninstall') return claudeVscodeUninstall(shared);
  return claudeVscodeStatus(shared);
}

if (process.argv[1]?.endsWith('claude-vscode.js')) {
  const code = await claudeVscodeMain(process.argv.slice(2), {
    env: process.env,
  });
  process.exitCode = code;
}
