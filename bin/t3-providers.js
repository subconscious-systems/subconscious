/**
 * The provider table for `subc t3`. A provider is one T3 Code integration
 * that subc owns: one T3 Code instance entry, one launcher, and one adapter.
 * Everything that differs between providers lives in its descriptor here.
 * This file is plain data, so every other t3 module can load it.
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
 * - `versionProbeEnv(dir)`: env for the `--version` check, so that it writes
 *   into the throwaway `dir` and not into the user's agent home, or `null`.
 * - `minimumVersion`: the oldest version install accepts, on top of the
 *   agent file's `minimum_version`.
 * - `legacyHooks`: install and uninstall remove the compaction hooks that
 *   older subc versions left in `homeDir`.
 * - `t3Version`: the oldest T3 Code that lists the provider's Subconscious
 *   models. Install warns below it.
 */

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
  // Codex writes helper files under CODEX_HOME/tmp even for --version.
  versionProbeEnv: (dir) => ({ CODEX_HOME: dir }),
  minimumVersion: null,
  legacyHooks: true,
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
  clearedFields: Object.freeze([]),
  versionProbeEnv: null,
  // T3 Code 0.1.11 supports Claude Code 2.1.280 and newer.
  minimumVersion: '2.1.280',
  legacyHooks: false,
  // T3 Code 0.1.7 lists only its built-in Claude models, not the models
  // Claude Code reports, so the Subconscious models do not show.
  t3Version: '0.1.11',
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
  clearedFields: Object.freeze([]),
  versionProbeEnv: null,
  // T3 Code 0.1.11 supports 2.0.18 and newer, and 1.x cannot load the
  // Subconscious plugin.
  minimumVersion: '2.0.18',
  legacyHooks: false,
});

/** Every provider this subc version can install, in a fixed order. */
export const T3_PROVIDERS = Object.freeze([CODEX, CLAUDE, OPENCODE]);

export const CODEX_PROVIDER = CODEX;
export const CLAUDE_PROVIDER = CLAUDE;
export const OPENCODE_PROVIDER = OPENCODE;
