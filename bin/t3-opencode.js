#!/usr/bin/env node

/**
 * The adapter behind T3 Code's "Subconscious (OpenCode)" provider. T3 runs
 * the launcher `subc t3 install` writes, and the launcher runs this file:
 *
 *   node t3-opencode.js --opencode PATH --config-dir DIR -- OPENCODE_ARGS...
 *
 * This file never starts OpenCode. It prints a plan on stdout as
 * NUL-separated pairs of kind and value, and the launcher applies the plan
 * and execs:
 *
 *   env   NAME=VALUE   export the variable
 *   unset NAME         unset the variable
 *   arg   WORD         the next argv word
 *   ok    (empty)      the plan is complete
 *
 * T3 Code 0.1.11 runs OpenCode in two ways. The version check (`--version`)
 * runs the real OpenCode unchanged, without reading the profile or the
 * network. The helper (`serve --hostname=H --port=P`) gets the Subconscious
 * launch. `serve --service` and `serve --stdio` are refused, because the
 * first starts OpenCode's shared background service and the second is
 * another protocol. `upgrade` and every other command are refused too.
 */

import {
  encodePlan,
  exitWithParent,
  passthroughPlan,
  writeStdout,
} from './t3-plan.js';

const USAGE =
  'usage: t3-opencode.js --opencode PATH --config-dir DIR -- OPENCODE_ARGS...';

const HELP_OR_VERSION = new Set(['-h', '--help', '-v', '--version']);
const SERVE_HELP = new Set(['-h', '--help']);
// The `serve` flags that T3 Code passes or could pass. Each one takes a
// value, in `--flag=value` or `--flag value` form.
const SERVE_VALUE_FLAGS = new Set([
  '--hostname',
  '--port',
  '--cors',
  '--log-level',
]);
const PRINT_LOGS = new Set([
  '--print-logs',
  '--print-logs=true',
  '--print-logs=false',
]);

/** True when `args` holds only the serve flags that the launch allows. */
function knownServeFlags(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (PRINT_LOGS.has(arg)) continue;
    const equals = arg.indexOf('=');
    if (equals > 0) {
      if (!SERVE_VALUE_FLAGS.has(arg.slice(0, equals))) return false;
      continue;
    }
    if (!SERVE_VALUE_FLAGS.has(arg)) return false;
    const value = args[++i];
    if (value === undefined || value.startsWith('-')) return false;
  }
  return true;
}

/** `configured`, `passthrough`, or `unsupported` for one OpenCode command line. */
function classifyOpenCodeArgs(args) {
  if (args.length === 1 && HELP_OR_VERSION.has(args[0])) return 'passthrough';
  if (args[0] !== 'serve') return 'unsupported';
  const rest = args.slice(1);
  if (rest.length === 1 && SERVE_HELP.has(rest[0])) return 'passthrough';
  return knownServeFlags(rest) ? 'configured' : 'unsupported';
}

function parseOwnArgs(argv) {
  const own = {};
  let i = 0;
  for (; i < argv.length && argv[i] !== '--'; i++) {
    const name = argv[i];
    const value = argv[++i];
    if (name === '--opencode') own.opencodePath = value;
    else if (name === '--config-dir') own.configDir = value;
    else throw new Error(USAGE);
  }
  if (!own.opencodePath || !own.configDir || argv[i] !== '--')
    throw new Error(USAGE);
  return { ...own, args: argv.slice(i + 1) };
}

async function configuredPlan(own) {
  const original = { ...process.env };
  const [launch, { OPENCODE_PROVIDER }] = await Promise.all([
    import('./t3-launch.js'),
    import('./t3-providers.js'),
  ]);
  launch.isolateLaunchEnv(process.env, own.configDir, OPENCODE_PROVIDER);
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
      provider: OPENCODE_PROVIDER,
    });
    if (restarted) return null;
  }
  const resolved = await launch.resolveT3Launch({
    agentId: OPENCODE_PROVIDER.agentId,
  });
  const plan = await launch.t3OpenCodePlan({
    args: own.args,
    opencodePath: own.opencodePath,
    launch: resolved,
  });
  return { plan, original };
}

async function main() {
  exitWithParent();
  process.stdout.on('error', () => process.exit(1));
  const own = parseOwnArgs(process.argv.slice(2));
  const kind = classifyOpenCodeArgs(own.args);
  if (kind === 'unsupported') {
    const shown = own.args.join(' ') || '(no command)';
    console.error(
      `subc-t3-opencode: \`opencode ${shown}\` is not available through the Subconscious provider. Run opencode directly for it.`,
    );
    return 64;
  }
  if (kind === 'passthrough') {
    const original = { ...process.env };
    const plan = passthroughPlan(own.opencodePath, own.args, original);
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
    console.error(`subc-t3-opencode: ${error.message}`);
    process.exit(1);
  },
);
