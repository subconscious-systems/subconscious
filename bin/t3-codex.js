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
 * profile, the network, or hooks. Any other command is refused.
 */

import path from 'node:path';

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

/**
 * The real Codex with T3's args and env unchanged, except that Codex's own
 * directory joins PATH when it is missing, because an npm-installed Codex is
 * a Node script that finds `node` there.
 */
function passthroughPlan(codexPath, args, env) {
  const binDir = path.dirname(codexPath);
  const dirs = (env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const next = { ...env };
  if (!dirs.includes(binDir))
    next.PATH = [binDir, ...dirs].join(path.delimiter);
  return { argv: [codexPath, ...args], env: next };
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The plan as records: unset, then env, then argv, then ok. */
function encodePlan(plan, original) {
  const records = [];
  for (const name of Object.keys(original)) {
    if (!(name in plan.env) && ENV_NAME.test(name)) records.push('unset', name);
  }
  for (const [name, value] of Object.entries(plan.env)) {
    if (original[name] === value || !ENV_NAME.test(name)) continue;
    records.push('env', `${name}=${value}`);
  }
  for (const word of plan.argv) records.push('arg', word);
  records.push('ok', '');
  if (records.some((record) => record.includes('\0')))
    throw new Error('A launch value contains a NUL byte');
  return `${records.join('\0')}\0`;
}

function writeStdout(text) {
  return new Promise((resolve, reject) => {
    process.stdout.write(text, (error) => (error ? reject(error) : resolve()));
  });
}

// The launcher is our parent. If T3 kills it while this plan is still being
// computed, stop too instead of finishing a catalog fetch nobody will use.
function exitWithParent() {
  const parent = process.ppid;
  setInterval(() => {
    if (process.ppid !== parent) process.exit(1);
  }, 100).unref();
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
    // The child recomputes everything, so it must see the caller's env.
    for (const name of Object.keys(process.env)) delete process.env[name];
    Object.assign(process.env, original);
    if (await network.ensureSystemCa({ interactive: false })) return null;
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
