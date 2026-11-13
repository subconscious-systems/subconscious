/**
 * Everything subc knows about T3 Code's server settings file lives here.
 *
 * T3 Code keeps its providers in `<T3 home>/userdata/settings.json`, under
 * `providerInstances`. Each entry is an envelope
 * `{ driver, displayName, enabled, environment?, config }`, and a Codex
 * instance keeps its own fields (`binaryPath`, `homePath`, ...) in `config`.
 * T3 watches the file and reloads it about 100 ms after a change, so a write
 * here takes effect without restarting T3.
 *
 * subc owns one entry, `subconscious-codex`. It never changes another entry,
 * the secret store, the default provider, or text generation. An entry is
 * subc's when it is a Codex instance whose binary is the launcher subc wrote.
 */

import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const T3_INSTANCE_ID = 'subconscious-codex';
export const T3_DISPLAY_NAME = 'Subconscious (Codex)';

// Codex launch fields that subc sets on its entry, and the ones it keeps
// empty because they would change which home or arguments Codex starts with.
const CLEARED_CONFIG_FIELDS = ['shadowHomePath', 'launchArgs'];
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

function sameFile(left, right) {
  return (
    typeof left === 'string' &&
    typeof right === 'string' &&
    path.resolve(left) === path.resolve(right)
  );
}

function launcherOf(entry) {
  return isObject(entry?.config) ? entry.config.binaryPath : undefined;
}

/** True when the entry is a Codex instance that runs subc's launcher. */
function isOwnedEntry(entry, launcherPath) {
  return (
    isObject(entry) &&
    entry.driver === 'codex' &&
    sameFile(launcherOf(entry), launcherPath)
  );
}

/** The managed fields that differ from what subc writes. */
function driftOf(entry, expected) {
  const drift = [];
  if (entry.displayName !== expected.displayName) drift.push('displayName');
  if (entry.enabled === false) drift.push('enabled');
  for (const field of ['setupMode', 'homePath']) {
    if (entry.config?.[field] !== expected.config[field]) drift.push(field);
  }
  for (const field of CLEARED_CONFIG_FIELDS) {
    const value = entry.config?.[field];
    if (value !== undefined && value !== '') drift.push(field);
  }
  return drift;
}

/**
 * The entry subc writes. A repaired entry keeps the fields subc does not
 * manage, such as an accent color or custom models.
 */
function expectedEntry({ launcherPath, homePath }, current = {}) {
  const config = { ...(isObject(current.config) ? current.config : {}) };
  for (const field of CLEARED_CONFIG_FIELDS) delete config[field];
  config.setupMode = 'existing';
  config.binaryPath = launcherPath;
  config.homePath = homePath;
  return {
    ...current,
    driver: 'codex',
    displayName: T3_DISPLAY_NAME,
    enabled: true,
    config,
  };
}

function survived(entry, target) {
  return (
    isOwnedEntry(entry, target.launcherPath) &&
    entry.enabled !== false &&
    driftOf(entry, expectedEntry(target)).length === 0
  );
}

/**
 * Look at T3 Code's settings without changing anything. `target` names the
 * launcher and the Codex home subc's entry should use.
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
  const instances = parsed.settings.providerInstances ?? {};
  const ours = instances[T3_INSTANCE_ID];
  if (ours !== undefined) {
    if (isOwnedEntry(ours, target.launcherPath)) {
      report.entry = 'owned';
      report.drift = driftOf(ours, expectedEntry(target, ours));
    } else {
      report.entry = 'conflict';
      report.problem = `T3 Code already has a provider named ${T3_INSTANCE_ID} that subc did not create. Rename or remove it in T3 Code, then retry.`;
    }
  }
  report.duplicates = Object.entries(instances)
    .filter(
      ([id, entry]) =>
        id !== T3_INSTANCE_ID && isOwnedEntry(entry, target.launcherPath),
    )
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
 * Replace the file only while it still holds `expected`. The new text goes to
 * a temp file beside the target with the target's mode, and a rename puts it
 * in place, so T3 never reads half a file.
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
  return parsed.settings?.providerInstances?.[T3_INSTANCE_ID];
}

/**
 * Add or repair subc's provider entry, then wait out T3's reload and read the
 * file again to confirm the entry is still there. Throws when the settings
 * are blocked or the entry did not survive.
 */
export async function installT3Provider(target, options = {}) {
  const { backupDir, settleMs = DEFAULT_SETTLE_MS } = options;
  const blockers = settingsBlockers(await inspectT3(target));
  if (blockers.length) throw new Error(blockers.join('\n'));
  let result = { changed: false, backup: null };
  for (let attempt = 0; attempt < 3; attempt++) {
    const written = await edit(target, backupDir, (settings) => {
      const instances = { ...(settings.providerInstances ?? {}) };
      const current = instances[T3_INSTANCE_ID];
      if (current !== undefined && !isOwnedEntry(current, target.launcherPath))
        throw new Error(
          `T3 Code now has a provider named ${T3_INSTANCE_ID} that subc did not create.`,
        );
      const next = expectedEntry(target, current);
      if (
        current !== undefined &&
        JSON.stringify(current) === JSON.stringify(next)
      )
        return null;
      instances[T3_INSTANCE_ID] = next;
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
    `T3 Code did not keep the ${T3_INSTANCE_ID} provider in its settings. Check ${t3Files(target.home).settings}.`,
  );
}

/**
 * Remove subc's entry and nothing else. Threads and other providers stay.
 * Returns whether an entry was removed; a foreign entry with the same id is
 * left alone.
 */
export async function removeT3Provider(target, options = {}) {
  const report = await inspectT3(target);
  if (report.state === 'missing') return { removed: false, backup: null };
  const blockers = settingsBlockers(report, { forRemoval: true });
  if (blockers.length) throw new Error(blockers.join('\n'));
  if (report.entry !== 'owned') return { removed: false, backup: null };
  const written = await edit(target, options.backupDir, (settings) => {
    const instances = { ...(settings.providerInstances ?? {}) };
    if (!isOwnedEntry(instances[T3_INSTANCE_ID], target.launcherPath))
      return null;
    delete instances[T3_INSTANCE_ID];
    return { ...settings, providerInstances: instances };
  });
  return { removed: written.changed, backup: written.backup };
}
