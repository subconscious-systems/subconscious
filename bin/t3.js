/**
 * `subc t3 install|status|uninstall`: add a "Subconscious (Codex)" provider
 * to T3 Code on macOS and Linux.
 *
 * T3 Code is a host for Codex, so this is not another coding agent. Install
 * checks Codex, the default profile's key, and the live key-scoped catalog,
 * then writes a launcher, removes the compaction hooks older subc versions
 * left in ~/.codex, and adds one entry to T3's settings. Every launch
 * reads the default profile again, so a new key or model needs no reinstall.
 */

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentById } from './agent-data.js';
import {
  locateAgent,
  readClaudeVersion,
  versionNeedsUpgrade,
} from './agent-install.js';
import { runbookScriptPath } from './agent-spawn.js';
import { c } from './colors.js';
import { configDir, DEFAULT_PROFILE } from './profiles.js';
import {
  isolateLaunchEnv,
  LAUNCHER_HEADER,
  launcherScript,
  resolveT3Launch,
  T3LaunchError,
  t3Paths,
} from './t3-launch.js';
import {
  inspectT3,
  installT3Provider,
  removeT3Provider,
  settingsBlockers,
  T3_DISPLAY_NAME,
  T3_INSTANCE_ID,
  t3HomeDir,
} from './t3-settings.js';

const HOOK_MARKER = 'subconscious-hook.sh';

export function printT3Help() {
  console.log(`
Usage:
  subc t3 install [--dry-run]
  subc t3 status
  subc t3 uninstall
  subc t3 help

Adds a provider named "${T3_DISPLAY_NAME}" to T3 Code. T3 Code then runs
Codex on your hosted Subconscious models. This works on macOS and Linux, with
Codex only, and with the default profile only.

  install            Check Codex, the default profile's key, and the live
                     model catalog. Then write the launcher, remove the
                     compaction hooks older subc versions left in ~/.codex,
                     and add the provider to T3 Code.
  install --dry-run  Run every check and print the plan. Change nothing.
  status             Show what is installed. Needs no network or key.
  uninstall          Remove the provider, the launcher, and any compaction
                     hooks older subc versions left in ~/.codex.
                     T3 Code threads stay.

How it works:
  T3 Code runs ~/.subconscious/bin/subc-t3-codex as the Codex binary. Each
  session reads the default profile again, so a new key or model takes effect
  at the next launch. If the key-scoped catalog cannot be read, Codex does not
  start; there is no fallback to the public or packaged model list.

  The provider uses ~/.codex, the same Codex home as subc codex, so your
  AGENTS.md, skills, and MCP servers carry over. subc never edits your
  config.toml; its -c overrides route each session to Subconscious. Codex
  apps and plugins stay off unless CODEX_EXTERNAL_TOOLS=true is in the
  default profile. Plain codex does not resume Subconscious sessions.

  subc installs no Codex hooks. Install and uninstall remove only the
  entries older subc versions merged into ~/.codex/hooks.json, with their
  hook script, env file, and logs. Your own hooks stay.

  T3 Code reloads its settings on its own; subc never restarts it.
`);
}

async function packageVersion() {
  const file = new URL('../package.json', import.meta.url);
  return JSON.parse(await fs.readFile(file, 'utf8')).version;
}

async function readText(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function context() {
  const paths = t3Paths(configDir());
  return {
    paths,
    target: {
      home: t3HomeDir(),
      launcherPath: paths.launcher,
      homePath: paths.codexHome,
    },
  };
}

async function privateDir(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700);
}

async function writeAtomically(file, text, mode) {
  const temp = `${file}.subc-${process.pid}-${randomBytes(4).toString('hex')}`;
  await fs.writeFile(temp, text, { mode, flag: 'wx' });
  try {
    await fs.chmod(temp, mode);
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

/** Write the launcher unless it is already current. Refuses a foreign file. */
async function writeLauncher(file, script) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o755 });
  const current = await readText(file);
  if (current === script) return false;
  if (current !== null && !current.includes(LAUNCHER_HEADER))
    throw new T3LaunchError(
      `${file} exists and was not written by subc. Move it away, then retry.`,
    );
  await writeAtomically(file, script, 0o755);
  return true;
}

