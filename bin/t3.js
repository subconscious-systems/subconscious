/**
 * `subc t3 install|status|uninstall`: add Subconscious providers to T3 Code
 * on macOS and Linux. The provider table in `t3-providers.js` lists them.
 *
 * T3 Code is a host for the agent, so this is not another coding agent.
 * Install checks the agent, the default profile's key, and the live
 * key-scoped catalog, then writes a launcher, sets up the provider's hooks
 * (for Codex, the compaction hooks in ~/.codex, the way `subc codex` does),
 * and adds one entry to T3's settings. Every launch reads the default
 * profile again, so a new key or model needs no reinstall. For OpenCode, a
 * launch is the start of T3 Code's shared OpenCode helper.
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
  watchdogName,
} from './t3-launch.js';
import { T3_PROVIDER_KEYS, T3_PROVIDERS } from './t3-providers.js';
import {
  inspectT3,
  installT3Provider,
  readT3ModelCache,
  readT3ModelPreferences,
  readT3TextGeneration,
  removeT3Provider,
  settingsBlockers,
  t3HomeDir,
  writeT3HideList,
} from './t3-settings.js';

const HOOK_MARKER = 'subconscious-hook.sh';
const HOOK_ENV_FILE = 'subconscious-hooks.env';

export function printT3Help() {
  const available = T3_PROVIDERS.map((provider) => provider.id).join(', ');
  console.log(`
Usage:
  subc t3 install [--provider NAME]... [--dry-run]
  subc t3 status [--provider NAME]...
  subc t3 uninstall [--provider NAME]...
  subc t3 help

Adds three providers to T3 Code. Each runs Codex, Claude Code, or OpenCode
on your hosted Subconscious models:
  Subconscious (Codex)      runs codex
  Subconscious (Claude)     runs claude, beta
  Subconscious (OpenCode)   runs opencode, beta
It works on macOS and Linux only, and with the default profile only.

  install            Check each CLI, the default profile's key, and the live
                     model catalog. Then write what the next section lists.
  install --dry-run  Run every check and print the plan. Change nothing.
  status             Show the state of each provider. Needs no network or key.
  uninstall          Remove the entries, the launchers, and the hide list.
  --provider NAME    Act on this provider only. Repeat it to name more.
                     Available: ${available}.
                     Without it, install sets up every provider whose CLI is
                     found, and skips one that a check refuses, such as an
                     old CLI. It fails only when no provider is left. Status
                     and uninstall cover all of them.

What install writes:
  - One entry per provider in T3 Code's settings.json: subconscious-codex,
    subconscious-claude, and subconscious-opencode.
  - One launcher per provider in ~/.subconscious/bin: subc-t3-codex,
    subc-t3-claude, and subc-t3-opencode. T3 Code runs it as the CLI.
  - The Codex compaction hooks in ~/.codex, the same ones that subc codex
    writes.
  - The Claude hide list, providerModelPreferences["subconscious-claude"].
    It is the one write outside subc's own entries.
  Install backs up settings.json to ~/.subconscious/t3/backups first. T3
  Code reloads its settings on its own; subc never restarts it.

Shared homes:
  Each provider uses the same folders as the matching subc command, so your
  settings, skills, and MCP servers carry over:
  - Codex uses ~/.codex, the same Codex home as subc codex. subc
    never edits your config.toml.
  - Claude Code uses your ~/.claude and ~/.claude.json. subc writes nothing
    there.
  - OpenCode uses ~/.config/opencode and ~/.local/share/opencode. subc
    writes nothing there.

Status:
  Status reads the entries, the launchers, the CLI versions, and the Codex
  hooks on every run. It also shows the Claude hide list, the running
  OpenCode helpers, and where T3 Code sends thread titles and commit
  messages.
  Exit codes:
    0  Every installed provider works, or nothing is installed.
    1  A provider is broken: a conflict, a missing or foreign launcher,
       unreadable settings, drift, missing Codex hooks, or a CLI version
       that install refuses. Run subc t3 install to repair it.

Uninstall:
  Uninstall removes the entries, the launchers, the Codex catalog file, and
  the Claude hide list. It keeps the Codex hooks, because subc codex uses
  them. It keeps the shared homes and your T3 Code threads.

Codex:
  Each session reads the default profile again, so a new key or model
  applies at the next launch. Codex apps and plugins stay off unless
  CODEX_EXTERNAL_TOOLS=true is in the default profile. Codex runs the hooks
  only after you trust them with /hooks. The hook env file holds the key,
  mode 600. After subc codex uninstall, run subc t3 install to add them back.

Claude Code (beta):
  It needs Claude Code 2.1.280 or newer, and warns below 2.1.301. Each
  session reads the default profile again.
  - T3 Code also lists its built-in Claude models on this provider. Install
    hides them in the model picker with the hide list.
  - T3 Code creates that setting only after you hide or reorder a
    model in its settings. Do that once, then run subc t3 install again.
  - Status reports a new built-in model as drift.
  - A model outside your catalog runs as the default profile's model, and
    the launcher logs one line that names both models.
  - T3 Code lets you switch a running thread between its own Claude
    provider and this one. The next turn sends the whole thread to the
    other backend.
  - Each launch pins ANTHROPIC_BASE_URL and the OTEL log endpoint in its
    --settings value, so a repo's .claude/settings.json or your
    ~/.claude/settings.json cannot send the key to another host.
  - Claude Code still loads a repo's project settings, as in subc claude.
    Hooks in a repo's .claude/settings.json and its project MCP servers
    run with the key in their env. Open only repos that you trust.

OpenCode (beta):
  It needs OpenCode 2.0.18 or newer. T3 Code starts one helper, opencode
  serve, for all threads of the provider.
  - A new key or model applies after the OpenCode helper restarts: restart
    T3 Code, or wait until its OpenCode threads have been idle for 30
    minutes.
  - Keep the provider's Server URL and Server password empty in T3 Code.
    Status reports either one as drift.
  - When T3 Code's server dies, the launcher's watchdog sends SIGTERM to
    the helper's process group, then SIGKILL 5 s later, so the helper is
    gone within about 10 s. The watchdog needs ps, so install refuses
    this provider on a system without it, such as a Linux image without
    procps.

Limits for all providers:
  - T3 Code writes thread titles and commit messages with its own text
    generation setting. subc never changes it. Status says where it points.
  - If the key-scoped catalog cannot be read, the agent does not start.
    There is no fallback to the public or packaged model list.
  - The launcher's first line, #!/usr/bin/env -S bash -p, needs bash and an
    env that supports -S: macOS, or GNU coreutils 8.30 or newer.
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

/**
 * Check that the watchdog can read a parent PID here. The watchdog runs
 * `ps -o ppid= -p PID`, and some Linux images, such as debian:bookworm-slim,
 * ship no ps. Without it, the watchdog cannot tell when T3 Code's server
 * dies, so a helper with the key could outlive it.
 */
