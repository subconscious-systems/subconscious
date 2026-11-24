/**
 * The provider table for `subc t3`. A provider is one T3 Code integration
 * that subc owns. Each provider has one T3 Code instance entry, one launcher,
 * and one adapter. Everything that differs between providers lives in its
 * descriptor here, so the settings edit (`t3-settings.js`), the launch and
 * launcher (`t3-launch.js`), and the commands (`t3.js`) stay shared.
 *
 * This file is plain data. It imports only `node:path`, so every other t3
 * module can load it first.
 *
 * Descriptor fields:
 *
 * - `id`: the key for `--provider`, such as `codex`. It also names the
 *   matching subc command (`subc codex`) in messages.
 * - `agentId`: the agent file in `bin/runbook/<agentId>/agent.json` whose
 *   launch, install data, and inputs the provider uses.
 * - `label`: the agent's name in messages, such as "Codex".
 * - `instanceId`: the key of subc's entry in T3 Code's `providerInstances`.
 * - `displayName`: the provider name that T3 Code shows.
 * - `driver`: the T3 Code driver of the entry. An entry is subc's only when
 *   it has this driver and runs the provider's launcher.
 * - `launcherName`: the launcher's file name in `<config dir>/bin`.
 * - `adapterFile`: the adapter in `bin/` that the launcher runs.
 * - `binaryName`: the agent binary that install finds and the launcher pins.
 *   The launcher keeps it in the shell variable `subc_<binaryName>`.
 * - `binaryFlag`: the adapter option that carries the pinned binary path.
 * - `homeDir`: the agent home relative to the user's home, such as `.codex`,
 *   that the entry names as its `homePath`. `null` writes no `homePath`.
 * - `homeNote`: one sentence that install and status print about the agent
 *   home when `homeDir` is `null`, or `null` for no sentence.
 * - `freshnessNote`: one sentence that install and status print about when
 *   a new key or model applies, or `null` when it applies at the next
 *   launch, as the general help says.
 * - `managedConfig(target)`: every `config` field subc sets on its entry,
 *   in write order, `binaryPath` included. `target` holds `launcherPath` and,
 *   when `homeDir` is set, `homePath`. Status reports a changed value as
 *   drift, except `binaryPath`, which decides ownership instead.
 * - `clearedFields`: `config` fields subc removes, and reports as drift when
 *   they are not empty, because they would change how T3 Code starts the
 *   agent.
 * - `extraIsolatedEnv`: env names the launch removes from T3 Code's env, on
 *   top of `SUBC_*`, `SUBCONSCIOUS_*`, and every input in the agent file. A
 *   name that ends in `*` removes every name with that prefix.
 * - `isolateAgentOverrides`: true when the launch also removes every input
 *   alias and every env `override` name in the agent file. Each of those
 *   names changes the launch when T3 Code's env sets it.
 * - `versionProbeEnv(dir)`: env for the install-time `--version` check, so
 *   that the check writes into the throwaway `dir` and not into the user's
 *   agent home.
 * - `minimumVersion`: the oldest version install accepts. Install uses the
 *   higher of this and the agent file's `minimum_version`. `null` uses the
 *   agent file's value alone.
 * - `recommendedVersion`: below this version install prints a warning and
 *   continues. `null` prints no warning.
 * - `legacyHooks`: true when install and uninstall remove the compaction
 *   hooks that older subc versions left in `homeDir`, and status lists them.
 * - `ownedDirs`: directories under `<config dir>/t3`, as `/` paths, that
 *   launches create and uninstall removes.
 * - `watchdog`: true when the launcher can start a background watchdog that
 *   stops the agent after T3 Code's server dies. It is for a long-lived
 *   helper that T3 Code may fail to stop. The adapter turns it on for each
 *   launch with a `watch` record.
 * - `builtInInstanceId`: the instance ID of T3 Code's own provider for the
 *   same agent, such as `claudeAgent`, or `null`. When it is set, install
 *   writes a hide list for subc's instance: every model in T3 Code's model
 *   cache that is not in the key-scoped catalog. The built-in instance's
 *   cache is the fallback when subc's instance has no cache yet.
 */

import path from 'node:path';

const CODEX = Object.freeze({
  id: 'codex',
  agentId: 'codex',
  label: 'Codex',
  instanceId: 'subconscious-codex',
  displayName: 'Subconscious (Codex)',
  driver: 'codex',
  launcherName: 'subc-t3-codex',
  adapterFile: 't3-codex.js',
  binaryName: 'codex',
  binaryFlag: '--codex',
  // The same Codex home that plain `subc codex` uses, so T3 Code sessions
  // get the user's own AGENTS.md, skills, and MCP servers.
  homeDir: '.codex',
  homeNote: null,
  freshnessNote: null,
  managedConfig: ({ launcherPath, homePath }) => ({
    setupMode: 'existing',
    binaryPath: launcherPath,
    homePath,
  }),
  clearedFields: Object.freeze(['shadowHomePath', 'launchArgs']),
  extraIsolatedEnv: Object.freeze([]),
  isolateAgentOverrides: false,
  // Codex writes helper files under CODEX_HOME/tmp on every start, even for
  // --version.
  versionProbeEnv: (dir) => ({ CODEX_HOME: dir }),
  minimumVersion: null,
  recommendedVersion: null,
  legacyHooks: true,
  ownedDirs: Object.freeze(['codex/catalog']),
  watchdog: false,
  builtInInstanceId: null,
});