function unquote(value) {
  return value.slice(1, -1).replaceAll("'\\''", "'");
}

/** What the launcher on disk pins, or null when it is missing or foreign. */
async function readLauncher(file) {
  const text = await readText(file);
  if (text === null) return { state: 'missing' };
  if (!text.includes(LAUNCHER_HEADER)) return { state: 'foreign', text };
  const pinned = {};
  for (const name of ['node', 'adapter', 'codex', 'config_dir']) {
    const match = new RegExp(`^subc_${name}=('(?:[^']|'\\\\'')*')$`, 'm').exec(
      text,
    );
    if (match) pinned[name] = unquote(match[1]);
  }
  const version = /\(subconscious-cli ([^)]+)\)/.exec(text)?.[1] ?? null;
  return { state: 'present', text, pinned, version };
}

async function adapterPath() {
  return fs.realpath(fileURLToPath(new URL('./t3-codex.js', import.meta.url)));
}

/**
 * What older subc versions left in a Codex home: compaction hook entries in
 * hooks.json, the hook script, its env file (which held the API key), and its
 * logs. Read without jq.
 */
async function legacyHookStatus(codexHome) {
  const hooksJson = path.join(codexHome, 'hooks.json');
  const status = {
    hooksJson,
    entries: 0,
    readable: true,
    script: await exists(path.join(codexHome, HOOK_MARKER)),
    envFile:
      (await exists(path.join(codexHome, 'subconscious-hooks.env'))) ||
      (await exists(path.join(codexHome, 'subconscious.env'))),
    logs: await exists(path.join(codexHome, 'subconscious-hook-logs')),
  };
  const text = await readText(hooksJson);
  if (text === null) return status;
  // A hooks.json that does not parse still counts when it names our script.
  status.mentioned = text.includes(HOOK_MARKER);
  try {
    const hooks = JSON.parse(text)?.hooks ?? {};
    for (const groups of Object.values(hooks)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups)
        for (const hook of group?.hooks ?? [])
          if (String(hook?.command ?? '').includes(HOOK_MARKER))
            status.entries++;
    }
  } catch {
    status.readable = false;
  }
  return status;
}

function hasLegacyHooks(legacy) {
  return Boolean(
    legacy.entries ||
      legacy.script ||
      legacy.envFile ||
      legacy.logs ||
      (!legacy.readable && legacy.mentioned),
  );
}

function describeLegacyHooks(legacy) {
  if (!legacy.readable) return `${legacy.hooksJson} is not valid JSON`;
  if (!hasLegacyHooks(legacy)) return 'none';
  const parts = [];
  if (legacy.entries) parts.push(`${legacy.entries} hooks.json entries`);
  if (legacy.script) parts.push('hook script');
  if (legacy.envFile) parts.push('env file with an API key');
  if (legacy.logs) parts.push('hook logs');
  return `left by an older subc: ${parts.join(', ')}`;
}

/**
 * Remove what older subc versions left in the provider's Codex home with the
 * Codex runbook's own cleanup (`install.sh install|uninstall`), which keeps
 * the user's hooks. The env is built here rather than inherited, so nothing
 * in the caller's env can redirect the hooks file. True on success.
 */