function checkWatchdogTools() {
  const result = spawnSync('bash', ['-c', 'ps -o ppid= -p $$ | tr -d " "'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', LC_ALL: 'C' },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0 || !/^\d+\n?$/.test(result.stdout ?? ''))
    throw new T3LaunchError(
      'This system cannot run the helper watchdog, because "ps -o ppid= -p $$" failed. Install procps (for example, apt install procps), then retry.',
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
  if (provider.watchdog) checkWatchdogTools();
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
    `${launch.model} from the default profile, read again ${provider.freshnessNote ? 'when the helper starts' : 'at each launch'}`,
  );
  line(
    'Catalog',
    `${launch.catalog.models.length} models, key-scoped, from ${new URL(launch.baseUrl).origin}`,
  );
  if (provider.freshnessNote) line('Freshness', provider.freshnessNote);
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

const HIDE_LIST_HINT =
  'In T3 Code, hide or reorder any model once, then run subc t3 install again.';
const HIDE_LIST_FALLBACK =
  "Until then, a model outside the catalog runs as the default profile's model.";
// How long install waits for T3 Code to probe the new entry and write its
// model cache. T3 Code probes about 1 s after a settings change.
const CACHE_WAIT_MS = 30_000;
const CACHE_POLL_MS = 250;

/**
 * The cache wait. SUBC_T3_CACHE_WAIT_MS is a test knob that can only make
 * the wait shorter. Any value that is not a positive number is ignored.
 */
export function cacheWaitMs(env = process.env) {
  const value = Number(env.SUBC_T3_CACHE_WAIT_MS);
  return Number.isFinite(value) && value > 0
    ? Math.min(value, CACHE_WAIT_MS)
    : CACHE_WAIT_MS;
}

/**
 * The model cache to build the hide list from. With `since`, only a cache
 * of subc's instance that T3 Code wrote at or after `since` counts, because
 * an earlier install may have left an old one. Without it, any cache of
 * subc's instance counts. When none appears within `waitMs`, the built-in
 * instance's cache is used, or null when it is missing too.
 */
async function hideListCache(provider, home, { since, waitMs }) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const cache = await readT3ModelCache(home, provider.instanceId);
    if (cache && (since === null || (cache.checkedAt ?? 0) >= since))
      return cache;
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, CACHE_POLL_MS));
  }
  return readT3ModelCache(home, provider.builtInInstanceId);
}