const CLAUDE = Object.freeze({
  id: 'claude',
  agentId: 'claude-code',
  label: 'Claude Code',
  instanceId: 'subconscious-claude',
  displayName: 'Subconscious (Claude)',
  driver: 'claudeAgent',
  launcherName: 'subc-t3-claude',
  adapterFile: 't3-claude.js',
  binaryName: 'claude',
  binaryFlag: '--claude',
  // No homePath, so T3 Code sets no CLAUDE_CONFIG_DIR. Claude Code then reads
  // the user's ~/.claude and ~/.claude.json, as plain subc claude does.
  homeDir: null,
  homeNote:
    "Claude Code uses your ~/.claude, the same config as subc claude and T3 Code's built-in Claude provider.",
  freshnessNote: null,
  managedConfig: ({ launcherPath }) => ({ binaryPath: launcherPath }),
  clearedFields: Object.freeze(['launchArgs']),
  // Each of these routes Claude Code away from the default profile, or
  // signs it in another way.
  extraIsolatedEnv: Object.freeze([
    'ANTHROPIC_*',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
    'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
    'CLAUDE_CODE_SKIP_VERTEX_AUTH',
    'CLAUDE_CODE_SKIP_FOUNDRY_AUTH',
    'API_KEY',
    'GATEWAY_URL',
    'MODEL',
  ]),
  isolateAgentOverrides: true,
  // A throwaway config dir keeps the version check out of ~/.claude and
  // ~/.claude.json.
  versionProbeEnv: (dir) => ({ CLAUDE_CONFIG_DIR: dir }),
  // T3 Code 0.1.11 supports Claude Code 2.1.280 and newer, and recommends
  // 2.1.301. Install uses the higher of this and the agent file's minimum.
  minimumVersion: '2.1.280',
  recommendedVersion: '2.1.301',
  legacyHooks: false,
  ownedDirs: Object.freeze([]),
  watchdog: false,
  // T3 Code lists its built-in Claude models on every claudeAgent instance.
  builtInInstanceId: 'claudeAgent',
});

const OPENCODE = Object.freeze({
  id: 'opencode',
  agentId: 'opencode',
  label: 'OpenCode',
  instanceId: 'subconscious-opencode',
  displayName: 'Subconscious (OpenCode)',
  driver: 'opencode',
  launcherName: 'subc-t3-opencode',
  adapterFile: 't3-opencode.js',
  binaryName: 'opencode',
  binaryFlag: '--opencode',
  // OpenCode keeps its config and sessions in the user's own folders, as
  // plain subc opencode does. subc writes nothing there.
  homeDir: null,
  homeNote:
    'OpenCode uses your ~/.config/opencode and ~/.local/share/opencode, as subc opencode does. subc writes nothing there.',
  // T3 Code shares one OpenCode helper across the instance's threads, and
  // the helper reads the key and the catalog once, when it starts.
  freshnessNote:
    'A new key or model applies after the OpenCode helper restarts: restart T3 Code, or wait until its OpenCode threads have been idle for 30 minutes.',
  // No config.enabled: T3 Code 0.1.11 removes it from config and keeps only
  // the envelope's enabled flag, which turns the instance on by itself.
  managedConfig: ({ launcherPath }) => ({ binaryPath: launcherPath }),
  // A Server URL makes T3 Code connect to that server and skip the
  // launcher, so the key-scoped launch never runs. A password only makes
  // sense with a Server URL.
  clearedFields: Object.freeze(['serverUrl', 'serverPassword']),
  // OPENCODE_CONFIG and OPENCODE_CONFIG_DIR add config beside the launch
  // config, and that config can define a provider that reads the key.
  // T3 Code sets OPENCODE_CONFIG_CONTENT to {}, and the launch replaces it.
  // API_KEY, GATEWAY_URL, and MODEL are profile names that runbookEnv
  // exports, so a value from T3 Code must not reach the launch.
  extraIsolatedEnv: Object.freeze([
    'OPENCODE_CONFIG',
    'OPENCODE_CONFIG_DIR',
    'OPENCODE_CONFIG_CONTENT',
    'API_KEY',
    'GATEWAY_URL',
    'MODEL',
  ]),
  isolateAgentOverrides: true,
  // OpenCode writes a log under XDG_DATA_HOME and a runtime library under
  // TMPDIR even for --version.
  versionProbeEnv: (dir) => ({
    XDG_DATA_HOME: path.join(dir, 'data'),
    XDG_STATE_HOME: path.join(dir, 'state'),
    XDG_CACHE_HOME: path.join(dir, 'cache'),
    TMPDIR: path.join(dir, 'tmp'),
  }),
  // T3 Code 0.1.11 supports OpenCode 2.0.18 and newer. subc supports 2.x
  // only, because 1.x cannot load the Subconscious plugin.
  minimumVersion: '2.0.18',
  recommendedVersion: null,
  legacyHooks: false,
  ownedDirs: Object.freeze([]),
  // T3 Code runs `opencode serve` as a long-lived helper. When T3 Code's
  // server dies, the helper keeps running with the key in its env until
  // T3 Code's next start reaps it, so the launcher stops it sooner.
  watchdog: true,
  builtInInstanceId: null,
});

/** Every provider this subc version can install, in a fixed order. */
export const T3_PROVIDERS = Object.freeze([CODEX, CLAUDE, OPENCODE]);

/** Every provider key that `--provider` accepts, in table order. */
export const T3_PROVIDER_KEYS = Object.freeze(
  T3_PROVIDERS.map((provider) => provider.id),
);

export const CODEX_PROVIDER = CODEX;
export const CLAUDE_PROVIDER = CLAUDE;
export const OPENCODE_PROVIDER = OPENCODE;

/** The registered descriptor for `key`, or null. */
export function providerByKey(key) {
  return T3_PROVIDERS.find((provider) => provider.id === key) ?? null;
}
