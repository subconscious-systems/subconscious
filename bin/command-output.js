import { spawn } from 'node:child_process';
import { spawnWindows } from './windows/process.js';

export const COMMAND_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/**
 * Run a command and collect its stdout without blocking the event loop.
 *
 * A synchronous spawn with a timeout only sends SIGTERM and then waits for the
 * child to exit, so a child that ignores SIGTERM blocks the process for as long
 * as it runs. This sends SIGKILL at the deadline and stops reading at once,
 * even when a grandchild still holds the pipe open.
 */
export function runCommand(command, args, options = {}) {
  const spawnImpl =
    options.spawn || (process.platform === 'win32' ? spawnWindows : spawn);
  const timeoutMs = options.timeout ?? COMMAND_TIMEOUT_MS;
  const signal = options.signal;

  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ status: null, stdout: '', error: new Error('cancelled') });
      return;
    }

    let child;
    try {
      child = spawnImpl(command, args, {
        env: options.env || process.env,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
    } catch (error) {
      resolve({ status: null, stdout: '', error });
      return;
    }

    let stdout = '';
    let settled = false;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const stop = (message) => {
      try {
        child.kill('SIGKILL');
      } catch {
        // The child already exited.
      }
      child.stdout?.destroy();
      finish({ status: null, stdout: '', error: new Error(message) });
    };
    const onAbort = () => stop('cancelled');

    timer = setTimeout(
      () => stop(`${command} timed out after ${timeoutMs}ms`),
      timeoutMs,
    );
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT_BYTES) stop(`${command} output too large`);
    });
    child.stdout?.on('error', () => {});
    child.once('error', (error) => finish({ status: null, stdout: '', error }));
    child.once('close', (status) => finish({ status, stdout }));
  });
}