/**
 * What the hide list would be: every model in the cache that is not in the
 * key-scoped catalog, so it never hides a catalog model. `state` is
 * `ready`, `unmigrated`, `invalid`, `unreadable`, or `no-cache`.
 */
async function planHideList(item, { since, waitMs }) {
  const { provider, target, launch } = item;
  const prefs = await readT3ModelPreferences(target);
  if (prefs.state === 'unmigrated' || prefs.state === 'invalid')
    return { state: prefs.state };
  if (prefs.state === 'unreadable') return { state: 'unreadable' };
  const cache = await hideListCache(provider, target.home, { since, waitMs });
  if (!cache) return { state: 'no-cache' };
  const catalog = new Set(launch.catalog.models);
  return {
    state: 'ready',
    cache: cache.file,
    hiddenModels: cache.slugs.filter((slug) => !catalog.has(slug)),
  };
}

function hideListSkipLines(plan, provider, waitMs) {
  if (plan.state === 'unmigrated')
    return [
      `Skipped: T3 Code has no model preferences yet. ${HIDE_LIST_HINT}`,
      HIDE_LIST_FALLBACK,
    ];
  if (plan.state === 'invalid')
    return [
      'Skipped: providerModelPreferences in the T3 Code settings is not an object.',
      HIDE_LIST_FALLBACK,
    ];
  if (plan.state === 'no-cache')
    return [
      `Skipped: T3 Code wrote no model cache for ${provider.instanceId} or ${provider.builtInInstanceId}${waitMs ? ` within ${Math.round(waitMs / 1000)} s` : ''}. Open T3 Code, then run subc t3 install again.`,
      HIDE_LIST_FALLBACK,
    ];
  return ['Skipped: the T3 Code settings could not be read.'];
}

function modelList(models) {
  return models.length ? models.join(', ') : 'none';
}

/** Print the hide list that install would write. Writes nothing. */
async function printHideListPlan(item) {
  const plan = await planHideList(item, { since: null, waitMs: 0 });
  if (plan.state !== 'ready') {
    lines('Hide list', hideListSkipLines(plan, item.provider, 0));
    return;
  }
  lines('Hide list', [
    `would hide ${plan.hiddenModels.length} models that are not in the catalog: ${modelList(plan.hiddenModels)}`,
    `from ${plan.cache}`,
  ]);
}

/**
 * Write the hide list after the entry is in place. A skip or a failure
 * leaves the provider installed, because the launcher's fallback covers
 * the models the list would hide.
 */
