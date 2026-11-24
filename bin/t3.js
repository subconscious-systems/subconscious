/**
 * `subc t3 install|status|uninstall`: add Subconscious providers to T3 Code
 * on macOS and Linux. The provider table in `t3-providers.js` lists them.
 *
 * T3 Code is a host for the agent, so this is not another coding agent.
 * Install checks the agent, the default profile's key, and the live
 * key-scoped catalog, then writes a launcher and adds one entry to T3's
 * settings. For Codex, install and uninstall also remove the compaction
 * hooks that older subc versions left in ~/.codex. Every launch reads the
 * default profile again, so a new key or model needs no reinstall.
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
  LAUNCHER_SHEBANG,
  launcherScript,
  resolveT3Launch,
  T3LaunchError,
  t3Paths,
} from './t3-launch.js';
import { T3_PROVIDERS } from './t3-providers.js';
import {
  inspectT3,
  installT3Provider,
  readText,
  removeT3Provider,
  settingsBlockers,
  t3HomeDir,
} from './t3-settings.js';

// What older subc versions left in a Codex home: hooks.json entries that run
// the hook script, the script, its env file (which held the key), and logs.
const HOOK_MARKER = 'subconscious-hook.sh';
const LEGACY_HOOK_FILES = [
  HOOK_MARKER,
  'subconscious-hooks.env',
  'subconscious.env',
  'subconscious-hook-logs',
];
const PROVIDER_KEYS = T3_PROVIDERS.map((provider) => provider.id);

export function printT3Help() {
  console.log(`
Usage:
  subc t3 install [--provider NAME]...
  subc t3 status [--provider NAME]...
  subc t3 uninstall [--provider NAME]...
  subc t3 help

Adds providers to T3 Code that run an agent on your hosted Subconscious
models: Subconscious (Codex), Subconscious (Claude), and Subconscious
(OpenCode). It works on macOS and Linux, with the default profile only.

  install            Check each CLI, the default profile's key, and the live
                     model catalog. Then write a launcher per provider in
                     ~/.subconscious/bin and add its entry to T3 Code.
  status             Show what is installed. Needs no network or key.
  uninstall          Remove the entries and the launchers. Threads stay.
  --provider NAME    Act on one provider: codex, claude, or opencode.
                     Repeat it to name more. Without it, install skips a
                     provider whose CLI is missing or refused.

Each launch reads the default profile again. If the key-scoped catalog
cannot be read, the agent does not start. Each provider uses the same
folders as the matching subc command, such as ~/.codex and ~/.claude.
Install and uninstall remove the Codex hooks older subc versions left.
T3 Code reloads its settings on its own; subc never restarts it.

Claude Code: each launch pins ANTHROPIC_BASE_URL in --settings, so a
settings file cannot send the key to another host. Hooks and MCP servers
from a repo's .claude settings still run with the key in their env.

OpenCode: T3 Code shares one helper across threads, so a new key or model
applies after the helper restarts.

See the README for details.
`);
}

async function packageVersion() {
  const file = new URL('../package.json', import.meta.url);
  return JSON.parse(await fs.readFile(file, 'utf8')).version;
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** The paths, and the settings target, for one provider. */
function context(provider) {
  const paths = t3Paths(configDir());
  const homePath = paths.homeFor(provider);
  return {
    paths,
    target: {
      home: t3HomeDir(),
      launcherPath: paths.launcherFor(provider),
      ...(homePath ? { homePath } : {}),
      provider,
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
async function readLauncher(file, provider) {
  const text = await readText(file);
  if (text === null) return { state: 'missing' };
  if (!text.includes(LAUNCHER_HEADER)) return { state: 'foreign', text };
  const pinned = {};
  for (const name of ['node', 'adapter', provider.binaryName, 'config_dir']) {
    const match = new RegExp(`^subc_${name}=('(?:[^']|'\\\\'')*')$`, 'm').exec(
      text,
    );
    if (match) pinned[name] = unquote(match[1]);
  }
  const version = /\(subconscious-cli ([^)]+)\)/.exec(text)?.[1] ?? null;
  return { state: 'present', text, pinned, version };
}

async function adapterPath(provider) {
  return fs.realpath(
    fileURLToPath(new URL(`./${provider.adapterFile}`, import.meta.url)),
  );
}

/** True when an older subc left its compaction hooks in `codexHome`. */
async function hasLegacyHooks(codexHome) {
  const hooksJson = await readText(path.join(codexHome, 'hooks.json'));
  if (hooksJson?.includes(HOOK_MARKER)) return true;
  for (const name of LEGACY_HOOK_FILES)
    if (await exists(path.join(codexHome, name))) return true;
  return false;
}

/**
 * Remove them with the Codex runbook's own cleanup, which keeps the user's
 * hooks. The env is built here rather than inherited, so nothing in the
 * caller's env can redirect the hooks file. True on success.
 */
function removeLegacyHooks(codexHome) {
  const env = {
    PATH: process.env.PATH ?? '',
    HOME: os.homedir(),
    CODEX_DIR: codexHome,
  };
  for (const name of ['LANG', 'LC_ALL', 'TMPDIR'])
    if (process.env[name]) env[name] = process.env[name];
  const script = runbookScriptPath(agentById('codex'), 'install.sh');
  const result = spawnSync('bash', [script, 'uninstall'], {
    env,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return result.status === 0;
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

/**
 * The pinned binary path and its version. Throws T3LaunchError. The path is
 * the one found, not its real path: Claude Code's native installer links
 * ~/.local/bin/claude to a versioned file that a later update removes.
 */
async function checkBinary(provider, agent, binDir) {
  const binary = path.join(binDir, provider.binaryName);
  const probeHome = provider.versionProbeEnv
    ? await fs.mkdtemp(path.join(os.tmpdir(), `subc-t3-${provider.id}-`))
    : null;
  let version;
  try {
    version = readClaudeVersion(provider.binaryName, binDir, {
      env: probeHome ? provider.versionProbeEnv(probeHome) : {},
    });
  } finally {
    if (probeHome) await fs.rm(probeHome, { recursive: true, force: true });
  }
  if (!version)
    throw new T3LaunchError(`Could not read the version of ${binary}.`);
  const required = agent.install.minimum_version;
  const minimum =
    provider.minimumVersion &&
    (!required || versionNeedsUpgrade(required, provider.minimumVersion))
      ? provider.minimumVersion
      : required;
  if (versionNeedsUpgrade(version, minimum))
    throw new T3LaunchError(
      `${provider.label} ${version} is older than ${minimum}, the oldest version this provider supports. Upgrade ${provider.label}, then retry.`,
    );
  return { path: binary, version };
}

/**
 * Check that this system can start the launcher: its first line needs an
 * env that supports -S, and bash.
 */
function checkLauncherShell() {
  const [file, words] = LAUNCHER_SHEBANG.slice(2).split(/ (.*)/s);
  const result = spawnSync(file, [words, '-c', 'exit 0'], {
    env: { PATH: process.env.PATH ?? '' },
    stdio: 'ignore',
  });
  if (result.status !== 0)
    throw new T3LaunchError(
      `This system cannot start the launcher, because "${LAUNCHER_SHEBANG.slice(2)}" failed. The launcher needs bash, and an env command that supports -S (macOS, or GNU coreutils 8.30 or newer).`,
    );
}

const repairCommand = (provider) => `subc t3 install --provider ${provider.id}`;

function describeEntry(report) {
  if (report.entry === 'absent') return 'add';
  if (report.drift.length) return `repair ${report.drift.join(', ')}`;
  return 'already current';
}

/** Run every check for one provider. Changes nothing. */
async function prepare(paths, item) {
  const { provider, agent, binDir } = item;
  item.binary = await checkBinary(provider, agent, binDir);
  isolateLaunchEnv(process.env, paths.configDir, provider);
  item.launch = await resolveT3Launch({ agentId: provider.agentId });
  item.script = launcherScript({
    provider,
    node: process.execPath,
    adapter: await adapterPath(provider),
    binary: item.binary.path,
    configDir: paths.configDir,
    version: await packageVersion(),
  });
}

async function printPlan({ provider, target, report, binary, launch }) {
  console.log(`\n  ${c.bold}${provider.displayName}${c.reset}`);
  line('Provider', `${provider.instanceId}: ${describeEntry(report)}`);
  line('Launcher', target.launcherPath);
  line(provider.label, `${binary.path} (${binary.version})`);
  if (target.homePath)
    line(
      `${provider.label} home`,
      `${target.homePath} (shared with subc ${provider.id})`,
    );
  line('Model', `${launch.model} from the default profile`);
  line(
    'Catalog',
    `${launch.catalog.models.length} models, key-scoped, from ${new URL(launch.baseUrl).origin}`,
  );
  if (provider.legacyHooks && (await hasLegacyHooks(target.homePath)))
    line('Old hooks', 'left by an older subc; install removes them');
}

/** Write the launcher and the settings entry for one provider. */
async function installOne(paths, { provider, target, script }) {
  // The agent home belongs to the user and the agent, so subc creates it if
  // needed but never changes its mode.
  if (target.homePath) await fs.mkdir(target.homePath, { recursive: true });
  await writeLauncher(target.launcherPath, script);
  // The provider works without this cleanup, so a failure (no jq, or a
  // hooks.json that does not parse) is a warning.
  if (
    provider.legacyHooks &&
    (await hasLegacyHooks(target.homePath)) &&
    !removeLegacyHooks(target.homePath)
  )
    console.log(
      `  ${c.yellow}Could not remove the old Subconscious hooks from ${target.homePath}. The provider works without removing them.${c.reset}`,
    );
  let result;
  try {
    result = await installT3Provider(target, { backupDir: paths.backups });
  } catch (error) {
    return failWith([
      `T3 Code settings were not updated: ${error.message}`,
      `The launcher ${target.launcherPath} is in place.`,
      'Retry subc t3 install, or run subc t3 uninstall to remove the launcher.',
    ]);
  }
  if (result.backup) line('Backup', result.backup);
  console.log(
    `  ${c.green}${c.bold}✓ ${provider.displayName} is ${result.changed ? 'ready' : 'already set up'} in T3 Code.${c.reset}`,
  );
  return 0;
}

async function install({ providers, explicit }) {
  const paths = t3Paths(configDir());
  const found = [];
  const skipped = [];
  for (const provider of providers) {
    const agent = agentById(provider.agentId);
    const binDir = await locateAgent(agent);
    if (binDir) found.push({ provider, agent, binDir });
    else
      skipped.push({
        provider,
        message: `${provider.label} CLI is not installed. Install it with npm i -g ${agent.install.package}, then retry.`,
      });
  }
  // Without --provider, a provider whose CLI is missing is skipped.
  if (!found.length || (explicit && skipped.length))
    return failWith(skipped.map((item) => item.message));

  for (const item of found) {
    item.target = context(item.provider).target;
    item.report = await inspectT3(item.target);
  }
  const blockers = [
    ...new Set(found.flatMap((item) => settingsBlockers(item.report))),
  ];
  if (blockers.length) return failWith(blockers);

  // Without --provider, a provider that a check refuses, such as an old
  // CLI, is skipped with its message, and the others install. With
  // --provider, every named provider must pass.
  const ready = [];
  try {
    checkLauncherShell();
    for (const item of found) {
      try {
        await prepare(paths, item);
        ready.push(item);
      } catch (error) {
        if (!(error instanceof T3LaunchError)) throw error;
        skipped.push({ provider: item.provider, message: error.message });
      }
    }
  } catch (error) {
    if (error instanceof T3LaunchError) return failWith(error.message);
    throw error;
  }
  if (!ready.length || (explicit && ready.length < found.length))
    return failWith([
      ...skipped.map((item) => `${item.provider.displayName}: ${item.message}`),
      'Nothing was changed.',
    ]);

  const { report } = ready[0];
  console.log(
    `\n  ${c.bold}Installing: Subconscious providers in T3 Code${c.reset}\n`,
  );
  line(
    'T3 Code',
    `${report.home}${report.version ? ` (${report.version})` : ''}`,
  );
  line('Settings', report.settingsPath);
  for (const item of ready) await printPlan(item);
  if (skipped.length) console.log('');
  for (const item of skipped)
    line(
      'Skipped',
      `${c.yellow}${item.provider.displayName}: ${item.message}${c.reset}`,
    );
  console.log('');

  await privateDir(paths.root);
  let code = 0;
  // A failure in one provider does not stop the others.
  for (const item of ready) if ((await installOne(paths, item)) !== 0) code = 1;
  if (code === 0)
    console.log(
      `\n  ${c.dim}T3 Code reloads its settings on its own. Pick a Subconscious provider for a new thread.${c.reset}\n`,
    );
  return code;
}

async function launcherReport(paths, provider, file) {
  const launcher = await readLauncher(file, provider);
  if (launcher.state !== 'present') return launcher.state;
  const { pinned } = launcher;
  const missing = [];
  for (const name of ['node', 'adapter', provider.binaryName])
    if (!pinned[name] || !(await exists(pinned[name]))) missing.push(name);
  if (missing.length)
    return `broken: pinned ${missing.join(', ')} missing; run ${repairCommand(provider)}`;
  const notes = [];
  const version = await packageVersion();
  if (launcher.version !== version)
    notes.push(`written by subc ${launcher.version}, this is ${version}`);
  if (pinned.adapter !== (await adapterPath(provider)))
    notes.push('pins another subc install');
  if (pinned.config_dir !== paths.configDir)
    notes.push(`pins config dir ${pinned.config_dir}`);
  return notes.length
    ? `stale (${notes.join('; ')}); run ${repairCommand(provider)}`
    : 'current';
}

function entryReport(report, provider) {
  if (report.state !== 'ok') return `${report.state}: ${report.problem}`;
  if (report.entry === 'absent') return 'not installed';
  if (report.entry === 'conflict') return `conflict: ${report.problem}`;
  if (report.drift.length)
    return `installed, changed in T3 (${report.drift.join(', ')}); run ${repairCommand(provider)}`;
  return 'installed';
}

async function status({ providers }) {
  const items = [];
  for (const provider of providers) {
    const { paths, target } = context(provider);
    items.push({ provider, paths, target, report: await inspectT3(target) });
  }
  const { report: first } = items[0];
  console.log(`\n  ${c.bold}Subconscious providers in T3 Code${c.reset}\n`);
  line('T3 Code', `${first.home}${first.version ? ` (${first.version})` : ''}`);
  line('Settings', first.settingsPath);
  line(
    'Policy',
    first.policy === 'none'
      ? 'none'
      : `${first.policy}; subc does not edit settings`,
  );
  for (const { provider, paths, target, report } of items) {
    console.log(`\n  ${c.bold}${provider.displayName}${c.reset}`);
    line(
      'Provider',
      `${provider.instanceId}: ${entryReport(report, provider)}`,
    );
    if (report.duplicates.length)
      line('Also runs it', report.duplicates.join(', '));
    line(
      'Launcher',
      `${target.launcherPath}: ${await launcherReport(paths, provider, target.launcherPath)}`,
    );
    if (target.homePath)
      line(
        `${provider.label} home`,
        `${target.homePath}${(await exists(target.homePath)) ? '' : ' (missing)'}`,
      );
    if (provider.legacyHooks)
      line(
        'Old hooks',
        (await hasLegacyHooks(target.homePath))
          ? `left by an older subc; run ${repairCommand(provider)}`
          : 'none',
      );
  }
  console.log('');
  // Status exits 1 only when it cannot read T3 Code's settings.
  return ['ok', 'missing'].includes(first.state) ? 0 : 1;
}

async function uninstall({ providers }) {
  const problems = [];
  const done = [];
  const paths = t3Paths(configDir());

  for (const provider of providers) {
    const { target } = context(provider);
    try {
      const { removed, backup } = await removeT3Provider(target, {
        backupDir: paths.backups,
      });
      done.push(
        removed
          ? `Removed ${provider.instanceId} from ${path.join(target.home, 'userdata', 'settings.json')}${backup ? ` (backup: ${backup})` : ''}.`
          : `T3 Code has no ${provider.instanceId} provider from subc.`,
      );
    } catch (error) {
      problems.push(
        `T3 Code settings were not changed: ${error.message}`,
        `T3 Code still lists ${provider.displayName}, and it fails to start until you remove it in T3 Code, or fix the settings and run subc t3 uninstall again.`,
      );
    }
    const report = await inspectT3(target);
    if (report.duplicates.length)
      problems.push(
        `Provider ${report.duplicates.join(', ')} still points at the launcher. Remove it in T3 Code.`,
      );

    if (provider.legacyHooks && (await hasLegacyHooks(target.homePath))) {
      if (removeLegacyHooks(target.homePath))
        done.push(
          `Removed the old Subconscious hooks from ${target.homePath}.`,
        );
      else
        problems.push(
          `Could not remove the old Subconscious hooks from ${target.homePath}.`,
        );
    }

    const launcher = await readLauncher(target.launcherPath, provider);
    if (launcher.state === 'present') {
      await fs.rm(target.launcherPath, { force: true });
      done.push(`Removed ${target.launcherPath}.`);
    } else if (launcher.state === 'foreign') {
      problems.push(
        `${target.launcherPath} was not written by subc; it was kept.`,
      );
    }
    if (provider.id === 'codex')
      await fs.rm(paths.catalogDir, { recursive: true, force: true });
  }

  console.log('');
  for (const message of done) console.log(`  ${message}`);
  if (problems.length) return failWith(problems);
  console.log(
    `\n  ${c.green}${c.bold}✓ T3 Code integration removed.${c.reset}\n`,
  );
  return 0;
}

function parseOptions(action, args) {
  const keys = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--provider') {
      const key = args[++i];
      if (!PROVIDER_KEYS.includes(key))
        throw new Error(
          `Unknown provider: ${key ?? '(none)'}. Use one of: ${PROVIDER_KEYS.join(', ')}.`,
        );
      keys.push(key);
    } else {
      throw new Error(`Unknown argument for subc t3 ${action}: ${arg}`);
    }
  }
  return {
    explicit: keys.length > 0,
    providers: keys.length
      ? T3_PROVIDERS.filter((provider) => keys.includes(provider.id))
      : T3_PROVIDERS,
  };
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
  if (!['install', 'status', 'uninstall'].includes(action))
    throw new Error(`Unknown t3 command: ${action}. Try subc t3 help.`);
  const options = parseOptions(action, rest);
  if (action === 'install') return install(options);
  if (action === 'status') return status(options);
  return uninstall(options);
}
