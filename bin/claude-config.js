import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  changedKeys,
  changedMcpServers,
  mcpServersOf,
} from './claude-config-drift.js';
import { copyUnindexedPlugins } from './claude-config-plugins.js';
import { configDir } from './profiles.js';

// Prepares the isolated Claude Code config dir (CLAUDE_CONFIG_DIR) for a subc
// launch. Isolation exists to stop one leak: a /model pick inside subc landing
// in ~/.claude/settings.json and changing plain `claude`. Everything else the
// user set up in ~/.claude must keep working inside subc, so this dir links
// back to it and rebuilds the files Claude Code keeps per config dir.
//
// The one rule: preparing never writes, moves or deletes anything the user's
// own Claude Code reads. It writes only inside the isolated dir, and refuses a
// dir that resolves to ~/.claude, into it, or to a folder that holds it.

// Folders of ~/.claude that subc sessions share through a link: the user's
// rules, skills and hooks, session history so resume and `subc` session lists
// see one set of sessions, and the editor lock files so /ide finds the editor.
// A missing one is created in ~/.claude first, so something made inside subc
// (a first agent, a first skill) still lands in ~/.claude.
const SHARED_DIRS = [
  'rules',
  'agents',
  'commands',
  'skills',
  'output-styles',
  'hooks',
  'projects',
  'file-history',
  'todos',
  'plans',
  'ide',
];

// Files of ~/.claude shared through a link when the user has them.
const SHARED_FILES = ['CLAUDE.md', 'history.jsonl', 'keybindings.json'];

/** Every entry of ~/.claude that subc sessions share through a link. */
export const SHARED_ENTRIES = Object.freeze([...SHARED_FILES, ...SHARED_DIRS]);

// What the last launch wrote into the subc copies, to find what a session
// changed there before the next rebuild replaces it.
const WRITTEN_FILE = '.subc-written.json';

// Plugin index files copied into the subc plugins dir on each launch. The
// install paths inside still point at ~/.claude/plugins/cache, which Claude
// Code treats as outside its own cache root: a subc session can load those
// plugins but never marks them orphaned or deletes them. The cache itself is
// never linked, so an uninstall or cache sweep in subc cannot reach it.
const PLUGIN_INDEX_FILES = [
  'installed_plugins.json',
  'known_marketplaces.json',
  'blocklist.json',
  'config.json',
];

// User settings keys subc owns inside its sessions. `model` is the leak this
// isolation exists for; the subc value survives each rebuild.
const SUBC_OWNED_SETTINGS = ['model'];
// User settings keys dropped because they would replace the gateway credential.
const DROPPED_SETTINGS = ['apiKeyHelper'];

// ~/.claude.json keys copied in. Login state (oauthAccount, primaryApiKey)
// never is: subc sessions authenticate with the gateway token.
const COPIED_STATE = ['mcpServers', 'hasCompletedOnboarding', 'theme'];
const COPIED_PROJECT_STATE = [
  'mcpServers',
  'enabledMcpjsonServers',
  'disabledMcpjsonServers',
  'hasTrustDialogAccepted',
  'allowedTools',
];

const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function pick(source, keys) {
  return Object.fromEntries(
    keys
      .filter((key) => Object.hasOwn(source, key))
      .map((key) => [key, source[key]]),
  );
}

/** Text of a regular file (links followed), `undefined` when missing. */
function readRegularFile(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  // A FIFO or device would block or stream forever.
  if (!stat.isFile()) throw new Error('not a regular file');
  return fs.readFileSync(file, 'utf8');
}

/** Parsed JSON object, `undefined` when missing; throws when invalid. */
function readJsonObject(file) {
  const text = readRegularFile(file);
  if (text === undefined) return undefined;
  const value = JSON.parse(text);
  if (!isObject(value)) throw new Error('not a JSON object');
  return value;
}

