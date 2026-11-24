/**
 * The provider table for `subc t3`. A provider is one T3 Code integration
 * that subc owns: one T3 Code instance entry, one launcher, and one adapter.
 * Everything that differs between providers lives in its descriptor here.
 * This file imports only `node:path`, so every other t3 module can load it.
 *
 * Descriptor fields that need more than their name:
 *
 * - `agentId`: the agent file in `bin/runbook/<agentId>/agent.json`.
 * - `driver`: the T3 Code driver. An entry is subc's only when it has this
 *   driver and runs the provider's launcher.
 * - `binaryFlag`: the adapter option that carries the pinned binary path.
 * - `homeDir`: the agent home relative to the user's home, which the entry
 *   names as its `homePath`, or `null` for no `homePath`.
 * - `managedConfig(target)`: every `config` field subc sets on its entry.
 *   Status reports a changed value as drift, except `binaryPath`, which
 *   decides ownership instead.
 * - `clearedFields`: `config` fields subc removes, because they change how
 *   T3 Code starts the agent. A value in one is drift.
 * - `extraIsolatedEnv`: env names the launch removes from T3 Code's env, on
 *   top of `SUBC_*`, `SUBCONSCIOUS_*`, and every input, alias, and override
 *   name in the agent file. A trailing `*` removes a prefix.
 * - `versionProbeEnv(dir)`: env for the `--version` check, so that it writes
 *   into the throwaway `dir` and not into the user's agent home, or `null`.
 * - `minimumVersion`: the oldest version install accepts, on top of the
 *   agent file's `minimum_version`.
 * - `legacyHooks`: install and uninstall remove the compaction hooks that
 *   older subc versions left in `homeDir`.
 * - `watchdog`: the launcher can start a watchdog that stops a long-lived
 *   helper after T3 Code's server dies.
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
  homeDir: '.codex',
  managedConfig: ({ launcherPath, homePath }) => ({
    setupMode: 'existing',
    binaryPath: launcherPath,
    homePath,
  }),
  clearedFields: Object.freeze(['shadowHomePath', 'launchArgs']),
  extraIsolatedEnv: Object.freeze([]),
  // Codex writes helper files under CODEX_HOME/tmp even for --version.
  versionProbeEnv: (dir) => ({ CODEX_HOME: dir }),
  minimumVersion: null,
  legacyHooks: true,
  watchdog: false,
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
  // No homePath, so T3 Code sets no CLAUDE_CONFIG_DIR, and Claude Code reads
  // the user's ~/.claude, as plain subc claude does.
  homeDir: null,
  managedConfig: ({ launcherPath }) => ({ binaryPath: launcherPath }),
  clearedFields: Object.freeze(['launchArgs']),
  // Each of these routes Claude Code away from the default profile, or signs
  // it in another way.
  extraIsolatedEnv: Object.freeze([
    'ANTHROPIC_*',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
    'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
    'CLAUDE_CODE_SKIP_VERTEX_AUTH',
    'CLAUDE_CODE_SKIP_FOUNDRY_AUTH',
  ]),
  // Claude Code --version writes nothing.
  versionProbeEnv: null,
  // T3 Code 0.1.11 supports Claude Code 2.1.280 and newer.
  minimumVersion: '2.1.280',
  legacyHooks: false,
  watchdog: false,
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
  homeDir: null,
  // No config.enabled: T3 Code 0.1.11 removes it and keeps the envelope flag.
  managedConfig: ({ launcherPath }) => ({ binaryPath: launcherPath }),
  // A Server URL makes T3 Code connect to that server and skip the launcher.
  clearedFields: Object.freeze(['serverUrl', 'serverPassword']),
  // These add config beside the launch config, and that config can define a
  // provider that reads the key.
  extraIsolatedEnv: Object.freeze(['OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR']),
  // OpenCode writes a log under XDG_DATA_HOME and a library under TMPDIR
  // even for --version.
  versionProbeEnv: (dir) => ({
    XDG_DATA_HOME: path.join(dir, 'data'),
    XDG_STATE_HOME: path.join(dir, 'state'),
    XDG_CACHE_HOME: path.join(dir, 'cache'),
    TMPDIR: path.join(dir, 'tmp'),
  }),
  // T3 Code 0.1.11 supports 2.0.18 and newer, and 1.x cannot load the
  // Subconscious plugin.
  minimumVersion: '2.0.18',
  legacyHooks: false,
  // T3 Code runs `opencode serve` as a long-lived helper that holds the key.
  watchdog: true,
});

/** Every provider this subc version can install, in a fixed order. */
export const T3_PROVIDERS = Object.freeze([CODEX, CLAUDE, OPENCODE]);

export const CODEX_PROVIDER = CODEX;
export const CLAUDE_PROVIDER = CLAUDE;
export const OPENCODE_PROVIDER = OPENCODE;