function removeLegacyHooks(paths, action) {
  const env = {
    PATH: process.env.PATH ?? '',
    HOME: os.homedir(),
    CODEX_DIR: paths.codexHome,
  };
  for (const name of ['LANG', 'LC_ALL', 'TMPDIR'])
    if (process.env[name]) env[name] = process.env[name];
  const script = runbookScriptPath(agentById('codex'), 'install.sh');
  const result = spawnSync('bash', [script, action], {
    env,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return result.status === 0;
}

async function readState(paths) {
  try {
    return JSON.parse((await readText(paths.state)) ?? 'null');
  } catch {
    return null;
  }
}

async function writeState(paths, state) {
  const text = `${JSON.stringify(state, null, 2)}\n`;
  if ((await readText(paths.state)) === text) return;
  await privateDir(path.dirname(paths.state));
  await writeAtomically(paths.state, text, 0o600);
}

function line(label, value) {
  console.log(`  ${c.dim}${label.padEnd(14)}${c.reset}${value}`);
}

function failWith(messages) {
  console.error('');
  for (const message of [messages].flat())
    console.error(`  ${c.red}${message}${c.reset}`);
  console.error('');
  return 1;
}

async function locateCodex() {
  const agent = agentById('codex');
  const binDir = await locateAgent(agent);
  if (!binDir)
    throw new T3LaunchError(
      `Codex CLI is not installed. Install it with npm i -g ${agent.install.package}, then retry.`,
    );
  // Codex writes helper files under CODEX_HOME/tmp on every start, even for
  // --version. A throwaway home keeps the check, and a dry run, off ~/.codex.
  const probeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-t3-codex-'));
  let version;
  try {
    version = readClaudeVersion('codex', binDir, {
      env: { CODEX_HOME: probeHome },
    });
  } finally {
    await fs.rm(probeHome, { recursive: true, force: true });
  }
  if (!version)
    throw new T3LaunchError(
      `Could not read the version of ${path.join(binDir, 'codex')}.`,
    );
  const minimum = agent.install.minimum_version;
  if (versionNeedsUpgrade(version, minimum))
    throw new T3LaunchError(
      `Codex ${version} is older than ${minimum}, the oldest version this provider supports. Upgrade Codex, then retry.`,
    );
  return { path: path.join(binDir, 'codex'), version };
}

function describeEntry(report) {
  if (report.entry === 'absent') return 'add';
  if (report.drift.length) return `repair ${report.drift.join(', ')}`;
  return 'already current';
}

async function install({ dryRun }) {
  const { paths, target } = context();
  const report = await inspectT3(target);
  const blockers = settingsBlockers(report);
  if (blockers.length) return failWith(blockers);

  let codex;
  let launch;
  let script;
  let adapter;
  try {
    codex = await locateCodex();
    isolateLaunchEnv(process.env, paths.configDir);
    launch = await resolveT3Launch();
    adapter = await adapterPath();
    script = launcherScript({
      node: process.execPath,
      adapter,
      codex: codex.path,
      configDir: paths.configDir,
      version: await packageVersion(),
    });
  } catch (error) {
    if (error instanceof T3LaunchError) return failWith(error.message);
    throw error;
  }

  console.log(
    `\n  ${c.bold}${dryRun ? 'Plan' : 'Installing'}: ${T3_DISPLAY_NAME} in T3 Code${c.reset}\n`,
  );
  line(
    'T3 Code',
    `${report.home}${report.version ? ` (${report.version})` : ''}`,
  );
  line('Provider', `${T3_INSTANCE_ID}: ${describeEntry(report)}`);
  line('Settings', report.settingsPath);
  line('Launcher', paths.launcher);
  line('Codex', `${codex.path} (${codex.version})`);
  line('Codex home', `${paths.codexHome} (shared with subc codex)`);
  line(
    'Model',
    `${launch.model} from the default profile, read again at each launch`,
  );
  line(
    'Catalog',
    `${launch.catalog.models.length} models, key-scoped, from ${new URL(launch.baseUrl).origin}`,
  );
  const legacy = await legacyHookStatus(paths.codexHome);
  line(
    'Old hooks',
    hasLegacyHooks(legacy)
      ? `${describeLegacyHooks(legacy)}; install removes them`
      : 'none',
  );
  console.log('');
  if (dryRun) {
    console.log(`  ${c.dim}Dry run: nothing was changed.${c.reset}\n`);
    return 0;
  }

  await privateDir(paths.root);
  // ~/.codex belongs to the user and Codex, so subc creates it if needed but
  // never changes its mode.
  await fs.mkdir(paths.codexHome, { recursive: true });
  await writeLauncher(paths.launcher, script);
  // Nothing the provider needs depends on this cleanup, so a failure (no jq,
  // or a hooks.json that is not valid JSON) is reported but does not stop it.
  const cleanupFailed =
    hasLegacyHooks(legacy) && !removeLegacyHooks(paths, 'install');
  await writeState(paths, {
    schema: 1,
    instanceId: T3_INSTANCE_ID,
    t3Home: report.home,
    settingsPath: report.settingsPath,
    launcher: paths.launcher,
    codexHome: paths.codexHome,
    catalogFile: paths.catalogFile,
    node: process.execPath,
    adapter,
    codex: codex.path,
  });

  let result;
  try {
    result = await installT3Provider(target, { backupDir: paths.backups });
  } catch (error) {
    return failWith([
      `T3 Code settings were not updated: ${error.message}`,
      `The launcher ${paths.launcher} is in place.`,
      'Retry subc t3 install, or run subc t3 uninstall to remove it.',
    ]);
  }
  if (result.backup) line('Backup', result.backup);
  if (cleanupFailed)
    console.log(
      `  ${c.yellow}Could not remove the old Subconscious hooks from ${paths.codexHome}; see the warning above. The provider works without removing them.${c.reset}`,
    );
  console.log(
    `\n  ${c.green}${c.bold}✓ ${T3_DISPLAY_NAME} is ${result.changed ? 'ready' : 'already set up'} in T3 Code.${c.reset}`,
  );
  console.log(
    `  ${c.dim}T3 Code reloads its settings on its own. Pick ${T3_DISPLAY_NAME} as the provider for a new thread.${c.reset}\n`,
  );
  return 0;
}

async function launcherReport(paths) {
  const launcher = await readLauncher(paths.launcher);
  if (launcher.state !== 'present') return launcher.state;
  const missing = [];
  for (const name of ['node', 'adapter', 'codex'])
    if (!launcher.pinned[name] || !(await exists(launcher.pinned[name])))
      missing.push(name);
  if (missing.length)
    return `broken: pinned ${missing.join(', ')} missing; run subc t3 install`;
  const notes = [];
  const version = await packageVersion();
  if (launcher.version !== version)
    notes.push(`written by subc ${launcher.version}, this is ${version}`);
  if (launcher.pinned.adapter !== (await adapterPath()))
    notes.push('pins another subc install');
  if (launcher.pinned.config_dir !== paths.configDir)
    notes.push(`pins config dir ${launcher.pinned.config_dir}`);
  return notes.length
    ? `stale (${notes.join('; ')}); run subc t3 install`
    : 'current';
}

function entryReport(report) {
  if (report.state !== 'ok') return `${report.state}: ${report.problem}`;
  if (report.entry === 'absent') return 'not installed';
  if (report.entry === 'conflict') return `conflict: ${report.problem}`;
  if (report.drift.length)
    return `installed, changed in T3 (${report.drift.join(', ')}); run subc t3 install`;
  return 'installed';
}

async function status() {
  const { paths, target } = context();
  const report = await inspectT3(target);
  const legacy = await legacyHookStatus(paths.codexHome);
  console.log(`\n  ${c.bold}${T3_DISPLAY_NAME} in T3 Code${c.reset}\n`);
  line(
    'T3 Code',
    `${report.home}${report.version ? ` (${report.version})` : ''}`,
  );
  line('Settings', report.settingsPath);
  line(
    'Policy',
    report.policy === 'none'
      ? 'none'
      : `${report.policy}; subc does not edit settings`,
  );
  line('Provider', `${T3_INSTANCE_ID}: ${entryReport(report)}`);
  if (report.duplicates.length)
    line('Also runs it', report.duplicates.join(', '));
  line('Launcher', `${paths.launcher}: ${await launcherReport(paths)}`);
  line(
    'Codex home',
    `${paths.codexHome}${(await exists(paths.codexHome)) ? '' : ' (missing)'}`,
  );
  line(
    'Old hooks',
    hasLegacyHooks(legacy)
      ? `${describeLegacyHooks(legacy)}; run subc t3 install to remove them`
      : describeLegacyHooks(legacy),
  );
  console.log('');
  return 0;
}

async function uninstall() {
  const { paths, target } = context();
  const problems = [];
  const done = [];

  try {
    const { removed, backup } = await removeT3Provider(target, {
      backupDir: paths.backups,
    });
    done.push(
      removed
        ? `Removed ${T3_INSTANCE_ID} from ${path.join(target.home, 'userdata', 'settings.json')}${backup ? ` (backup: ${backup})` : ''}.`
        : `T3 Code has no ${T3_INSTANCE_ID} provider from subc.`,
    );
  } catch (error) {
    problems.push(
      `T3 Code settings were not changed: ${error.message}`,
      `T3 Code still lists ${T3_DISPLAY_NAME}, and it fails to start until you remove it in T3 Code, or fix the settings and run subc t3 uninstall again.`,
    );
  }
  const report = await inspectT3(target);
  if (report.duplicates.length)
    problems.push(
      `Provider ${report.duplicates.join(', ')} still points at the launcher. Remove it in T3 Code.`,
    );

  const legacy = await legacyHookStatus(paths.codexHome);
  if (hasLegacyHooks(legacy)) {
    if (removeLegacyHooks(paths, 'uninstall'))
      done.push(`Removed the old Subconscious hooks from ${paths.codexHome}.`);
    else
      problems.push(
        `Could not remove the old Subconscious hooks from ${paths.codexHome}; see the warning above.`,
      );
  }

  const launcher = await readLauncher(paths.launcher);
  if (launcher.state === 'present') {
    await fs.rm(paths.launcher, { force: true });
    done.push(`Removed ${paths.launcher}.`);
  } else if (launcher.state === 'foreign') {
    problems.push(`${paths.launcher} was not written by subc; it was kept.`);
  }
  await fs.rm(paths.state, { force: true });
  await fs.rm(paths.catalogDir, { recursive: true, force: true });

  console.log('');
  for (const message of done) console.log(`  ${message}`);
  if (problems.length) return failWith(problems);
  console.log(
    `\n  ${c.green}${c.bold}✓ T3 Code integration removed.${c.reset}\n`,
  );
  return 0;
}

/** Entry point for `subc t3 ...`. Returns the exit code. */
export async function t3Command(argv, { profileName = DEFAULT_PROFILE } = {}) {
  const [action = 'help', ...rest] = argv;
  if (['help', '-h', '--help'].includes(action)) {
    printT3Help();
    return 0;
  }
  if (process.platform === 'win32')
    throw new Error(
      'subc t3 supports macOS and Linux only. On Windows, add the provider in T3 Code settings yourself.',
    );
  if (profileName !== DEFAULT_PROFILE)
    throw new Error(
      `subc t3 uses the default profile only, not '${profileName}'. Run it without -p and without SUBC_PROFILE.`,
    );
  const extra = rest.filter(
    (arg) => !(action === 'install' && arg === '--dry-run'),
  );
  if (extra.length)
    throw new Error(`Unknown argument for subc t3 ${action}: ${extra[0]}`);
  if (action === 'install')
    return install({ dryRun: rest.includes('--dry-run') });
  if (action === 'status') return status();
  if (action === 'uninstall') return uninstall();
  throw new Error(`Unknown t3 command: ${action}. Try subc t3 help.`);
}
