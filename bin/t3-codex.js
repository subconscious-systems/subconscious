#!/usr/bin/env node

/**
 * The adapter behind T3 Code's "Subconscious (Codex)" provider. T3 runs the
 * launcher `subc t3 install` writes, and the launcher runs this file:
 *
 *   node t3-codex.js --codex PATH --config-dir DIR -- CODEX_ARGS...
 *
 * This file never starts Codex. It prints a plan on stdout as NUL-separated
 * pairs of kind and value, and the launcher applies the plan and execs:
 *
 *   env   NAME=VALUE   export the variable
 *   unset NAME         unset the variable
 *   arg   WORD         the next argv word
 *   ok    (empty)      the plan is complete
 *
 * T3 starts Codex for several jobs. A session (`app-server`) and a one-shot
 * run (`exec`) get the Subconscious launch. A capability query (`--version`,
 * help, `mcp list`) runs the real Codex unchanged, without reading the
 * profile or the network. Any other command is refused.
 */

import {
  encodePlan,
  exitWithParent,
  passthroughPlan,
  writeStdout,
} from './t3-plan.js';

const USAGE =
  'usage: t3-codex.js --codex PATH --config-dir DIR -- CODEX_ARGS...';

// Codex root options that take a value, so their value is not the command.
const ROOT_VALUE_OPTIONS = new Set([
  '-c',
  '--config',
  '--enable',
  '--disable',
  '--remote',
  '--remote-auth-token-env',
  '-i',
  '--image',
  '-m',
  '--model',
  '--local-provider',
  '-p',
  '--profile',
  '-s',
  '--sandbox',
  '-C',
  '--cd',
  '--add-dir',
  '-a',
  '--ask-for-approval',
]);
const APP_SERVER_VALUE_OPTIONS = new Set([
  '-c',
  '--config',
  '--enable',
  '--disable',
  '--startup-client-info',
  '--cloud-skills-snapshot',
  '--code-mode-host',
  '--listen',
]);
const HELP_OR_VERSION = new Set(['-h', '--help', '-V', '--version']);
const APP_SERVER_QUERIES = new Set([
  'help',
  'generate-ts',
  'generate-json-schema',
]);
const MCP_QUERIES = new Set(['list', 'get', 'help']);

/** The first word that is not an option, skipping option values. */
function firstPositional(args, valueOptions) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') return { index: -1 };
    if (!arg.startsWith('-') || arg === '-') return { index: i, word: arg };
    if (valueOptions.has(arg)) i++;
  }
  return { index: -1 };
}

function asksForHelpOrVersion(args) {
  const end = args.indexOf('--');
  return (end < 0 ? args : args.slice(0, end)).some((arg) =>
    HELP_OR_VERSION.has(arg),
  );
}

/**
 * `configured`, `passthrough`, or `unsupported` for one Codex command line.
 * The command is the first word after the root options, so a leading
 * `-c key=value` does not hide `mcp list`.
 */
function classifyCodexArgs(args) {
  const { index, word } = firstPositional(args, ROOT_VALUE_OPTIONS);
  if (index < 0)
    return asksForHelpOrVersion(args) ? 'passthrough' : 'unsupported';
  const rest = args.slice(index + 1);
  if (word === 'help') return 'passthrough';
  if (word === 'app-server') {
    if (asksForHelpOrVersion(rest)) return 'passthrough';
    const sub = firstPositional(rest, APP_SERVER_VALUE_OPTIONS);
    if (sub.index < 0) return 'configured';
    return APP_SERVER_QUERIES.has(sub.word) ? 'passthrough' : 'unsupported';
  }
  if (word === 'exec' || word === 'e')
    return asksForHelpOrVersion(rest) ? 'passthrough' : 'configured';
  if (word === 'mcp') {
    if (asksForHelpOrVersion(rest)) return 'passthrough';
    const sub = firstPositional(rest, new Set());
    return MCP_QUERIES.has(sub.word) ? 'passthrough' : 'unsupported';
  }
  return 'unsupported';
}

function parseOwnArgs(argv) {
  const own = {};
  let i = 0;
  for (; i < argv.length && argv[i] !== '--'; i++) {
    const name = argv[i];
    const value = argv[++i];
    if (name === '--codex') own.codexPath = value;
    else if (name === '--config-dir') own.configDir = value;
    else throw new Error(USAGE);
  }
  if (!own.codexPath || !own.configDir || argv[i] !== '--')
    throw new Error(USAGE);
  return { ...own, args: argv.slice(i + 1) };
}

async function configuredPlan(own) {
  const original = { ...process.env };
  const launch = await import('./t3-launch.js');
  launch.isolateLaunchEnv(process.env, own.configDir);
  const profiles = await import('./profiles.js');
  const network = await import('./network.js');
  const profile = await profiles.loadProfile(profiles.DEFAULT_PROFILE);
  const systemCa = profiles.systemCaEnabledFor(profile);
  if (network.refuseUnsupportedSystemCa(systemCa, profile.path)) return null;
  if (systemCa && !process.execArgv.includes('--use-system-ca')) {
    const restarted = await launch.restartWithCallerEnv({
      env: process.env,
      original,
      configDir: own.configDir,
      restart: () => network.ensureSystemCa({ interactive: false }),
    });
    if (restarted) return null;
  }
  const resolved = await launch.resolveT3Launch();
  const plan = await launch.t3CodexPlan({
    args: own.args,
    codexPath: own.codexPath,
    paths: launch.t3Paths(own.configDir),
    launch: resolved,
  });
  return { plan, original };
}

async function main() {
  exitWithParent();
  process.stdout.on('error', () => process.exit(1));
  const own = parseOwnArgs(process.argv.slice(2));
  const kind = classifyCodexArgs(own.args);
  if (kind === 'unsupported') {
    const shown = own.args.join(' ') || '(no command)';
    console.error(
      `subc-t3-codex: \`codex ${shown}\` is not available through the Subconscious provider. Run codex directly for it.`,
    );
    return 64;
  }
  if (kind === 'passthrough') {
    const original = { ...process.env };
    const plan = passthroughPlan(own.codexPath, own.args, original);
    await writeStdout(encodePlan(plan, original));
    return 0;
  }
  const configured = await configuredPlan(own);
  if (!configured) return process.exitCode || 0;
  await writeStdout(encodePlan(configured.plan, configured.original));
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`subc-t3-codex: ${error.message}`);
    process.exit(1);
  },
);