// The temp name is unguessable and created exclusively, so a planted link at
// that name cannot redirect the write. The rename replaces a link at `file`
// with a regular file instead of writing through it.
function writeAtomic(file, text, mode = 0o644) {
  const temp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temp, text, { mode, flag: 'wx' });
  try {
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

const writeJsonAtomic = (file, value, mode) =>
  writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`, mode);

function lstatOrUndefined(file) {
  try {
    return fs.lstatSync(file);
  } catch {
    return undefined;
  }
}

/** The real path, resolving the nearest existing ancestor of a missing one. */
function realPath(file) {
  const missing = [];
  let current = path.resolve(file);
  for (;;) {
    try {
      // .native returns the on-disk case, so ~/.CLAUDE resolves to ~/.claude.
      return path.join(fs.realpathSync.native(current), ...missing);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(file);
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

/** Device and inode of `file` (links followed), `undefined` when missing. */
function identity(file) {
  try {
    const stat = fs.statSync(file);
    return `${stat.dev}:${stat.ino}`;
  } catch {
    return undefined;
  }
}

/** Identities of `file` and every folder above it. */
function selfAndAncestors(file) {
  const ids = new Set();
  let current = realPath(file);
  for (;;) {
    const id = identity(current);
    if (id) ids.add(id);
    const parent = path.dirname(current);
    if (parent === current) return ids;
    current = parent;
  }
}

// Files of the user's own config that prepare must never replace, paired
// with the path in the subc dir that prepare writes.
// A plugins link from an earlier build is unlinked, never written through,
// before the plugin files are written, so its target needs no check.
function guardedWrites(dir, source, stateFile) {
  const pluginsLink = lstatOrUndefined(path.join(dir, 'plugins'));
  const plugins = pluginsLink?.isSymbolicLink() ? [] : PLUGIN_INDEX_FILES;
  return [
    [path.join(source, 'settings.json'), path.join(dir, 'settings.json')],
    [stateFile, path.join(dir, '.claude.json')],
    ...plugins.map((name) => [
      path.join(source, 'plugins', name),
      path.join(dir, 'plugins', name),
    ]),
  ];
}

/**
 * Why `dir` must not be prepared, or `undefined` when it is safe. Compares
 * file identities, not path text, so no spelling, case or link can alias the
 * user's config into the dir.
 */
function unsafeDirReason(dir, source, stateFile) {
  if (!path.isAbsolute(dir)) return `${dir} is not an absolute path`;
  const sourceId = identity(source);
  if (sourceId && selfAndAncestors(dir).has(sourceId)) {
    return `${dir} resolves into your Claude config ${source}`;
  }
  const dirIds = selfAndAncestors(dir);
  for (const name of [...SHARED_ENTRIES, 'plugins']) {
    const targetId = identity(path.join(source, name));
    if (targetId && dirIds.has(targetId)) {
      return `${dir} resolves into the folder behind ${path.join(source, name)}`;
    }
  }
  const dirId = identity(dir);
  const homeJson = identity(path.dirname(realPath(stateFile)));
  if (dirId && (selfAndAncestors(source).has(dirId) || dirId === homeJson)) {
    return `${dir} resolves to a folder that holds your Claude config`;
  }
  for (const [user, own] of guardedWrites(dir, source, stateFile)) {
    const userId = identity(user);
    // A link at `own` is replaced by the rename, never written through.
    if (lstatOrUndefined(own)?.isSymbolicLink()) continue;
    if (userId && userId === identity(own)) {
      return `${own} is your own ${path.basename(user)}`;
    }
  }
  return undefined;
}

function sameFile(a, b) {
  try {
    const left = fs.statSync(a);
    const right = fs.statSync(b);
    return left.dev === right.dev && left.ino === right.ino;
  } catch {
    return false;
  }
}

function linkEntry(target, link) {
  const isDir = fs.statSync(target).isDirectory();
  try {
    // Junctions need no privilege on Windows; elsewhere the type is ignored.
    fs.symlinkSync(target, link, isDir ? 'junction' : 'file');
  } catch (error) {
    // Windows file symlinks need Developer Mode; a hard link shares the file.
    if (isDir || process.platform !== 'win32') throw error;
    fs.linkSync(target, link);
  }
}

function shareEntry(dir, source, name, warnings) {
  const target = path.join(source, name);
  const link = path.join(dir, name);
  let existing = lstatOrUndefined(link);
  // A link from an earlier launch can point at another source. Removing a
  // link never touches its target.
  if (
    existing?.isSymbolicLink() &&
    path.resolve(dir, fs.readlinkSync(link)) !== path.resolve(target)
  ) {
    fs.unlinkSync(link);
    existing = undefined;
  }
  if (SHARED_DIRS.includes(name) && !fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  if (!fs.existsSync(target)) return;
  if (existing?.isSymbolicLink() || (existing && sameFile(link, target))) {
    return;
  }
  if (existing) {
    warnings.push(
      `${link} is a real ${existing.isDirectory() ? 'directory' : 'file'}, so subc sessions do not share ${target}; move it aside to share it.`,
    );
    return;
  }
  linkEntry(target, link);
}

function shareEntries(dir, source, warnings) {
  for (const name of SHARED_ENTRIES) {
    try {
      shareEntry(dir, source, name, warnings);
    } catch (error) {
      warnings.push(
        `Could not share ${path.join(source, name)}: ${error.message}`,
      );
    }
  }
}

function copyPluginIndex(dir, source, warnings) {
  const own = path.join(dir, 'plugins');
  const existing = lstatOrUndefined(own);
  // An earlier build linked the whole folder. Removing a link never touches
  // its target.
  if (existing?.isSymbolicLink()) fs.unlinkSync(own);
  else if (existing && !existing.isDirectory()) {
    warnings.push(`${own} is not a directory, so plugins are not shared.`);
    return;
  }
  fs.mkdirSync(own, { recursive: true });
  for (const name of PLUGIN_INDEX_FILES) {
    try {
      const text = readRegularFile(path.join(source, 'plugins', name));
      if (text !== undefined) writeAtomic(path.join(own, name), text, 0o600);
    } catch (error) {
      warnings.push(
        `Could not copy ${path.join(source, 'plugins', name)}: ${error.message}`,
      );
    }
  }
}

function rebuildSettings(dir, source, launchEnvNames, written, warnings) {
  const file = path.join(dir, 'settings.json');
  let user = {};
  try {
    user = readJsonObject(path.join(source, 'settings.json')) ?? {};
  } catch (error) {
    warnings.push(
      `Ignored ${path.join(source, 'settings.json')} in subc sessions: ${error.message}`,
    );
  }
  let current = {};
  try {
    current = readJsonObject(file) ?? {};
  } catch {
    current = {};
  }
  const settings = { ...user };
  for (const key of [...SUBC_OWNED_SETTINGS, ...DROPPED_SETTINGS]) {
    delete settings[key];
  }
  if (isObject(user.env)) {
    const env = Object.fromEntries(
      Object.entries(user.env).filter(([name]) => !launchEnvNames.has(name)),
    );
    if (Object.keys(env).length) settings.env = env;
    else delete settings.env;
  }
  const lost = written
    ? changedKeys(written, current, SUBC_OWNED_SETTINGS)
    : [];
  if (lost.length) {
    const saved = path.join(dir, 'settings.discarded.json');
    writeJsonAtomic(saved, current, 0o600);
    warnings.push(
      `Settings changed inside your last subc session are not kept: ${lost.join(', ')}. They are saved in ${saved}. To keep them, add them in plain claude.`,
    );
  }
  const next = { ...settings, ...pick(current, SUBC_OWNED_SETTINGS) };
  writeJsonAtomic(file, next);
  return next;
}

function mergeProjects(current, user) {
  const projects = isObject(current) ? { ...current } : {};
  for (const [project, state] of Object.entries(user)) {
    if (!isObject(state)) continue;
    const copied = pick(state, COPIED_PROJECT_STATE);
    if (!Object.keys(copied).length) continue;
    const existing = isObject(projects[project]) ? projects[project] : {};
    projects[project] = { ...existing, ...copied };
  }
  return projects;
}

function syncState(dir, stateFile, written, warnings) {
  const file = path.join(dir, '.claude.json');
  let user;
  let current;
  try {
    user = readJsonObject(stateFile);
  } catch (error) {
    warnings.push(`Ignored ${stateFile} in subc sessions: ${error.message}`);
    return undefined;
  }
  if (!user) return undefined;
  try {
    current = readJsonObject(file) ?? {};
  } catch (error) {
    warnings.push(`Left ${file} unchanged: ${error.message}`);
    return undefined;
  }
  const lost = written ? changedMcpServers(written, mcpServersOf(current)) : [];
  if (lost.length) {
    const saved = path.join(dir, 'mcp.discarded.json');
    writeJsonAtomic(saved, mcpServersOf(current), 0o600);
    warnings.push(
      `MCP servers added inside your last subc session are not kept: ${lost.join(', ')}. They are saved in ${saved}. To keep them, add them in plain claude.`,
    );
  }
  const next = { ...current, ...pick(user, COPIED_STATE) };
  if (isObject(user.projects)) {
    next.projects = mergeProjects(current.projects, user.projects);
  }
  writeJsonAtomic(file, next, 0o600);
  return mcpServersOf(next);
}

/** A JSON object, or `undefined` when missing or invalid; errors are reported elsewhere. */
function readQuietly(file) {
  try {
    return readJsonObject(file);
  } catch {
    return undefined;
  }
}

/**
 * Make sure `dir` is a subc dir: an earlier launch's marker, or a new or
 * empty folder that is claimed now. Returns why a folder is not one, or
 * `undefined`. A Claude config folder that subc did not make is never
 * prepared, wherever it sits.
 */
function claimDir(dir) {
  const marker = path.join(dir, WRITTEN_FILE);
  if (lstatOrUndefined(marker)) return undefined;
  const existing = lstatOrUndefined(dir);
  if (existing) {
    const holdsConfig = ['settings.json', '.claude.json', 'projects'].some(
      (name) => lstatOrUndefined(path.join(dir, name)),
    );
    if (holdsConfig) {
      return `${dir} holds a Claude config that subc did not make. If it is an old subc folder, rename it and launch again.`;
    }
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeJsonAtomic(marker, {}, 0o600);
  return undefined;
}

function readWritten(dir) {
  try {
    return readJsonObject(path.join(dir, WRITTEN_FILE)) ?? {};
  } catch {
    return {};
  }
}

/**
 * Make `dir` a Claude Code config dir that shares the user's ~/.claude setup
 * and keeps only subc's own settings apart. Never writes into ~/.claude except
 * to create ~/.claude/projects, and never deletes anything there. Problems
 * come back as warnings; preparing never throws, so a launch always proceeds.
 *
 * `source` is the user's own Claude config folder (~/.claude, or their
 * CLAUDE_CONFIG_DIR) and `stateFile` its .claude.json (~/.claude.json, or
 * .claude.json inside their CLAUDE_CONFIG_DIR).
 *
 * @param {{ dir: string, home?: string, source?: string, stateFile?: string,
 *   launchEnvNames?: Iterable<string> }} options
 * @returns {{ warnings: string[], refused: boolean }} `refused` means the
 *   dir aliases the user's own config; the launch must not run on it.
 */
export function prepareClaudeConfigDir({
  dir,
  home = os.homedir(),
  source = path.join(home, '.claude'),
  stateFile = path.join(home, '.claude.json'),
  launchEnvNames = [],
}) {
  const warnings = [];
  let unsafe = unsafeDirReason(dir, source, stateFile);
  if (!unsafe) {
    try {
      unsafe = claimDir(dir);
    } catch (error) {
      unsafe = `could not create it: ${error.message}`;
    }
  }
  if (unsafe) {
    warnings.push(
      `Refused to use ${dir} as the subc Claude config dir: ${unsafe}. Claude Code would write into your own config there. Point SUBC_CONFIG_DIR somewhere else, or run subc claude --no-isolate.`,
    );
    return { warnings, refused: true };
  }
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    shareEntries(dir, source, warnings);
    copyPluginIndex(dir, source, warnings);
    copyUnindexedPlugins({
      dir,
      source,
      enabledPlugins: readQuietly(path.join(source, 'settings.json'))
        ?.enabledPlugins,
      indexed: readQuietly(
        path.join(source, 'plugins', 'installed_plugins.json'),
      )?.plugins,
      warnings,
    });
    const written = readWritten(dir);
    const settings = rebuildSettings(
      dir,
      source,
      new Set(launchEnvNames),
      written.settings,
      warnings,
    );
    const mcp = syncState(dir, stateFile, written.mcp, warnings);
    writeJsonAtomic(path.join(dir, WRITTEN_FILE), { settings, mcp }, 0o600);
  } catch (error) {
    warnings.push(
      `Could not prepare the subc Claude config dir ${dir}: ${error.message}`,
    );
  }
  return { warnings, refused: false };
}

// Carries the user's own config folder into a subc session, so a `subc
// claude` started inside it shares from that folder, not from the subc dir
// its shell now has as CLAUDE_CONFIG_DIR.
const SOURCE_ENV = 'SUBC_CLAUDE_CONFIG_SOURCE';

// CLAUDE_CODE_ISOLATE values that opt out; the launch runs on the user's
// own folder and nothing is prepared.
const ISOLATE_OFF = new Set(['off', '0', 'false', 'no']);

/**
 * Whether `folder` is a Claude config folder Claude Code has used: a typo or
 * a code repo would otherwise get shared folders created in it.
 */
function looksLikeClaudeConfig(folder) {
  return ['settings.json', '.claude.json', 'projects'].some((name) =>
    fs.existsSync(path.join(folder, name)),
  );
}

/**
 * The user's own Claude config folder for a launch: the one carried from an
 * outer subc session, else their CLAUDE_CONFIG_DIR, else ~/.claude. The subc
 * dir itself is never a source.
 */
function launchSource(inputEnv, dir, home, warnings) {
  const fallback = {
    source: path.join(home, '.claude'),
    stateFile: path.join(home, '.claude.json'),
  };
  for (const name of [SOURCE_ENV, 'CLAUDE_CONFIG_DIR']) {
    const value = inputEnv[name]?.trim();
    if (!value) continue;
    if (!path.isAbsolute(value)) {
      warnings.push(
        `${name}=${value} is not an absolute path, so subc sessions share ~/.claude instead.`,
      );
      return fallback;
    }
    if (identity(value) && identity(value) === identity(dir)) continue;
    if (path.resolve(value) === path.resolve(dir)) continue;
    if (!looksLikeClaudeConfig(value)) {
      warnings.push(
        `${name}=${value} is not a Claude config folder, so subc sessions share ~/.claude instead.`,
      );
      return fallback;
    }
    return { source: value, stateFile: path.join(value, '.claude.json') };
  }
  return fallback;
}

/**
 * The Claude config folder plain `claude` uses: the source a subc launch
 * shares from. `subc sessions` reads Claude sessions there.
 *
 * @param {{ env?: Record<string, string | undefined>, home?: string }} [options]
 * @returns {string}
 */
export function claudeSourceDir({
  env = process.env,
  home = os.homedir(),
} = {}) {
  const subcBase =
    env.SUBC_CONFIG_DIR?.trim() || path.join(home, '.subconscious');
  return launchSource(env, path.join(subcBase, 'claude-code'), home, []).source;
}

/**
 * Prepare the subc config dir for a planned Claude Code launch. It shares
 * the folder the user's plain `claude` uses. An opted-out launch (no
 * CLAUDE_CONFIG_DIR) is left alone.
 *
 * @param {{ env: { name: string }[] }} agent
 * @param {Record<string, string | undefined>} launchEnv the planned launch env
 * @param {Record<string, string | undefined>} inputEnv the env before planning
 * @param {{ home?: string, subcDir?: string }} [options] `subcDir` is the
 *   subc config dir; it defaults to $SUBC_CONFIG_DIR/claude-code
 * @returns {{ warnings: string[], refused: boolean,
 *   env: Record<string, string> }} `env` goes into the launch env
 */
export function prepareClaudeLaunch(agent, launchEnv, inputEnv, options = {}) {
  const none = { warnings: [], refused: false, env: {} };
  const dir = launchEnv.CLAUDE_CONFIG_DIR?.trim();
  if (!dir) return none;
  const isolate = String(launchEnv.CLAUDE_CODE_ISOLATE ?? '')
    .trim()
    .toLowerCase();
  // Opted out: CLAUDE_CONFIG_DIR is the user's own folder.
  if (ISOLATE_OFF.has(isolate)) return none;
  const home = options.home ?? os.homedir();
  // Only the subc dir itself is ever prepared, whatever the launch env says.
  const subcBase =
    launchEnv.SUBC_CONFIG_DIR?.trim() ||
    (options.home ? path.join(home, '.subconscious') : configDir());
  const subcDir = options.subcDir ?? path.join(subcBase, 'claude-code');
  if (path.resolve(dir) !== path.resolve(subcDir)) return none;
  const warnings = [];
  const { source, stateFile } = launchSource(inputEnv, dir, home, warnings);
  const launchEnvNames = agent.env.map((entry) => entry.name);
  const prepared = prepareClaudeConfigDir({
    dir,
    home,
    source,
    stateFile,
    launchEnvNames,
  });
  return {
    warnings: [...warnings, ...prepared.warnings],
    refused: prepared.refused,
    env: { [SOURCE_ENV]: source },
  };
}