async function installHideList(paths, item, { since, waitMs }) {
  const { provider, target } = item;
  const plan = await planHideList(item, { since, waitMs });
  if (plan.state !== 'ready') {
    lines('Hide list', hideListSkipLines(plan, provider, waitMs));
    return;
  }
  try {
    const result = await writeT3HideList(target, plan.hiddenModels, {
      backupDir: paths.backups,
    });
    if (result.state === 'written' || result.state === 'current')
      line(
        'Hide list',
        `${result.state === 'written' ? 'hid' : 'already hides'} ${plan.hiddenModels.length} models that are not in the catalog: ${modelList(plan.hiddenModels)}`,
      );
    else
      lines(
        'Hide list',
        hideListSkipLines({ state: 'unmigrated' }, provider, waitMs),
      );
  } catch (error) {
    lines('Hide list', [
      `${c.yellow}Not written: ${error.message}${c.reset}`,
      HIDE_LIST_FALLBACK,
    ]);
  }
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
  // T3 Code's cache records each probe's time at second precision.
  const since = Math.floor(Date.now() / 1000) * 1000;
  let result;
  try {
    result = await installT3Provider(target, { backupDir: paths.backups });
  } catch (error) {
    return settingsFailure(item, error);
  }
  if (result.backup) line('Backup', result.backup);
  if (provider.builtInInstanceId)
    // A new or repaired entry makes T3 Code probe it again, so only a cache
    // from that probe counts.
    await installHideList(paths, item, {
      since: result.changed ? since : null,
      waitMs: item.cacheWaitMs,
    });
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
  // Read before prepare() removes every SUBC_* name from the env.
  const waitMs = cacheWaitMs();
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
    item.cacheWaitMs = waitMs;
  }
  const blockers = [
    ...new Set(found.flatMap((item) => settingsBlockers(item.report))),
  ];
  if (blockers.length) return failWith(blockers);

  try {
    checkLauncherShell();
  } catch (error) {
    if (error instanceof T3LaunchError) return failWith(error.message);
    throw error;
  }
  // Without --provider, a provider that a check refuses, such as an old
  // CLI, is skipped with its message, and the others install (D5). With
  // --provider, every named provider must pass.
  const ready = [];
  const refused = [];
  for (const item of found) {
    try {
      await prepare(paths, item);
      ready.push(item);
    } catch (error) {
      if (!(error instanceof T3LaunchError)) throw error;
      refused.push({ provider: item.provider, message: error.message });
    }
  }
  if (!ready.length || (explicit && refused.length)) {
    if (found.length === 1) return failWith(refused[0].message);
    // One cause for every provider, such as a missing key, prints once.
    const texts = new Set(refused.map((item) => item.message));
    return failWith([
      ...(texts.size === 1 && refused.length > 1
        ? texts
        : refused.map(
            (item) => `${item.provider.displayName}: ${item.message}`,
          )),
      'Nothing was changed.',
    ]);
  }
  const single = ready.length === 1;

  const [first] = ready;
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
  for (const item of ready) {
    printPlan(item, single);
    if (dryRun && item.provider.builtInInstanceId)
      await printHideListPlan(item);
  }
  if (refused.length || missing.length) console.log('');
  for (const item of refused)
    line(
      'Skipped',
      `${c.yellow}${item.provider.displayName}: ${item.message}${c.reset}`,
    );
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
  for (const item of ready) {
    if ((await installOne(paths, item, single)) !== 0) code = 1;
  }
  if (!single && code === 0) console.log('');
  return code;
}

/**
 * The launcher's state and the text status prints for it. `state` is
 * `missing`, `foreign`, `broken`, `stale`, or `current`. A stale launcher
 * still starts the agent, so only the first three are broken.
 */
async function launcherReport(paths, provider, file) {
  const launcher = await readLauncher(file, provider);
  if (launcher.state !== 'present')
    return { state: launcher.state, text: launcher.state };
  const { pinned } = launcher;
  const missing = [];
  for (const name of ['node', 'adapter', provider.binaryName])
    if (!pinned[name] || !(await exists(pinned[name]))) missing.push(name);
  if (missing.length)
    return {
      state: 'broken',
      text: `broken: pinned ${missing.join(', ')} missing; run subc t3 install`,
    };
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
    ? {
        state: 'stale',
        text: `stale (${notes.join('; ')}); run subc t3 install`,
      }
    : { state: 'current', text: 'current' };
}

