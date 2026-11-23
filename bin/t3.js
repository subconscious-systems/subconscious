/**
 * `subc t3 install|status|uninstall`: add Subconscious providers to T3 Code
 * on macOS and Linux. The provider table in `t3-providers.js` lists them.
 *
 * T3 Code is a host for the agent, so this is not another coding agent.
 * Install checks the agent, the default profile's key, and the live
 * key-scoped catalog, then writes a launcher, sets up the provider's hooks
 * (for Codex, the compaction hooks in ~/.codex, the way `subc codex` does),
 * and adds one entry to T3's settings. Every launch reads the default
 * profile again, so a new key or model needs no reinstall.
 *
 * subc keeps no state file. Status reads the launcher, the settings entry,
 * and the hook files on every run.
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
  shellQuote,
  T3LaunchError,
  t3Paths,
} from './t3-launch.js';
import {
  providerByKey,
  T3_PROVIDER_KEYS,
  T3_PROVIDERS,
} from './t3-providers.js';
import {
  inspectT3,
  installT3Provider,
  removeT3Provider,
  settingsBlockers,
  t3HomeDir,
} from './t3-settings.js';

const HOOK_MARKER = 'subconscious-hook.sh';
const HOOK_ENV_FILE = 'subconscious-hooks.env';

export function printT3Help() {
  const available = T3_PROVIDERS.map((provider) => provider.id);
  const pending = T3_PROVIDER_KEYS.filter((key) => !providerByKey(key));
  const names = T3_PROVIDERS.map(
    (provider) => `"${provider.displayName}"`,
  ).join(' and ');
  console.log(`
Usage:
  subc t3 install [--provider NAME]... [--dry-run]
  subc t3 status [--provider NAME]...
  subc t3 uninstall [--provider NAME]...
  subc t3 help

Adds providers named ${names} to T3 Code.
T3 Code then runs Codex or Claude Code on your hosted Subconscious models.
This works on macOS and Linux, and with the default profile only.

  install            Check each CLI, the default profile's key, and the live
                     model catalog. Then write a launcher per provider, set
                     up the Codex compaction hooks, and add the providers to
                     T3 Code.
  install --dry-run  Run every check and print the plan. Change nothing.
  status             Show what is installed. Needs no network or key.
  uninstall          Remove the providers and the launchers. The compaction
                     hooks in ~/.codex stay, because subc codex uses them.
                     ~/.claude is never changed. T3 Code threads stay.
  --provider NAME    Act on this provider only. Repeat it to name more.
                     Available: ${available.join(', ')}.${pending.length ? ` Not available yet: ${pending.join(', ')}.` : ''}
                     Without it, install sets up every available provider
                     whose CLI is found, and status and uninstall cover
                     every available provider.

How it works:
  T3 Code runs ~/.subconscious/bin/subc-t3-codex as the Codex binary, and
  ~/.subconscious/bin/subc-t3-claude as the Claude Code binary. Each session
  reads the default profile again, so a new key or model takes effect at the
  next launch. If the key-scoped catalog cannot be read, the agent does not
  start; there is no fallback to the public or packaged model list.

Codex:
  The provider uses ~/.codex, the same Codex home as subc codex, so your
  AGENTS.md, skills, and MCP servers carry over. subc never edits your
  config.toml; its -c overrides route each session to Subconscious. Codex
  apps and plugins stay off unless CODEX_EXTERNAL_TOOLS=true is in the
  default profile. Plain codex does not resume Subconscious sessions.

  The compaction hooks are the same ~/.codex/hooks.json entries that subc
  codex writes. Codex runs them only after you trust them with /hooks, and
  they report only for Codex sessions that subc started. The hook env file
  holds the profile's key, mode 600. After subc codex uninstall removes
  them, run subc t3 install to set them up again.

Claude Code (beta):
  The provider uses your ~/.claude, as subc claude does, so your settings,
  MCP servers, and project trust carry over. subc writes nothing there. It
  needs Claude Code 2.1.280 or newer, and warns below 2.1.301.

  T3 Code also lists its built-in Claude models on this provider. A model
  that is not in your Subconscious catalog runs as the default profile's
  model instead, and the launcher logs one line that names both models.

  T3 Code's built-in Claude provider uses the same ~/.claude, so T3 Code
  lets you switch a running thread between the two. The next turn then
  sends the whole thread to the other backend: Anthropic or Subconscious.

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

/** Count subc's hook entries in a Codex home without needing jq. */
async function hookStatus(codexHome) {
  const hooksJson = path.join(codexHome, 'hooks.json');
  const envFile = path.join(codexHome, HOOK_ENV_FILE);
  const status = {
    hooksJson,
    entries: 0,
    // Our entries whose command is not this home's hook script, such as a
    // path left by an older install. Codex cannot run them.
    stale: 0,
    readable: true,
    script: await exists(path.join(codexHome, HOOK_MARKER)),
    envFile: await exists(envFile),
    envMode: null,
  };
  if (status.envFile) {
    try {
      status.envMode = (await fs.stat(envFile)).mode & 0o777;
    } catch {
      // Removed since the check above.
    }
  }
  const text = await readText(hooksJson);
  if (text === null) return status;
  const hookScript = path.join(codexHome, HOOK_MARKER);
  try {
    const hooks = JSON.parse(text)?.hooks ?? {};
    for (const groups of Object.values(hooks)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups)
        for (const hook of group?.hooks ?? []) {
          const command = String(hook?.command ?? '');
          if (!command.includes(HOOK_MARKER)) continue;
          status.entries++;
          if (command !== hookScript) status.stale++;
        }
    }
  } catch {
    status.readable = false;
  }
  return status;
}

