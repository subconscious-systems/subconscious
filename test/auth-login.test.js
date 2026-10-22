import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { pollDeviceLogin, registerDeviceLogin } from '../bin/auth.js';

const authModule = fileURLToPath(new URL('../bin/auth.js', import.meta.url));

test('registerDeviceLogin posts to the platform', async () => {
  const calls = [];
  const data = await registerDeviceLogin(
    'https://platform.example',
    async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({
          device_code: 'secret',
          user_code: 'ABCD-2345',
          expires_in: 300,
        }),
      };
    },
  );
  assert.equal(
    calls[0].url,
    'https://platform.example/api/cli/device/register',
  );
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(data.user_code, 'ABCD-2345');
});

test('pollDeviceLogin reports pending, then a key', async () => {
  const pending = await pollDeviceLogin(
    'https://platform.example',
    'secret',
    async () => ({
      ok: false,
      json: async () => ({ error: 'authorization_pending' }),
    }),
  );
  assert.deepEqual(pending, { status: 'pending' });

  const approved = await pollDeviceLogin(
    'https://platform.example',
    'secret',
    async () => ({
      ok: true,
      json: async () => ({ key: 'sk-approved-key' }),
    }),
  );
  assert.deepEqual(approved, { status: 'approved', key: 'sk-approved-key' });
});

test('loginCommand saves the polled key', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-login-'));
  const script = `
    import { loginCommand } from ${JSON.stringify(authModule)};
    await loginCommand([], {
      profileName: 'default',
      openBrowser() {},
      fetchImpl: async (url) => {
        if (String(url).endsWith('/register')) {
          return { ok: true, json: async () => ({ device_code: 'secret', user_code: 'ABCD-2345' }) };
        }
        return { ok: true, json: async () => ({ key: 'sk-from-device-login' }) };
      },
    });
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, SUBC_CONFIG_DIR: dir, SUBCONSCIOUS_API_KEY: '' },
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 0, stderr);
  const config = JSON.parse(
    await fs.readFile(path.join(dir, 'config.json'), 'utf8'),
  );
  assert.equal(config.subconscious_api_key, 'sk-from-device-login');
  await fs.rm(dir, { recursive: true, force: true });
});

// The platform URL reaches the browser opener as an argument. This is a guard
// that it stays an argument: it drives the real loginCommand against a local
// stub platform with a value that would be meaningful to a shell, and asserts
// nothing outside the opener is run.
test('login does not pass the platform URL through a shell', {
  skip:
    process.platform === 'win32'
      ? 'windows opens the URL via PowerShell env var'
      : false,
}, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-shell-'));
  const marker = path.join(dir, 'UNEXPECTED');
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        device_code: 'dev',
        user_code: 'ABCD-2345',
        key: 'sk-stub',
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  // Parses as a URL, so login proceeds to the opener. A shell would see more
  // here than one argument; the opener must see exactly one.
  const payload = `http://127.0.0.1:${port}/base";id>${marker};echo"`;

  const script = `
      import { loginCommand } from ${JSON.stringify(authModule)};
      await loginCommand([], { profileName: 'default' });
    `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: {
      ...process.env,
      SUBC_CONFIG_DIR: dir,
      SUBCONSCIOUS_URL: payload,
      SUBCONSCIOUS_API_KEY: '',
    },
  });
  await new Promise((resolve) => child.on('close', resolve));
  await new Promise((resolve) => server.close(resolve));

  assert.equal(
    await fs.access(marker).then(
      () => true,
      () => false,
    ),
    false,
    `the platform URL reached a shell: ${await fs
      .readFile(marker, 'utf8')
      .catch(() => '')}`,
  );
  await fs.rm(dir, { recursive: true, force: true });
});