/**
 * The binary the launcher pins and its version, or null with no launcher.
 * `refused` is true when install would refuse that binary: its version
 * cannot be read, or it is older than the provider supports.
 */
async function binaryReport(file, provider) {
  const launcher = await readLauncher(file, provider);
  const binary = launcher.pinned?.[provider.binaryName];
  if (!binary) return null;
  if (!(await exists(binary)))
    return { text: `${binary} (missing)`, refused: false };
  const version = await readBinaryVersion(provider, path.dirname(binary));
  if (!version) return { text: `${binary} (version unknown)`, refused: true };
  const minimum = higherVersion(
    provider.minimumVersion,
    agentById(provider.agentId).install.minimum_version,
  );
  if (versionNeedsUpgrade(version, minimum))
    return {
      text: `${binary} (${version}) ${c.yellow}is older than ${minimum}, the oldest version this provider supports. Upgrade ${provider.label}.${c.reset}`,
      refused: true,
    };
  return { text: `${binary} (${version})`, refused: false };
}

/**
 * The hide list state, read from the settings and T3 Code's caches with no
 * network. Status has no catalog, so it reports drift for a model that the
 * built-in instance lists and the hide list does not hide. A new T3 Code
 * release, or a new remote model list, adds such models.
 */
async function hideListReport(target, provider, report) {
  if (report.state !== 'ok')
    return { lines: ['unknown, because the settings cannot be read'] };
  const prefs = await readT3ModelPreferences(target);
  if (prefs.state === 'unmigrated')
    return {
      lines: [
        `skipped, because T3 Code has no model preferences yet. ${HIDE_LIST_HINT}`,
        HIDE_LIST_FALLBACK,
      ],
    };
  if (prefs.state === 'invalid')
    return {
      lines: ['skipped, because providerModelPreferences is not an object'],
    };
  if (prefs.state !== 'present')
    return {
      lines: [
        report.entry === 'owned'
          ? 'not written. Run subc t3 install to write it.'
          : 'not written',
      ],
    };
  const lines = [`written, ${prefs.hiddenModels.length} models hidden`];
  const builtIn = await readT3ModelCache(
    target.home,
    provider.builtInInstanceId,
  );
  const own = await readT3ModelCache(target.home, provider.instanceId);
  if (!builtIn) {
    lines.push(
      `cannot check for new built-in models, because T3 Code has no caches/${provider.builtInInstanceId}.json`,
    );
    return { lines };
  }
  const hidden = new Set(prefs.hiddenModels);
  const listed = own
    ? own.slugs.filter((slug) => builtIn.slugs.includes(slug))
    : builtIn.slugs;
  const drift = listed.filter((slug) => !hidden.has(slug));
  if (drift.length)
    lines.push(
      `${c.yellow}drift: T3 Code lists ${drift.length} built-in models that the hide list does not hide: ${drift.join(', ')}. Run subc t3 install again.${c.reset}`,
    );
  return { lines, drift: drift.length > 0 };
}

function entryReport(report) {
  if (report.state !== 'ok') return `${report.state}: ${report.problem}`;
  if (report.entry === 'absent') return 'not installed';
  if (report.entry === 'conflict') return `conflict: ${report.problem}`;
  if (report.drift.length)
    return `installed, changed in T3 (${report.drift.join(', ')}); run subc t3 install`;
  return 'installed';
}

/**
 * The hook state, read from the files on every run. `broken` is true when
 * subc's entry is in T3 Code but its sessions would run without working
 * hooks.
 */
function hookReport(hooks, report) {
  const owned = report.entry === 'owned';
  if (!hooks.readable)
    return { text: `${hooks.hooksJson} is not valid JSON`, broken: owned };
  if (!hooks.entries)
    return owned
      ? {
          text: `missing from ${hooks.hooksJson}, so T3 Code sessions run without them. Run subc t3 install to set them up again`,
          broken: true,
        }
      : { text: 'not installed', broken: false };
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
  return {
    text,
    broken: owned && Boolean(hooks.stale || !hooks.script || !hooks.envFile),
  };
}

