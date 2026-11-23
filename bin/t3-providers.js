/**
 * The provider table for `subc t3`. A provider is one T3 Code integration
 * that subc owns. Each provider has one T3 Code instance entry, one launcher,
 * and one adapter. Everything that differs between providers lives in its
 * descriptor here, so the settings edit (`t3-settings.js`), the launch and
 * launcher (`t3-launch.js`), and the commands (`t3.js`) stay shared.
 *
 * This file is plain data with no imports, so every other t3 module can load
 * it first.
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
 * - `versionProbeEnv(dir)`: env for the install-time `--version` check, so
 *   that the check writes into the throwaway `dir` and not into the user's
 *   agent home.
 * - `minimumVersion`: the oldest version install accepts. `null` uses the
 *   agent file's `minimum_version`.
 * - `recommendedVersion`: below this version install prints a warning and
 *   continues. `null` prints no warning.
 * - `hooks`: true when install sets up the Codex compaction hooks in
 *   `homeDir`, the same way `subc codex` does.
 * - `ownedDirs`: directories under `<config dir>/t3`, as `/` paths, that
 *   launches create and uninstall removes.
 * - `legacyHome`: a directory under `<config dir>/t3` that an older subc
 *   used as the agent home, or `null`. Install, status, and uninstall report
 *   it and never delete it.
 * - `watchdog`: true when the launcher starts a background watchdog that
 *   stops the agent after T3 Code's server dies. It is for a long-lived
 *   helper that T3 Code may fail to stop.
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
  // The same Codex home that plain `subc codex` uses, so T3 Code sessions
  // get the user's own AGENTS.md, skills, and MCP servers.
  homeDir: '.codex',
  managedConfig: ({ launcherPath, homePath }) => ({
    setupMode: 'existing',
    binaryPath: launcherPath,
    homePath,
  }),
  clearedFields: Object.freeze(['shadowHomePath', 'launchArgs']),
  extraIsolatedEnv: Object.freeze([]),
  // Codex writes helper files under CODEX_HOME/tmp on every start, even for
  // --version.
  versionProbeEnv: (dir) => ({ CODEX_HOME: dir }),
  minimumVersion: null,
  recommendedVersion: null,
  hooks: true,
  ownedDirs: Object.freeze(['codex/catalog']),
  // Before 8.2.0, the provider had its own Codex home here.
  legacyHome: 'codex/default',
  watchdog: false,
});

/** Every provider this subc version can install, in a fixed order. */
export const T3_PROVIDERS = Object.freeze([CODEX]);

/**
 * Every provider key that `--provider` accepts, in a fixed order. A key here
 * that is not in T3_PROVIDERS is known but not available yet.
 */
export const T3_PROVIDER_KEYS = Object.freeze(['codex', 'claude', 'opencode']);

export const CODEX_PROVIDER = CODEX;

/** The registered descriptor for `key`, or null. */
export function providerByKey(key) {
  return T3_PROVIDERS.find((provider) => provider.id === key) ?? null;
}
