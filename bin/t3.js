/**
 * `subc t3 install|status|uninstall`: add a "Subconscious (Codex)" provider
 * to T3 Code on macOS and Linux.
 *
 * T3 Code is a host for Codex, so this is not another coding agent. Install
 * checks Codex, the default profile's key, and the live key-scoped catalog,
 * then writes a launcher, sets up compaction hooks once in a Codex home that
 * only this provider uses, and adds one entry to T3's settings. Every launch
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
                     model catalog. Then write the launcher, set up the
                     compaction hooks, and add the provider to T3 Code.
  install --dry-run  Run every check and print the plan. Change nothing.
  status             Show what is installed. Needs no network or key.
  uninstall          Remove the provider, the hooks, and the launcher.
                     T3 Code threads and the provider's Codex home stay.

How it works:
  T3 Code runs ~/.subconscious/bin/subc-t3-codex as the Codex binary. Each
  session reads the default profile again, so a new key or model takes effect
  at the next launch. If the key-scoped catalog cannot be read, Codex does not
  start; there is no fallback to the public or packaged model list.

  The provider uses its own Codex home, ~/.subconscious/t3/codex/default, so
  its threads and settings stay apart from ~/.codex. Your usual Codex skills,
  MCP servers, and plugins do not carry over, and Codex apps and plugins stay
  off unless CODEX_EXTERNAL_TOOLS=true is in the default profile. Codex may
  write its own config.toml in that home.

  The compaction hooks live in that home too. Codex runs them only after you
  trust them with /hooks, and they report only for Codex sessions that subc
  started. The hook env file there holds the profile's key, mode 600.

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

/** Count subc's hook entries in a Codex home without needing jq. */
async function hookStatus(codexHome) {
  const hooksJson = path.join(codexHome, 'hooks.json');
  const status = {
    hooksJson,
    entries: 0,
    readable: true,
    script: await exists(path.join(codexHome, HOOK_MARKER)),
    envFile: await exists(path.join(codexHome, 'subconscious-hooks.env')),
  };
  const text = await readText(hooksJson);
  if (text === null) return status;
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

/**
 * Run the Codex hook installer against the provider's own Codex home. The
 * env is built here rather than inherited, so nothing in the caller's env can
 * redirect the hooks file, and the key travels in the env, never in argv.
 */
function runHookScript(paths, action, launch) {
  const env = {
    PATH: process.env.PATH ?? '',
    HOME: os.homedir(),
    CODEX_DIR: paths.codexHome,
  };
  for (const name of ['LANG', 'LC_ALL', 'TMPDIR'])
    if (process.env[name]) env[name] = process.env[name];
  if (launch) {
    env.GATEWAY_URL = launch.baseUrl;
    env.API_KEY = launch.apiKey;
  }
  const script = runbookScriptPath(agentById('codex'), 'install.sh');
  const result = spawnSync('bash', [script, action], {
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  return result.status ?? 1;
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
  const version = readClaudeVersion('codex', binDir);
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
  line('Codex home', `${paths.codexHome} (not shared with ~/.codex)`);
  line(
    'Model',
    `${launch.model} from the default profile, read again at each launch`,
  );
  line(
    'Catalog',
    `${launch.catalog.models.length} models, key-scoped, from ${new URL(launch.baseUrl).origin}`,
  );
  line('Hooks', 'compaction hooks in that Codex home, inert until trusted');
  console.log('');
  if (dryRun) {
    console.log(`  ${c.dim}Dry run: nothing was changed.${c.reset}\n`);
    return 0;
  }

  await privateDir(paths.root);
  await privateDir(paths.codexHome);
  await writeLauncher(paths.launcher, script);
  if (runHookScript(paths, 'install', launch) !== 0)
    return failWith(
      `Could not set up the compaction hooks in ${paths.codexHome}. T3 Code settings were not changed.`,
    );
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
    hooks: 'installed',
  });

  let result;
  try {
    result = await installT3Provider(target, { backupDir: paths.backups });
  } catch (error) {
    return failWith([
      `T3 Code settings were not updated: ${error.message}`,
      `The launcher and the compaction hooks are in place under ${paths.root}.`,
      'The hooks run only for Codex sessions subc starts, so they send nothing on their own.',
      'Retry subc t3 install, or run subc t3 uninstall to remove them.',
    ]);
  }
  if (result.backup) line('Backup', result.backup);
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
  const hooks = await hookStatus(paths.codexHome);
  const state = await readState(paths);
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
  const hookState = !hooks.readable
    ? `${hooks.hooksJson} is not valid JSON`
    : hooks.entries
      ? `${hooks.entries} entries${hooks.script ? '' : ', hook script missing'}${hooks.envFile ? ', env file present (mode 600)' : ''}`
      : 'not installed';
  line(
    'Hooks',
    `${hookState}${state?.hooks === 'installed' ? '; set up by subc t3 install' : ''}`,
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
    problems.push(`T3 Code settings were not changed: ${error.message}`);
  }
  const report = await inspectT3(target);
  if (report.duplicates.length)
    problems.push(
      `Provider ${report.duplicates.join(', ')} still points at the launcher. Remove it in T3 Code.`,
    );

  const before = await hookStatus(paths.codexHome);
  if (before.entries || before.script || before.envFile) {
    runHookScript(paths, 'uninstall');
    const after = await hookStatus(paths.codexHome);
    if (after.entries || after.script || after.envFile)
      problems.push(
        `Could not remove every hook file from ${paths.codexHome}. Check ${after.hooksJson}.`,
      );
    else done.push(`Removed the compaction hooks from ${paths.codexHome}.`);
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
  if (await exists(paths.codexHome))
    console.log(
      `  ${c.dim}Kept ${paths.codexHome}, which holds this provider's Codex threads. Delete it yourself if you no longer need them.${c.reset}`,
    );
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
