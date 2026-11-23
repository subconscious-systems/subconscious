/**
 * Everything subc knows about T3 Code's server settings file lives here.
 *
 * T3 Code keeps its providers in `<T3 home>/userdata/settings.json`, under
 * `providerInstances`. Each entry is an envelope
 * `{ driver, displayName, enabled, environment?, config }`, and each driver
 * keeps its own fields (`binaryPath`, `homePath`, ...) in `config`. T3
 * watches the file and reloads it about 100 ms after a change, so a write
 * here takes effect without restarting T3.
 *
 * subc owns one entry per provider, such as `subconscious-codex`. It never
 * changes another entry, the secret store, the default provider, or text
 * generation. An entry is subc's when it has the provider's driver and its
 * binary is the launcher subc wrote.
 *
 * The one other write is the hide list of a provider with a built-in twin,
 * such as Claude: `providerModelPreferences[<subc instance id>]`. It is
 * keyed by subc's own instance id, and subc never changes another key in
 * `providerModelPreferences`.
 *
 * Every function takes a `target`: the T3 home, the launcher path, the agent
 * home path when the provider has one, and the provider descriptor from
 * `t3-providers.js`. A target with no provider means Codex.
 */

import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CODEX_PROVIDER } from './t3-providers.js';

// The Codex values, kept for callers and tests that name them.
export const T3_INSTANCE_ID = CODEX_PROVIDER.instanceId;
export const T3_DISPLAY_NAME = CODEX_PROVIDER.displayName;

const providerOf = (target) => target.provider ?? CODEX_PROVIDER;
const MAX_WRITE_ATTEMPTS = 5;
const MAX_BACKUPS = 10;
// T3 debounces its settings watcher by 100 ms. Wait longer than that before
// reading the file back to see whether the entry survived T3's reload.
const DEFAULT_SETTLE_MS = 400;

const isObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

class SettingsChanged extends Error {}

/** T3 Code's data directory: T3CODE_HOME, or ~/.t3. */
export function t3HomeDir(env = process.env, home = os.homedir()) {
  const configured = env.T3CODE_HOME?.trim();
  return path.resolve(configured || path.join(home, '.t3'));
}

function t3Files(home) {
  const userdata = path.join(home, 'userdata');
  return {
    home,
    userdata,
    settings: path.join(userdata, 'settings.json'),
    runtime: path.join(userdata, 'server-runtime.json'),
    version: path.join(userdata, 'desktop-last-started-version'),
  };
}