function runPs(args) {
  const result = spawnSync('ps', args, {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', LC_ALL: 'C' },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.error ? null : result;
}

/**
 * The helpers that this config dir's launcher started and still watches,
 * as `{ pid, started }`, or null when ps fails. Each watchdog runs as
 * `bash -p -c SCRIPT <name> <helper pid> <parent pid> <config dir>`, so
 * one ps call finds the helpers, and a second reads their start times.
 * Only the PID and the start time are read, never the env.
 */
function runningHelpers(provider, configDir) {
  const list = runPs(['-A', '-ww', '-o', 'pid=,command=']);
  if (list?.status !== 0) return null;
  const marker = new RegExp(`\\s${watchdogName(provider)} (\\d+) \\d+ $`);
  const pids = new Set();
  for (const row of list.stdout.split('\n')) {
    const command = row.trim().replace(/^\d+\s+/, '');
    if (!command.endsWith(` ${configDir}`)) continue;
    const match = marker.exec(command.slice(0, -configDir.length));
    if (match) pids.add(match[1]);
  }
  if (!pids.size) return [];
  // ps exits 1 when one of the PIDs has ended since the first call.
  const info = runPs(['-o', 'pid=,lstart=', '-p', [...pids].join(',')]);
  if (!info) return null;
  return info.stdout
    .split('\n')
    .map((row) => /^\s*(\d+)\s+(\S.*?)\s*$/.exec(row))
    .filter(Boolean)
    .map(([, pid, started]) => ({ pid: Number(pid), started }));
}

function helperLines(helpers) {
  if (helpers === null) return ['unknown, because ps failed'];
  if (!helpers.length) return ['none running'];
  return helpers.map(({ pid, started }) => `PID ${pid}, started ${started}`);
}

const TEXT_GENERATION_HINT =
  'To change it, open Settings in T3 Code, then Text generation, and pick a Subconscious provider. subc never changes this setting.';
const COMMIT_WRITER_HINT =
  'Commit messages have their own model in Settings, Commits & pull requests.';

function selectionText(selection) {
  if (selection.kind === 'invalid') return 'a value that subc cannot read';
  const name =
    selection.name === selection.instanceId
      ? selection.instanceId
      : `${selection.name} (${selection.instanceId})`;
  const where =
    selection.kind === 'textGenerator' && selection.origin
      ? ` at ${selection.origin}`
      : '';
  const model = selection.model ? `, model ${selection.model}` : '';
  const fallback = selection.isDefault ? ", T3 Code's default" : '';
  return `${name}${where}${model}${fallback}`;
}

/**
 * Where T3 Code sends thread titles and commit messages, with a warning
 * when that is not a Subconscious provider (D6). subc never writes these
 * settings, so status only reports them.
 */
async function textGenerationLines(home) {
  const targets = T3_PROVIDERS.map((provider) => context(provider).target);
  const result = await readT3TextGeneration(home, targets);
  if (result.state !== 'ok')
    return ['unknown, because the settings cannot be read'];
  const { titles, commits } = result;
  const groups = commits
    ? [
        ['Thread titles', titles],
        ['Commit messages', commits],
      ]
    : [['Thread titles and commit messages', titles]];
  const lines = [];
  for (const [what, selection] of groups) {
    if (selection.kind === 'subconscious')
      lines.push(`${what} go to Subconscious: ${selectionText(selection)}.`);
    else
      lines.push(
        `${c.yellow}${what} go to ${selectionText(selection)}, not to Subconscious. That provider gets the prompts and the diffs.${c.reset}`,
      );
  }
  const foreign = groups.filter(
    ([, selection]) => selection.kind !== 'subconscious',
  );
  if (foreign.length) {
    lines.push(TEXT_GENERATION_HINT);
    if (commits && commits.kind !== 'subconscious')
      lines.push(COMMIT_WRITER_HINT);
  }
  return lines;
}

/**
 * Why a provider is broken, as short phrases, or none. A provider that has
 * no entry, no launcher, and no conflict is not installed, so it is not
 * broken, even when --provider names it.
 */
function brokenReasons(
  { report, launcher, binary, hooks, hideList },
  explicit,
) {
  const installed = report.entry === 'owned' || launcher.state !== 'missing';
  const reasons = [];
  if (report.state !== 'ok') {
    if (installed || (explicit && report.state !== 'missing'))
      reasons.push(`T3 Code settings ${report.state}`);
    return reasons;
  }
  if (report.entry === 'conflict')
    reasons.push('an entry that subc did not write');
  if (report.entry === 'absent' && installed)
    reasons.push('a launcher with no entry in T3 Code');
  if (report.entry === 'owned' && report.drift.length)
    reasons.push(`drift in ${report.drift.join(', ')}`);
  if (
    report.entry === 'owned' &&
    ['missing', 'foreign', 'broken'].includes(launcher.state)
  )
    reasons.push(`launcher ${launcher.state}`);
  if (binary?.refused) reasons.push('a CLI version that install refuses');
  if (hooks?.broken) reasons.push('missing or broken Codex hooks');
  if (hideList?.drift) reasons.push('hide list drift');
  return reasons;
}

async function status({ providers, explicit }) {
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
  lines('Text gen', await textGenerationLines(first.home));
  const broken = [];
  for (const item of items) {
    const { provider, paths, target, report } = item;
    if (!single) console.log(`\n  ${c.bold}${provider.displayName}${c.reset}`);
    line('Provider', `${provider.instanceId}: ${entryReport(report)}`);
    if (report.duplicates.length)
      line('Also runs it', report.duplicates.join(', '));
    item.launcher = await launcherReport(paths, provider, target.launcherPath);
    line('Launcher', `${target.launcherPath}: ${item.launcher.text}`);
    item.binary = await binaryReport(target.launcherPath, provider);
    if (item.binary) line(provider.label, item.binary.text);
    if (target.homePath)
      line(
        `${provider.label} home`,
        `${target.homePath}${(await exists(target.homePath)) ? '' : ' (missing)'}`,
      );
    else if (provider.homeNote) line('Config', provider.homeNote);
    if (provider.freshnessNote) line('Freshness', provider.freshnessNote);
    if (provider.watchdog)
      lines('Helpers', helperLines(runningHelpers(provider, paths.configDir)));
    if (provider.hooks) {
      item.hooks = hookReport(await hookStatus(target.homePath), report);
      line('Hooks', item.hooks.text);
    }
    if (provider.builtInInstanceId) {
      item.hideList = await hideListReport(target, provider, report);
      lines('Hide list', item.hideList.lines);
    }
    const legacy = await legacyHome(paths, provider);
    if (legacy) lines('Old home', legacyHomeLines(legacy, provider));
    const reasons = brokenReasons(item, explicit);
    if (reasons.length)
      broken.push(`${provider.displayName}: ${reasons.join('; ')}.`);
  }
  console.log('');
  if (!broken.length) return 0;
  for (const message of broken)
    console.log(`  ${c.red}Broken: ${message}${c.reset}`);
  console.log(
    `  ${c.dim}Run subc t3 install to repair it. Status exits 1.${c.reset}\n`,
  );
  return 1;
}

async function uninstall({ providers }) {
  const problems = [];
  const done = [];
  const notes = [];
  const paths = t3Paths(configDir());

  for (const provider of providers) {
    const { target } = context(provider);
    try {
      const { removed, removedPreferences, backup } = await removeT3Provider(
        target,
        {
          backupDir: paths.backups,
          preferences: Boolean(provider.builtInInstanceId),
        },
      );
      done.push(
        removed
          ? `Removed ${provider.instanceId} from ${path.join(target.home, 'userdata', 'settings.json')}${backup ? ` (backup: ${backup})` : ''}.`
          : `T3 Code has no ${provider.instanceId} provider from subc.`,
      );
      if (removedPreferences)
        done.push(
          `Removed the ${provider.instanceId} hide list from providerModelPreferences.`,
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
 * registered provider when it names none. Throws on an unknown key.
 */
function selectProviders(keys) {
  if (!keys.length) return { providers: T3_PROVIDERS, explicit: false };
  for (const key of keys) {
    if (!T3_PROVIDER_KEYS.includes(key))
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
