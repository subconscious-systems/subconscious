import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { RUNBOOK_DIR } from './agent-data.js';
import { modelIds } from './launch-values.js';
import { visionModelList } from './model-capabilities.js';

/** Resolve a script inside the agent's own runbook directory. */
export function runbookScriptPath(agent, relativeScript) {
  const dir = path.join(RUNBOOK_DIR, agent.id);
  const script = path.resolve(dir, relativeScript);
  const relative = path.relative(dir, script);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Invalid runbook script path for ${agent.name}`);
  }
  return script;
}

function forwardStops(child) {
  // The runbook execs the agent, so it is our direct child: a runner that
  // stops subc must stop the agent too. A terminal already delivers SIGINT
  // to the whole process group, so it is not forwarded.
  const forwarded = ['SIGTERM', 'SIGHUP'];
  const forward = (signal) => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  };
  for (const signal of forwarded) process.on(signal, forward);
  return () => {
    for (const signal of forwarded) process.off(signal, forward);
  };
}

/**
 * Run `file args`, mirror its exit status or signal, and pass SIGTERM/SIGHUP
 * on to it. `stdin` is 'inherit', 'ignore', or 'pipe' with `input` written
 * then closed. `notFound` builds the error when `file` does not exist.
 */
export function spawnChild(
  file,
  args,
  { env, stdin = 'inherit', input, notFound },
) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      stdio: [stdin, 'inherit', 'inherit'],
      env,
    });
    if (stdin === 'pipe') {
      // The agent may exit without reading all of it.
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
    const stopForwarding = forwardStops(child);

    child.on('error', (error) => {
      stopForwarding();
      reject(error.code === 'ENOENT' && notFound ? notFound() : error);
    });

    child.on('exit', (code, signal) => {
      stopForwarding();
      if (signal) {
        // Node ignores some signals (SIGPIPE), so re-raising may not end the
        // process; the shell convention still reports the agent's failure.
        process.exitCode = 128 + (os.constants.signals[signal] ?? 0);
        process.kill(process.pid, signal);
        resolve(process.exitCode);
        return;
      }
      if (code) process.exitCode = code;
      resolve(code ?? 0);
    });
  });
}

const BASH_MISSING = () =>
  new Error(
    'These coding-agent integrations require `bash`, but it was not found on PATH.',
  );

/**
 * What a runbook script reads beyond the launch env. With `strict: false`
 * an invalid model leaves SUBC_MODEL_IDS unset instead of failing, for
 * status and uninstall, which never use it.
 */
export function scriptEnv(env, { strict = true } = {}) {
  let ids;
  try {
    ids = modelIds(env).join('\n');
  } catch (error) {
    if (strict) throw error;
  }
  return {
    ...env,
    ...(ids === undefined ? {} : { SUBC_MODEL_IDS: ids }),
    SUBC_VISION_MODELS: visionModelList(),
  };
}

/** The command for one of the agent's runbook scripts, given its env. */
export function scriptCommand(agent, relativeScript, args, env, options) {
  return {
    file: 'bash',
    args: [runbookScriptPath(agent, relativeScript), ...args],
    env: scriptEnv(env, options),
    notFound: BASH_MISSING,
  };
}

/**
 * The command that starts a launch plan: the agent's runbook script when it
 * has one, otherwise the binary itself, from `binDir` when it is known.
 */
export function planCommand(agent, plan, binDir) {
  const io = { stdin: plan.stdin, input: plan.input };
  const { script } = agent.runbook;
  if (script) {
    const command = scriptCommand(agent, script, plan.argv, plan.env);
    command.env.SUBC_TEMPLATE_WORDS = String(plan.templateWords);
    return { ...command, ...io };
  }
  const [bin, ...args] = plan.argv;
  return {
    file: binDir ? path.join(binDir, bin) : bin,
    args,
    env: plan.env,
    ...io,
    notFound: () => new Error(`Could not launch \`${bin}\`.`),
  };
}

/** Run a command built by planCommand or scriptCommand. */
export function runCommand(command) {
  return spawnChild(command.file, command.args, command);
}