async function readText(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** The managed policy T3 reported when its server last started. */
async function managedPolicy(file) {
  const text = await readText(file);
  if (text === null) return { state: 'none' };
  try {
    const runtime = JSON.parse(text);
    if (!isObject(runtime)) return { state: 'unreadable' };
    const policy = runtime.managedPolicy;
    return policy === undefined || policy === null
      ? { state: 'none' }
      : { state: 'present' };
  } catch {
    return { state: 'unreadable' };
  }
}

async function t3Version(files) {
  const desktop = (await readText(files.version))?.trim();
  if (desktop) return desktop;
  try {
    const runtime = JSON.parse((await readText(files.runtime)) ?? 'null');
    return typeof runtime?.serverVersion === 'string'
      ? runtime.serverVersion
      : null;
  } catch {
    return null;
  }
}

/**
 * The file to write. A symlinked settings file is written through only when
 * its target is a regular file in a directory this user owns and other users
 * cannot write; T3 itself follows the link.
 */
async function writeTarget(settingsPath) {
  const uid = process.getuid?.();
  const link = await fs.lstat(settingsPath);
  let target = settingsPath;
  if (link.isSymbolicLink()) {
    try {
      target = await fs.realpath(settingsPath);
    } catch {
      return { problem: `${settingsPath} is a link to a missing file` };
    }
  } else if (!link.isFile()) {
    return { problem: `${settingsPath} is not a regular file` };
  }
  const file = await fs.lstat(target);
  const dir = await fs.stat(path.dirname(target));
  // World-writable is refused; group-writable is not, because Linux user
  // private groups make 0664 the normal mode there.
  const unsafe =
    !file.isFile() ||
    (uid !== undefined && (file.uid !== uid || dir.uid !== uid)) ||
    (file.mode & 0o002) !== 0 ||
    (dir.mode & 0o002) !== 0;
  if (unsafe) {
    return {
      problem: link.isSymbolicLink()
        ? `${settingsPath} links to ${target}, which is not a private regular file owned by you`
        : `${settingsPath} is writable by other users or not owned by you`,
    };
  }
  return { target, symlink: link.isSymbolicLink(), mode: file.mode & 0o7777 };
}

function parseSettings(text) {
  let settings;
  try {
    settings = JSON.parse(text);
  } catch (error) {
    return { problem: `settings.json is not valid JSON (${error.message})` };
  }
  if (!isObject(settings))
    return { problem: 'settings.json is not a JSON object' };
  if ('providers' in settings && !('providerInstances' in settings)) {
    // T3 migrates the old `providers` block into `providerInstances` when it
    // starts. Writing beside an unmigrated file could race that migration.
    return {
      unsupported:
        'settings.json still uses the old providers format. Open T3 Code once so it migrates the file, then retry.',
    };
  }
  if (
    'providerInstances' in settings &&
    !isObject(settings.providerInstances)
  ) {
    return { unsupported: 'settings.json providerInstances is not an object' };
  }
  return { settings };
}

// T3 Code expands a leading ~ in binaryPath, and a symlink to the launcher
// runs the launcher, so both count as the same file.
function canonicalPath(file) {
  const expanded =
    file === '~' || file.startsWith('~/')
      ? path.join(os.homedir(), file.slice(1))
      : file;
  const resolved = path.resolve(expanded);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function sameFile(left, right) {
  return (
    typeof left === 'string' &&
    typeof right === 'string' &&
    canonicalPath(left) === canonicalPath(right)
  );
}

function launcherOf(entry) {
  return isObject(entry?.config) ? entry.config.binaryPath : undefined;
}

/** True when the entry has the provider's driver and runs subc's launcher. */
function isOwnedEntry(entry, target) {
  return (
    isObject(entry) &&
    entry.driver === providerOf(target).driver &&
    sameFile(launcherOf(entry), target.launcherPath)
  );
}

const ENVELOPE_FIELDS = Object.freeze({
  driver: true,
  displayName: true,
  enabled: true,
});

/** The managed fields that differ from what subc writes. */
function driftOf(entry, target) {
  const provider = providerOf(target);
  const drift = [];
  if (entry.displayName !== provider.displayName) drift.push('displayName');
  if (entry.enabled === false) drift.push('enabled');
  // binaryPath decides ownership, so a ~ path or a symlink is not drift.
  // A config field with an envelope field's name, such as OpenCode's
  // config.enabled, is reported with its config. prefix.
  for (const [field, value] of Object.entries(provider.managedConfig(target))) {
    if (field !== 'binaryPath' && entry.config?.[field] !== value)
      drift.push(field in ENVELOPE_FIELDS ? `config.${field}` : field);
  }
  for (const field of provider.clearedFields) {
    const value = entry.config?.[field];
    if (value !== undefined && value !== '') drift.push(field);
  }
  return drift;
}

/**
 * The entry subc writes. A repaired entry keeps the fields subc does not
 * manage, such as an accent color or custom models.
 */
function expectedEntry(target, current = {}) {
  const provider = providerOf(target);
  const config = { ...(isObject(current.config) ? current.config : {}) };
  for (const field of provider.clearedFields) delete config[field];
  Object.assign(config, provider.managedConfig(target));
  return {
    ...current,
    driver: provider.driver,
    displayName: provider.displayName,
    enabled: true,
    config,
  };
}

function survived(entry, target) {
  return (
    isOwnedEntry(entry, target) &&
    entry.enabled !== false &&
    driftOf(entry, target).length === 0
  );
}

/**
 * Look at T3 Code's settings without changing anything. `target` names the
 * provider, its launcher, and the agent home subc's entry should use.
 *
 * `state` is one of missing, malformed, unsupported, unsafe, or ok. `entry`
 * is absent, owned, or conflict, and `duplicates` lists other instance ids
 * that run the same launcher.
 */
export async function inspectT3(target) {
  const files = t3Files(target.home);
  const report = {
    home: files.home,
    settingsPath: files.settings,
    version: await t3Version(files),
    policy: (await managedPolicy(files.runtime)).state,
    state: 'ok',
    problem: null,
    symlink: false,
    entry: 'absent',
    drift: [],
    duplicates: [],
  };
  try {
    await fs.lstat(files.settings);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    report.state = 'missing';
    report.problem = `${files.settings} does not exist. Open T3 Code once so it creates its settings, then retry.`;
    return report;
  }
  const writable = await writeTarget(files.settings);
  if (writable.problem) {
    report.state = 'unsafe';
    report.problem = writable.problem;
    return report;
  }
  report.symlink = writable.symlink;
  const text = await fs.readFile(writable.target, 'utf8');
  const parsed = parseSettings(text);
  if (parsed.problem || parsed.unsupported) {
    report.state = parsed.problem ? 'malformed' : 'unsupported';
    report.problem = parsed.problem || parsed.unsupported;
    return report;
  }
  const { instanceId } = providerOf(target);
  const instances = parsed.settings.providerInstances ?? {};
  const ours = instances[instanceId];
  if (ours !== undefined) {
    if (isOwnedEntry(ours, target)) {
      report.entry = 'owned';
      report.drift = driftOf(ours, target);
    } else {
      report.entry = 'conflict';
      report.problem = `T3 Code already has a provider named ${instanceId} that subc did not create. Rename or remove it in T3 Code, then retry.`;
    }
  }
  report.duplicates = Object.entries(instances)
    .filter(([id, entry]) => id !== instanceId && isOwnedEntry(entry, target))
    .map(([id]) => id);
  return report;
}

/** Problems that stop subc from writing the settings file, if any. */
export function settingsBlockers(report, { forRemoval = false } = {}) {
  const blockers = [];
  if (report.policy === 'present')
    blockers.push(
      'T3 Code runs under a managed policy, so subc does not edit its settings. Ask your administrator to add the provider.',
    );
  if (report.policy === 'unreadable')
    blockers.push(
      `${path.join(report.home, 'userdata', 'server-runtime.json')} is not valid JSON, so subc cannot tell whether a managed policy applies.`,
    );
  if (report.state !== 'ok') blockers.push(report.problem);
  // Removal skips a foreign entry with subc's id instead of failing on it.
  if (!forRemoval && report.entry === 'conflict') blockers.push(report.problem);
  if (!forRemoval && report.duplicates.length)
    blockers.push(
      `T3 Code already runs the Subconscious launcher as provider ${report.duplicates.join(', ')}. Remove that provider in T3 Code, then retry.`,
    );
  return blockers;
}

function indentOf(text) {
  const match = /^\{\r?\n([ \t]+)\S/.exec(text);
  return match ? match[1] : 2;
}

function render(settings, previous) {
  return `${JSON.stringify(settings, null, indentOf(previous))}\n`;
}

/** Copy the current file aside, private to this user, keeping the last ten. */
async function backup(text, backupDir) {
  await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(
    backupDir,
    `settings-${stamp}-${randomBytes(2).toString('hex')}.json`,
  );
  await fs.writeFile(file, text, { mode: 0o600, flag: 'wx' });
  const backups = (await fs.readdir(backupDir))
    .filter((name) => /^settings-.*\.json$/.test(name))
    .sort();
  for (const name of backups.slice(0, -MAX_BACKUPS))
    await fs.rm(path.join(backupDir, name), { force: true });
  return file;
}

/**
 * Replace the file when it still holds `expected`. The new text goes to a
 * temp file beside the target with the target's mode, and a rename puts it in
 * place, so T3 never reads half a file.
 *
 * The check and the rename are two steps. A T3 Code save that lands between
 * them is lost. T3 Code takes no lock that subc could share, so this only
 * keeps the window small: the compare runs right before the rename. T3 Code
 * saves only when the user changes a setting.
 */
async function replaceIfUnchanged(target, mode, expected, next) {
  const temp = path.join(
    path.dirname(target),
    `.settings.json.subc-${process.pid}-${randomBytes(4).toString('hex')}`,
  );
  await fs.writeFile(temp, next, { mode, flag: 'wx' });
  try {
    await fs.chmod(temp, mode);
    if ((await readText(target)) !== expected) throw new SettingsChanged();
    await fs.rename(temp, target);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Apply `change(settings)` to the file: read, change, write if the file did
 * not move underneath, and retry from a fresh read when it did. `change`
 * returns null when there is nothing to write.
 */
async function edit(target, backupDir, change) {
  const files = t3Files(target.home);
  let backedUp = null;
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const writable = await writeTarget(files.settings);
    if (writable.problem) throw new Error(writable.problem);
    const text = await readText(writable.target);
    if (text === null) throw new Error(`${files.settings} disappeared`);
    const parsed = parseSettings(text);
    if (parsed.problem || parsed.unsupported)
      throw new Error(parsed.problem || parsed.unsupported);
    const next = change(parsed.settings);
    if (next === null) return { changed: false, backup: backedUp };
    backedUp ??= await backup(text, backupDir);
    try {
      await replaceIfUnchanged(
        writable.target,
        writable.mode,
        text,
        render(next, text),
      );
      return { changed: true, backup: backedUp };
    } catch (error) {
      if (!(error instanceof SettingsChanged)) throw error;
    }
  }
  throw new Error(
    `${files.settings} kept changing while subc tried to update it. Retry when T3 Code is idle.`,
  );
}

async function readEntry(target) {
  const text = await readText(t3Files(target.home).settings);
  const parsed = text === null ? {} : parseSettings(text);
  return parsed.settings?.providerInstances?.[providerOf(target).instanceId];
}

/**
 * Add or repair subc's provider entry, then wait out T3's reload and read the
 * file again to confirm the entry is still there. Throws when the settings
 * are blocked or the entry did not survive.
 */
export async function installT3Provider(target, options = {}) {
  const { backupDir, settleMs = DEFAULT_SETTLE_MS } = options;
  const { instanceId } = providerOf(target);
  const blockers = settingsBlockers(await inspectT3(target));
  if (blockers.length) throw new Error(blockers.join('\n'));
  let result = { changed: false, backup: null };
  for (let attempt = 0; attempt < 3; attempt++) {
    const written = await edit(target, backupDir, (settings) => {
      const instances = { ...(settings.providerInstances ?? {}) };
      const current = instances[instanceId];
      if (current !== undefined && !isOwnedEntry(current, target))
        throw new Error(
          `T3 Code now has a provider named ${instanceId} that subc did not create.`,
        );
      const next = expectedEntry(target, current);
      if (
        current !== undefined &&
        JSON.stringify(current) === JSON.stringify(next)
      )
        return null;
      instances[instanceId] = next;
      return { ...settings, providerInstances: instances };
    });
    result = {
      changed: result.changed || written.changed,
      backup: result.backup ?? written.backup,
    };
    await sleep(settleMs);
    if (survived(await readEntry(target), target)) return result;
  }
  throw new Error(
    `T3 Code did not keep the ${instanceId} provider in its settings. Check ${t3Files(target.home).settings}.`,
  );
}

/**
 * Remove subc's entry and nothing else. Threads and other providers stay.
 * With `preferences`, also remove subc's hide list, the instance's key in
 * `providerModelPreferences`, in the same write, and report it as
 * `removedPreferences`. Returns what was removed;
 * a foreign entry with the same id, and its preferences, are left alone.
 */
export async function removeT3Provider(target, options = {}) {
  const preferences = Boolean(options.preferences);
  const none = {
    removed: false,
    ...(preferences ? { removedPreferences: false } : {}),
    backup: null,
  };
  const report = await inspectT3(target);
  if (report.state === 'missing') return none;
  const blockers = settingsBlockers(report, { forRemoval: true });
  if (blockers.length) throw new Error(blockers.join('\n'));
  if (report.entry === 'conflict') return none;
  if (report.entry !== 'owned' && !preferences) return none;
  const { instanceId } = providerOf(target);
  let removed = false;
  let removedPreferences = false;
  const written = await edit(target, options.backupDir, (settings) => {
    removed = false;
    removedPreferences = false;
    const next = { ...settings };
    const instances = settings.providerInstances ?? {};
    const current = instances[instanceId];
    if (current !== undefined) {
      if (!isOwnedEntry(current, target)) return null;
      const rest = { ...instances };
      delete rest[instanceId];
      next.providerInstances = rest;
      removed = true;
    }
    const prefs = settings.providerModelPreferences;
    if (preferences && isObject(prefs) && Object.hasOwn(prefs, instanceId)) {
      const rest = { ...prefs };
      delete rest[instanceId];
      next.providerModelPreferences = rest;
      removedPreferences = true;
    }
    return removed || removedPreferences ? next : null;
  });
  return {
    removed: written.changed && removed,
    ...(preferences
      ? { removedPreferences: written.changed && removedPreferences }
      : {}),
    backup: written.backup,
  };
}

/**
 * T3 Code's model cache for one instance, `<T3 home>/caches/<id>.json`, or
 * null when it is missing or unreadable. The file is the provider snapshot
 * itself. `slugs` lists its models in order, and `checkedAt` is the time of
 * the probe that wrote it, in ms, or null.
 */
export async function readT3ModelCache(home, instanceId) {
  const file = path.join(home, 'caches', `${instanceId}.json`);
  let snapshot;
  try {
    snapshot = JSON.parse((await readText(file)) ?? 'null');
  } catch {
    return null;
  }
  if (!isObject(snapshot) || !Array.isArray(snapshot.models)) return null;
  const slugs = [];
  for (const model of snapshot.models) {
    const slug = model?.slug;
    if (typeof slug === 'string' && slug && !slugs.includes(slug))
      slugs.push(slug);
  }
  const checkedAt = Date.parse(snapshot.checkedAt);
  return {
    file,
    slugs,
    checkedAt: Number.isFinite(checkedAt) ? checkedAt : null,
  };
}

/**
 * subc's hide list in T3 Code's settings. `state` is one of:
 *
 * - `unmigrated`: `providerModelPreferences` is missing or null. T3 Code
 *   uses null to mean that its clients have not migrated their own model
 *   preferences yet, and a value from subc would stop that migration.
 * - `absent`: the object exists and has no key for subc's instance.
 * - `present`: the key exists. `hiddenModels` and `modelOrder` hold it.
 * - `invalid`: the value is not an object.
 * - `unreadable`: the settings file is missing or not valid.
 */
export async function readT3ModelPreferences(target) {
  const text = await readText(t3Files(target.home).settings);
  const parsed = text === null ? { problem: 'missing' } : parseSettings(text);
  if (!parsed.settings) return { state: 'unreadable' };
  const prefs = parsed.settings.providerModelPreferences;
  if (prefs === undefined || prefs === null) return { state: 'unmigrated' };
  if (!isObject(prefs)) return { state: 'invalid' };
  const ours = prefs[providerOf(target).instanceId];
  if (ours === undefined) return { state: 'absent' };
  const list = (value) =>
    Array.isArray(value)
      ? value.filter((item) => typeof item === 'string')
      : [];
  return {
    state: 'present',
    hiddenModels: list(ours?.hiddenModels),
    modelOrder: list(ours?.modelOrder),
  };
}

/**
 * Set subc's hide list to `hiddenModels`, with the same compare-and-rename
 * edit and backup as the entry. An existing `modelOrder` is kept. The write
 * is skipped when `providerModelPreferences` is missing, null, or not an
 * object, and when subc's entry is not in the file.
 *
 * `state` is `written`, `current`, `unmigrated`, or `no-entry`.
 */
export async function writeT3HideList(target, hiddenModels, options = {}) {
  const blockers = settingsBlockers(await inspectT3(target));
  if (blockers.length) throw new Error(blockers.join('\n'));
  const { instanceId } = providerOf(target);
  let state = 'current';
  const written = await edit(target, options.backupDir, (settings) => {
    const prefs = settings.providerModelPreferences;
    if (!isObject(prefs)) {
      state = 'unmigrated';
      return null;
    }
    if (!isOwnedEntry(settings.providerInstances?.[instanceId], target)) {
      state = 'no-entry';
      return null;
    }
    const current = isObject(prefs[instanceId]) ? prefs[instanceId] : {};
    const next = {
      ...current,
      hiddenModels: [...hiddenModels],
      modelOrder: Array.isArray(current.modelOrder) ? current.modelOrder : [],
    };
    if (JSON.stringify(prefs[instanceId]) === JSON.stringify(next)) {
      state = 'current';
      return null;
    }
    state = 'written';
    return {
      ...settings,
      providerModelPreferences: { ...prefs, [instanceId]: next },
    };
  });
  return { state, backup: written.backup };
}
