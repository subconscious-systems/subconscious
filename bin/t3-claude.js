#!/usr/bin/env node

/**
 * The adapter behind T3 Code's "Subconscious (Claude)" provider. T3 runs the
 * launcher `subc t3 install` writes, and the launcher runs this file:
 *
 *   node t3-claude.js --claude PATH --config-dir DIR -- CLAUDE_ARGS...
 *
 * This file never starts Claude Code. It prints a plan on stdout as
 * NUL-separated pairs of kind and value, and the launcher applies the plan
 * and execs:
 *
 *   env   NAME=VALUE   export the variable
 *   unset NAME         unset the variable
 *   arg   WORD         the next argv word
 *   ok    (empty)      the plan is complete
 *
 * T3 Code starts Claude Code in three ways. The version check (`--version`)
 * runs the real Claude Code unchanged, without reading the profile or the
 * network. The SDK probe and sessions (stream-json) and text generation
 * (`-p`) get the Subconscious launch. T3 Code adds session flags between
 * releases, so a launch is recognized by its protocol flags alone. Any other
 * command is refused.
 */

import {
  encodePlan,
  exitWithParent,
  passthroughPlan,
  writeStdout,
} from './t3-plan.js';

const USAGE =
  'usage: t3-claude.js --claude PATH --config-dir DIR -- CLAUDE_ARGS...';

const HELP_OR_VERSION = new Set(['-h', '--help', '-v', '--version']);
const PROTOCOL_FLAGS = new Set([
  '--input-format',
  '--output-format',
  '-p',
  '--print',
]);

function isProtocolFlag(arg) {
  return (
    PROTOCOL_FLAGS.has(arg) ||
    arg.startsWith('--input-format=') ||
    arg.startsWith('--output-format=')
  );
}

/** `configured`, `passthrough`, or `unsupported` for one Claude command line. */
function classifyClaudeArgs(args) {
  if (args.length && args.every((arg) => HELP_OR_VERSION.has(arg)))
    return 'passthrough';
  if (
    args[0] === 'update' &&
    args.slice(1).every((arg) => HELP_OR_VERSION.has(arg))
  )
    return 'passthrough';
  const end = args.indexOf('--');
  const options = end < 0 ? args : args.slice(0, end);
  return options.some(isProtocolFlag) ? 'configured' : 'unsupported';
}

function parseOwnArgs(argv) {
  const own = {};
  let i = 0;
  for (; i < argv.length && argv[i] !== '--'; i++) {
    const name = argv[i];
    const value = argv[++i];
    if (name === '--claude') own.claudePath = value;
    else if (name === '--config-dir') own.configDir = value;
    else throw new Error(USAGE);
  }
  if (!own.claudePath || !own.configDir || argv[i] !== '--')
    throw new Error(USAGE);
  return { ...own, args: argv.slice(i + 1) };
}

async function configuredPlan(own) {
  const original = { ...process.env };
  const [launch, { CLAUDE_PROVIDER }] = await Promise.all([
    import('./t3-launch.js'),
    import('./t3-providers.js'),
  ]);
  launch.isolateLaunchEnv(process.env, own.configDir, CLAUDE_PROVIDER);
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
      provider: CLAUDE_PROVIDER,
    });
    if (restarted) return null;
  }
  const resolved = await launch.resolveT3Launch({
    agentId: CLAUDE_PROVIDER.agentId,
  });
  const plan = await launch.t3ClaudePlan({
    args: own.args,
    claudePath: own.claudePath,
    launch: resolved,
  });
  if (plan.fallback)
    console.error(
      `subc-t3-claude: ${plan.fallback.requested} is not in the Subconscious model catalog for this key, so Claude Code uses ${plan.fallback.model} instead.`,
    );
  return { plan, original };
}

async function main() {
  exitWithParent();
  process.stdout.on('error', () => process.exit(1));
  const own = parseOwnArgs(process.argv.slice(2));
  const kind = classifyClaudeArgs(own.args);
  if (kind === 'unsupported') {
    const shown = own.args.join(' ') || '(no command)';
    console.error(
      `subc-t3-claude: \`claude ${shown}\` is not available through the Subconscious provider. Run claude directly for it.`,
    );
    return 64;
  }
  if (kind === 'passthrough') {
    const original = { ...process.env };
    const plan = passthroughPlan(own.claudePath, own.args, original);
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
    console.error(`subc-t3-claude: ${error.message}`);
    process.exit(1);
  },
);
