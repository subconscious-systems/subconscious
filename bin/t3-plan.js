/**
 * The runner that every `subc t3` adapter shares. The launcher runs an
 * adapter as
 *
 *   node t3-<agent>.js <binaryFlag> PATH --config-dir DIR -- AGENT_ARGS...
 *
 * An adapter never starts the agent. It prints a plan on stdout as
 * NUL-separated pairs of kind and value, and the launcher applies the plan
 * and execs:
 *
 *   env   NAME=VALUE   export the variable
 *   unset NAME         unset the variable
 *   arg   WORD         the next argv word
 *   ok    (empty)      the plan is complete
 *
 * Each adapter sorts its agent's command lines into three kinds. A
 * `configured` launch gets the Subconscious launch. A `passthrough` query,
 * such as `--version`, runs the real agent unchanged, without reading the
 * profile or the network. An `unsupported` command is refused.
 */

import path from 'node:path';

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Bash sources the file in BASH_ENV when it starts a script, and stdout is
 * T3 Code's protocol stream, so a BASH_ENV that prints breaks the session.
 * ENV is the POSIX name for the same kind of file.
 */
export const SHELL_STARTUP_ENV = Object.freeze(['BASH_ENV', 'ENV']);

/**
 * The real agent with T3 Code's args and env unchanged, except that the
 * agent's own directory joins PATH when it is missing, because an
 * npm-installed agent is a Node script that finds `node` there.
 */
export function passthroughPlan(binaryPath, args, env) {
  const binDir = path.dirname(binaryPath);
  const dirs = (env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const next = { ...env };
  if (!dirs.includes(binDir))
    next.PATH = [binDir, ...dirs].join(path.delimiter);
  return { argv: [binaryPath, ...args], env: next };
}

/**
 * The plan as records: unset, then env, then argv, then ok. A name in the env the adapter started with
 * that the plan leaves out is unset. Bash cannot unset a name that is not
 * a shell word, such as an exported function's `BASH_FUNC_cd%%`, so the
 * argv then starts with `/usr/bin/env -u NAME`.
 */
export function encodePlan(plan, original) {
  const records = [];
  const stuck = [];
  // The launcher keeps its own state in subc_* shell variables, such as
  // subc_argv, so the plan never sets or unsets one, and the agent gets none.
  const shellWord = (name) => ENV_NAME.test(name) && !name.startsWith('subc_');
  const kept = (name) => name in plan.env && !name.startsWith('subc_');
  for (const name of Object.keys(original)) {
    if (kept(name)) continue;
    if (shellWord(name)) records.push('unset', name);
    else stuck.push('-u', name);
  }
  for (const [name, value] of Object.entries(plan.env)) {
    if (original[name] === value || !shellWord(name)) continue;
    records.push('env', `${name}=${value}`);
  }
  const argv = stuck.length
    ? ['/usr/bin/env', ...stuck, ...plan.argv]
    : plan.argv;
  for (const word of argv) records.push('arg', word);
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

function parseOwnArgs(argv, provider) {
  const own = {};
  let i = 0;
  for (; i < argv.length && argv[i] !== '--'; i++) {
    const name = argv[i];
    const value = argv[++i];
    if (name === provider.binaryFlag) own.binaryPath = value;
    else if (name === '--config-dir') own.configDir = value;
    else own.bad = true;
  }
  if (own.bad || !own.binaryPath || !own.configDir || argv[i] !== '--')
    throw new Error(
      `usage: ${provider.adapterFile} ${provider.binaryFlag} PATH --config-dir DIR -- ARGS...`,
    );
  return { ...own, args: argv.slice(i + 1) };
}

/**
 * The Subconscious launch, or null when this process should exit without a
 * plan: SYSTEM_CA is refused here, or a restart with the system CA already
 * printed the plan.
 */
async function configuredPlan(provider, own, original, planName) {
  const launch = await import('./t3-launch.js');
  launch.isolateLaunchEnv(process.env, own.configDir, provider);
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
      provider,
    });
    if (restarted) return null;
  }
  return launch[planName]({
    args: own.args,
    binaryPath: own.binaryPath,
    configDir: own.configDir,
    launch: await launch.resolveT3Launch({ agentId: provider.agentId }),
  });
}

async function adapterMain(provider, classify, planName) {
  // The launcher is the adapter's parent. If T3 Code kills it while the plan
  // is still being computed, the adapter stops too.
  const parent = process.ppid;
  setInterval(() => {
    if (process.ppid !== parent) process.exit(1);
  }, 100).unref();
  process.stdout.on('error', () => process.exit(1));
  const own = parseOwnArgs(process.argv.slice(2), provider);
  const kind = classify(own.args);
  if (kind === 'unsupported') {
    const shown = own.args.join(' ') || '(no command)';
    console.error(
      `${provider.launcherName}: \`${provider.binaryName} ${shown}\` is not available through the Subconscious provider. Run ${provider.binaryName} directly for it.`,
    );
    return 64;
  }
  const original = { ...process.env };
  const plan =
    kind === 'passthrough'
      ? passthroughPlan(own.binaryPath, own.args, original)
      : await configuredPlan(provider, own, original, planName);
  if (!plan) return process.exitCode || 0;
  if (plan.fallback)
    console.error(`${provider.launcherName}: ${plan.fallback}`);
  await writeStdout(encodePlan(plan, original));
  return 0;
}

/**
 * Run an adapter: sort the args with `classify`, then print the plan.
 * `planName` names the plan builder in `t3-launch.js`.
 */
export function runAdapter(provider, classify, planName) {
  adapterMain(provider, classify, planName).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`${provider.launcherName}: ${error.message}`);
      process.exit(1);
    },
  );
}