/**
 * Run the Codex hook installer against `codexHome`. The env is built here
 * rather than inherited, so nothing in the caller's env can redirect the
 * hooks file, and the key travels in the env, never in argv.
 */
function installHooks(codexHome, launch) {
  const env = {
    PATH: process.env.PATH ?? '',
    HOME: os.homedir(),
    CODEX_DIR: codexHome,
    GATEWAY_URL: launch.baseUrl,
    API_KEY: launch.apiKey,
  };
  for (const name of ['LANG', 'LC_ALL', 'TMPDIR'])
    if (process.env[name]) env[name] = process.env[name];
  const script = runbookScriptPath(agentById('codex'), 'install.sh');
  const result = spawnSync('bash', [script, 'install'], {
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  return result.status ?? 1;
}

/** The separate agent home an older subc used, when it is still there. */
async function legacyHome(paths, provider) {
  if (!provider.legacyHome) return null;
  const dir = paths.underRoot(provider.legacyHome);
  if (!(await exists(dir))) return null;
  const keyFile = path.join(dir, HOOK_ENV_FILE);
  return { dir, keyFile: (await exists(keyFile)) ? keyFile : null };
}

function legacyHomeLines(legacy, provider) {
  const lines = [
    `${legacy.dir} is the separate ${provider.label} home from subc before 8.2.0. subc no longer uses it and does not delete it.`,
  ];
  if (legacy.keyFile)
    lines.push(
      `It holds a key file. Remove it with: rm ${shellQuote(legacy.keyFile)}`,
    );
  lines.push(
    'It also holds the threads made before 8.2.0. They are your data, so delete the folder yourself when you no longer need them.',
  );
  return lines;
}

function line(label, value) {
  console.log(`  ${c.dim}${label.padEnd(14)}${c.reset}${value}`);
}

function lines(label, values) {
  values.forEach((value, index) => {
    line(index ? '' : label, value);
  });
}

function failWith(messages) {
  console.error('');
  for (const message of [messages].flat())
    console.error(`  ${c.red}${message}${c.reset}`);
  console.error('');
  return 1;
}

function notInstalledMessage(provider, agent) {
  return `${provider.label} CLI is not installed. Install it with npm i -g ${agent.install.package}, then retry.`;
}

function higherVersion(left, right) {
  if (!left || !right) return left || right || null;
  return versionNeedsUpgrade(left, right) ? right : left;
}

/**
 * The version of the agent binary in `binDir`, or null. The probe gets a
 * throwaway home, so the check, a dry run, and status write nothing in the
 * user's agent home.
 */
async function readBinaryVersion(provider, binDir) {
  const probeHome = await fs.mkdtemp(
    path.join(os.tmpdir(), `subc-t3-${provider.id}-`),
  );
  try {
    return readClaudeVersion(provider.binaryName, binDir, {
      env: provider.versionProbeEnv(probeHome),
    });
  } finally {
    await fs.rm(probeHome, { recursive: true, force: true });
  }
}

/** The pinned binary path and its version. Throws T3LaunchError. */
async function checkBinary(provider, agent, binDir) {
  // The path as found, not its real path: Claude Code's native installer
  // links ~/.local/bin/claude to a versioned file that a later update
  // removes.
  const binary = path.join(binDir, provider.binaryName);
  const version = await readBinaryVersion(provider, binDir);
  if (!version)
    throw new T3LaunchError(`Could not read the version of ${binary}.`);
  const minimum = higherVersion(
    provider.minimumVersion,
    agent.install.minimum_version,
  );
  if (versionNeedsUpgrade(version, minimum))
    throw new T3LaunchError(
      `${provider.label} ${version} is older than ${minimum}, the oldest version this provider supports. Upgrade ${provider.label}, then retry.`,
    );
  const recommended = provider.recommendedVersion;
  const warning = versionNeedsUpgrade(version, recommended)
    ? `${provider.label} ${version} is older than ${recommended}, the version T3 Code recommends. Upgrade ${provider.label} if T3 Code reports a problem.`
    : null;
  return { path: binary, version, warning };
}

/**
 * Check that this system can start the launcher: its first line needs an
 * env that supports -S, and bash. The check runs the same command the
 * kernel runs for that line, so it writes no file.
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
  item.adapter = await adapterPath(provider);
  item.script = launcherScript({
    provider,
    node: process.execPath,
    adapter: item.adapter,
    binary: item.binary.path,
    configDir: paths.configDir,
    version: await packageVersion(),
  });
  item.legacy = await legacyHome(paths, provider);
}

function printPlan(item, single) {
  const { provider, target, report, binary, launch } = item;
  if (!single) {
    console.log(`\n  ${c.bold}${provider.displayName}${c.reset}`);
    line('Provider', `${provider.instanceId}: ${describeEntry(report)}`);
  }
  line('Launcher', target.launcherPath);
  line(provider.label, `${binary.path} (${binary.version})`);
  if (binary.warning) line('', `${c.yellow}${binary.warning}${c.reset}`);
  if (target.homePath)
    line(
      `${provider.label} home`,
      `${target.homePath} (shared with subc ${provider.id})`,
    );
  else if (provider.homeNote) line('Config', provider.homeNote);
  line(
    'Model',
    `${launch.model} from the default profile, read again at each launch`,
  );
  line(
    'Catalog',
    `${launch.catalog.models.length} models, key-scoped, from ${new URL(launch.baseUrl).origin}`,
  );
  if (provider.hooks)
    line(
      'Hooks',
      'compaction hooks in that Codex home, as subc codex sets them up, inert until trusted',
    );
  if (item.legacy) lines('Old home', legacyHomeLines(item.legacy, provider));
}

/** What stayed in place when the settings write failed. */
function settingsFailure(item, error) {
  const { provider, target } = item;
  const messages = [
    `T3 Code settings were not updated: ${error.message}`,
    `The launcher ${target.launcherPath} is in place.`,
  ];
  if (provider.hooks)
    messages.push(
      `The compaction hooks are in ${target.homePath}, shared with subc ${provider.id}. They run only for ${provider.label} sessions that subc starts, so they send nothing on their own.`,
      `Retry subc t3 install. subc t3 uninstall removes only the launcher, because subc ${provider.id} uses the hooks too.`,
    );
  else
    messages.push(
      'Retry subc t3 install, or run subc t3 uninstall to remove the launcher.',
    );
  return failWith(messages);
}

/** Write the launcher, the hooks, and the settings entry for one provider. */
async function installOne(paths, item, single) {
  const { provider, target, launch } = item;
  // The agent home belongs to the user and the agent, so subc creates it if
  // needed but never changes its mode.
  if (target.homePath) await fs.mkdir(target.homePath, { recursive: true });
  await writeLauncher(target.launcherPath, item.script);
  if (provider.hooks && installHooks(target.homePath, launch) !== 0)
    return failWith(
      `Could not set up the compaction hooks in ${target.homePath}. T3 Code settings were not changed. The launcher ${target.launcherPath} stays; subc t3 uninstall removes it.`,
    );
  let result;
  try {
    result = await installT3Provider(target, { backupDir: paths.backups });
  } catch (error) {
    return settingsFailure(item, error);
  }
  if (result.backup) line('Backup', result.backup);
  console.log(
    `${single ? '\n' : ''}  ${c.green}${c.bold}✓ ${provider.displayName} is ${result.changed ? 'ready' : 'already set up'} in T3 Code.${c.reset}`,
  );
  console.log(
    `  ${c.dim}T3 Code reloads its settings on its own. Pick ${provider.displayName} as the provider for a new thread.${c.reset}${single ? '\n' : ''}`,
  );
  return 0;
}

async function install({ dryRun, providers, explicit }) {
  const paths = t3Paths(configDir());
  const found = [];
  const missing = [];
  for (const provider of providers) {
    const agent = agentById(provider.agentId);
    const binDir = await locateAgent(agent);
    if (binDir) found.push({ provider, agent, binDir });
    else
      missing.push({ provider, message: notInstalledMessage(provider, agent) });
  }
  // Without --provider, a provider whose CLI is missing is skipped.
  if (!found.length || (explicit && missing.length))
    return failWith(missing.map((item) => item.message));

  for (const item of found) {
    item.target = context(item.provider).target;
    item.report = await inspectT3(item.target);
  }
  const blockers = [
    ...new Set(found.flatMap((item) => settingsBlockers(item.report))),
  ];
  if (blockers.length) return failWith(blockers);

  const single = found.length === 1;
  try {
    checkLauncherShell();
  } catch (error) {
    if (error instanceof T3LaunchError) return failWith(error.message);
    throw error;
  }
  for (const item of found) {
    try {
      await prepare(paths, item);
    } catch (error) {
      if (!(error instanceof T3LaunchError)) throw error;
      return failWith(
        single
          ? error.message
          : [
              `${item.provider.displayName}: ${error.message}`,
              'Nothing was changed. Use --provider to install the other providers.',
            ],
      );
    }
  }

  const [first] = found;
  console.log(
    `\n  ${c.bold}${dryRun ? 'Plan' : 'Installing'}: ${single ? first.provider.displayName : 'Subconscious providers'} in T3 Code${c.reset}\n`,
  );
  line(
    'T3 Code',
    `${first.report.home}${first.report.version ? ` (${first.report.version})` : ''}`,
  );
  if (single)
    line(
      'Provider',
      `${first.provider.instanceId}: ${describeEntry(first.report)}`,
    );
  line('Settings', first.report.settingsPath);
  for (const item of found) printPlan(item, single);
  for (const item of missing)
    line('Skipped', `${item.provider.displayName}: ${item.message}`);
  console.log('');
  if (dryRun) {
    console.log(`  ${c.dim}Dry run: nothing was changed.${c.reset}\n`);
    return 0;
  }

  await privateDir(paths.root);
  let code = 0;
  // A failure in one provider does not stop the others.
  for (const item of found) {
    if ((await installOne(paths, item, single)) !== 0) code = 1;
  }
  if (!single && code === 0) console.log('');
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
    return `broken: pinned ${missing.join(', ')} missing; run subc t3 install`;
  const notes = [];
  const version = await packageVersion();
  if (launcher.version !== version)
    notes.push(`written by subc ${launcher.version}, this is ${version}`);
  else if (
    launcher.text !==
    launcherScript({
      provider,
      node: pinned.node,
      adapter: pinned.adapter,
      binary: pinned[provider.binaryName],
      configDir: pinned.config_dir ?? '',
      version,
    })
  )
    notes.push('written in an older format');
  if (pinned.adapter !== (await adapterPath(provider)))
    notes.push('pins another subc install');
  if (pinned.config_dir !== paths.configDir)
    notes.push(`pins config dir ${pinned.config_dir}`);
  return notes.length
    ? `stale (${notes.join('; ')}); run subc t3 install`
    : 'current';
}

/** The binary the launcher pins and its version, or null with no launcher. */
async function binaryReport(file, provider) {
  const launcher = await readLauncher(file, provider);
  const binary = launcher.pinned?.[provider.binaryName];
  if (!binary) return null;
  if (!(await exists(binary))) return `${binary} (missing)`;
  const version = await readBinaryVersion(provider, path.dirname(binary));
  return `${binary} (${version ?? 'version unknown'})`;
}

function entryReport(report) {
  if (report.state !== 'ok') return `${report.state}: ${report.problem}`;
  if (report.entry === 'absent') return 'not installed';
  if (report.entry === 'conflict') return `conflict: ${report.problem}`;
  if (report.drift.length)
    return `installed, changed in T3 (${report.drift.join(', ')}); run subc t3 install`;
  return 'installed';
}

/** The hook state, read from the files on every run. */
function hookReport(hooks, report) {
  if (!hooks.readable) return `${hooks.hooksJson} is not valid JSON`;
  if (!hooks.entries)
    return report.entry === 'owned'
      ? `missing from ${hooks.hooksJson}, so T3 Code sessions run without them. Run subc t3 install to set them up again`
      : 'not installed';
  let text = `${hooks.entries} entries`;
  if (hooks.stale)
    text += `, ${hooks.stale} run another path (run subc t3 install to fix)`;
  if (!hooks.script) text += ', hook script missing';
  if (hooks.envFile) {
    const mode = hooks.envMode;
    text += `, env file present (mode ${mode?.toString(8) ?? 'unknown'}${mode !== null && mode & 0o077 ? ', readable by others' : ''})`;
  } else {
    text += ', env file missing';
  }
  if (!hooks.script || !hooks.envFile) text += '; run subc t3 install to fix';
  return text;
}

async function status({ providers }) {
  const single = providers.length === 1;
  const items = [];
  for (const provider of providers) {
    const { paths, target } = context(provider);
    items.push({ provider, paths, target, report: await inspectT3(target) });
  }
  const { report: first } = items[0];
  console.log(
    `\n  ${c.bold}${single ? providers[0].displayName : 'Subconscious providers'} in T3 Code${c.reset}\n`,
  );
  line('T3 Code', `${first.home}${first.version ? ` (${first.version})` : ''}`);
  line('Settings', first.settingsPath);
  line(
    'Policy',
    first.policy === 'none'
      ? 'none'
      : `${first.policy}; subc does not edit settings`,
  );
  for (const { provider, paths, target, report } of items) {
    if (!single) console.log(`\n  ${c.bold}${provider.displayName}${c.reset}`);
    line('Provider', `${provider.instanceId}: ${entryReport(report)}`);
    if (report.duplicates.length)
      line('Also runs it', report.duplicates.join(', '));
    line(
      'Launcher',
      `${target.launcherPath}: ${await launcherReport(paths, provider, target.launcherPath)}`,
    );
    const binary = await binaryReport(target.launcherPath, provider);
    if (binary) line(provider.label, binary);
    if (target.homePath)
      line(
        `${provider.label} home`,
        `${target.homePath}${(await exists(target.homePath)) ? '' : ' (missing)'}`,
      );
    else if (provider.homeNote) line('Config', provider.homeNote);
    if (provider.hooks)
      line('Hooks', hookReport(await hookStatus(target.homePath), report));
    const legacy = await legacyHome(paths, provider);
    if (legacy) lines('Old home', legacyHomeLines(legacy, provider));
  }
  console.log('');
  return 0;
}

async function uninstall({ providers }) {
  const problems = [];
  const done = [];
  const notes = [];
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

    // The Codex hooks in ~/.codex also serve plain `subc codex`, so they stay.
    if (provider.hooks) {
      const hooks = await hookStatus(target.homePath);
      if (hooks.entries || hooks.script || hooks.envFile)
        notes.push(
          `Kept the compaction hooks in ${target.homePath}, because subc ${provider.id} uses them too.`,
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
    for (const dir of provider.ownedDirs)
      await fs.rm(paths.underRoot(dir), { recursive: true, force: true });
    const legacy = await legacyHome(paths, provider);
    if (legacy) notes.push(...legacyHomeLines(legacy, provider));
  }
  // subc 8.2.0 wrote this file. Nothing reads it now.
  await fs.rm(paths.state, { force: true });

  console.log('');
  for (const message of done) console.log(`  ${message}`);
  for (const note of notes) console.log(`  ${c.dim}${note}${c.reset}`);
  if (problems.length) return failWith(problems);
  console.log(
    `\n  ${c.green}${c.bold}✓ T3 Code integration removed.${c.reset}\n`,
  );
  return 0;
}

/**
 * The providers that `--provider` names, in table order, or every
 * registered provider when it names none. Throws on a key that is unknown
 * or not available yet.
 */
function selectProviders(keys) {
  if (!keys.length) return { providers: T3_PROVIDERS, explicit: false };
  for (const key of keys) {
    if (providerByKey(key)) continue;
    const available = T3_PROVIDERS.map((provider) => provider.id).join(', ');
    if (T3_PROVIDER_KEYS.includes(key))
      throw new Error(
        `The ${key} provider is not available yet in this version of subc t3. Available: ${available}.`,
      );
    throw new Error(
      `Unknown provider: ${key}. Use one of: ${T3_PROVIDER_KEYS.join(', ')}.`,
    );
  }
  return {
    providers: T3_PROVIDERS.filter((provider) => keys.includes(provider.id)),
    explicit: true,
  };
}

function parseOptions(action, args) {
  const keys = [];
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (action === 'install' && arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--provider' || arg.startsWith('--provider=')) {
      const value = arg === '--provider' ? args[++i] : arg.slice(11);
      if (!value)
        throw new Error(
          `--provider needs a name: ${T3_PROVIDER_KEYS.join(', ')}.`,
        );
      keys.push(value);
    } else {
      throw new Error(`Unknown argument for subc t3 ${action}: ${arg}`);
    }
  }
  return { dryRun, ...selectProviders(keys) };
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
