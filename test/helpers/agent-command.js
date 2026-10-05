import { spawn, spawnSync } from 'node:child_process';
import { agentById } from '../../bin/agent-data.js';
import { launchPlan, resolveInputs } from '../../bin/agent-launch.js';
import { planCommand, scriptCommand } from '../../bin/agent-spawn.js';

/**
 * The command subc runs to launch an agent, from an env shaped like subc's
 * launch env (GATEWAY_URL, API_KEY, MODEL, SUBCONSCIOUS_MODELS, ...).
 */
export function launchCommand(id, { env, args = [], prompt } = {}) {
  const agent = agentById(id);
  return planCommand(agent, launchPlan(agent, { env, args, prompt }));
}

/** The command subc runs for `subc <agent> install|status|uninstall`. */
export function setupCommand(id, args, env) {
  const agent = agentById(id);
  return scriptCommand(
    agent,
    agent.runbook.setup_script,
    args,
    resolveInputs(agent, env),
  );
}

function stdio(command) {
  return [command.stdin === 'ignore' ? 'ignore' : 'pipe', 'pipe', 'pipe'];
}

export function runSync(command, options = {}) {
  return spawnSync(command.file, command.args, {
    encoding: 'utf8',
    env: command.env,
    stdio: stdio(command),
    ...(command.input === undefined ? {} : { input: command.input }),
    ...options,
  });
}

/** Run asynchronously; resolves with the exit code and both outputs. */
export function run(command, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      env: command.env,
      stdio: stdio(command),
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    if (child.stdin) child.stdin.end(command.input ?? '');
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
