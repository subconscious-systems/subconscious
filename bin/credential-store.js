import { spawn } from 'node:child_process';

const SERVICE = 'subconscious-cli';
const KEYCHAIN_LABEL = 'macOS Keychain';
// API keys and profile names only use these characters. Anything else could
// break out of the quoted `security -i` command, so it is never sent.
const SAFE_VALUE = /^[A-Za-z0-9._@:/() -]+$/;

/** Runs a command, writing `input` to its stdin. Never throws. */
export function runCommand(cmd, args, input) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ code: -1, stdout: '', stderr: String(error) });
      return;
    }
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) =>
      resolve({ code: -1, stdout, stderr: String(error) }),
    );
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.stdin.end(input ?? '');
  });
}

const quote = (value) => `"${value}"`;

/**
 * Where `subc login` keeps the API key. On macOS it is the login Keychain,
 * through the built-in `security` tool; the secret goes over stdin so it
 * never shows in the process list. Everywhere else, and when
 * SUBC_CREDENTIAL_STORE=file, there is no store and callers fall back to the
 * 0600 config file. Each operation reports failure instead of throwing, so a
 * locked Keychain (an SSH session) falls back too.
 */
export function createCredentialStore({
  platform = process.platform,
  env = process.env,
  run = runCommand,
} = {}) {
  const enabled = platform === 'darwin' && env.SUBC_CREDENTIAL_STORE !== 'file';
  const configDir = env.SUBC_CONFIG_DIR?.trim();
  const service = configDir ? `${SERVICE} (${configDir})` : SERVICE;

  async function read(account) {
    if (!enabled) return null;
    const result = await run('security', [
      'find-generic-password',
      '-s',
      service,
      '-a',
      account,
      '-w',
    ]);
    return result.code === 0 ? result.stdout.trim() || null : null;
  }

  async function write(account, secret) {
    if (!enabled) return false;
    if (![service, account, secret].every((value) => SAFE_VALUE.test(value)))
      return false;
    await run(
      'security',
      ['-i'],
      `add-generic-password -U -s ${quote(service)} -a ${quote(account)} -w ${quote(secret)}\n`,
    );
    // `security -i` exits 0 even when the inner command fails, so read it back.
    return (await read(account)) === secret;
  }

  async function remove(account) {
    if (!enabled) return false;
    const result = await run('security', [
      'delete-generic-password',
      '-s',
      service,
      '-a',
      account,
    ]);
    return result.code === 0;
  }

  return { label: enabled ? KEYCHAIN_LABEL : null, read, write, remove };
}
