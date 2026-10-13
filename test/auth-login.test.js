import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
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

test('loginCommand surfaces the underlying network cause', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-login-err-'));
  const script = `
    import { loginCommand } from ${JSON.stringify(authModule)};
    const error = new TypeError('fetch failed');
    error.cause = Object.assign(new Error('getaddrinfo ENOTFOUND platform.subconscious.dev'), { code: 'ENOTFOUND' });
    await loginCommand([], {
      profileName: 'default',
      openBrowser() {},
      fetchImpl: async () => { throw error; },
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
  assert.equal(code, 1);
  assert.match(stderr, /fetch failed/);
  assert.match(stderr, /ENOTFOUND/);
  assert.match(stderr, /platform\.subconscious\.dev/);
  assert.match(stderr, /subc update-key/);
  await fs.rm(dir, { recursive: true, force: true });
});

test('loginCommand routes the default fetch through HTTPS_PROXY', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-login-proxy-'));
  const script = `
    import { loginCommand } from ${JSON.stringify(authModule)};
    await loginCommand([], { profileName: 'default', openBrowser() {} });
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: {
      ...process.env,
      SUBC_CONFIG_DIR: dir,
      SUBCONSCIOUS_API_KEY: '',
      // Unreachable proxy: the request must fail through the proxy path and
      // the failure must name the proxy, proving HTTPS_PROXY was honored.
      HTTPS_PROXY: 'http://127.0.0.1:1',
    },
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 1);
  assert.match(stderr, /Tried via proxy http:\/\/127\.0\.0\.1:1/);
  await fs.rm(dir, { recursive: true, force: true });
});
