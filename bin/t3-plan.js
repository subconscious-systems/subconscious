/**
 * Helpers that every `subc t3` adapter shares. An adapter never starts the
 * agent. It prints a plan on stdout as NUL-separated pairs of kind and value,
 * and the launcher applies the plan and execs:
 *
 *   env   NAME=VALUE   export the variable
 *   unset NAME         unset the variable
 *   arg   WORD         the next argv word
 *   ok    (empty)      the plan is complete
 */

import path from 'node:path';

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Bash sources the file in BASH_ENV when it starts a script, and stdout is
 * T3 Code's protocol stream, so a BASH_ENV that prints breaks the session. A
 * plan that runs a runbook script with bash unsets these. ENV is the POSIX
 * name for the same kind of file.
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
 * The plan as records: unset, then env, then argv, then ok. A name in the
 * env the adapter started with that the plan leaves out is unset. A name in
 * `plan.unset` is unset even when that env did not have it.
 */
export function encodePlan(plan, original) {
  const records = [];
  const unset = new Set();
  for (const name of Object.keys(original)) {
    if (!(name in plan.env) && ENV_NAME.test(name)) unset.add(name);
  }
  for (const name of plan.unset ?? []) {
    if (!(name in plan.env) && ENV_NAME.test(name)) unset.add(name);
  }
  for (const name of unset) records.push('unset', name);
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

export function writeStdout(text) {
  return new Promise((resolve, reject) => {
    process.stdout.write(text, (error) => (error ? reject(error) : resolve()));
  });
}

/**
 * The launcher is the adapter's parent. If T3 Code kills it while the plan is
 * still being computed, the adapter stops too, instead of finishing a catalog
 * fetch that nobody will use.
 */
export function exitWithParent() {
  const parent = process.ppid;
  setInterval(() => {
    if (process.ppid !== parent) process.exit(1);
  }, 100).unref();
}
