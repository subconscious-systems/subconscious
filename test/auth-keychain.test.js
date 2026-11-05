import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const authModule = fileURLToPath(new URL('../bin/auth.js', import.meta.url));

// A Keychain stand-in the child process shares through a JSON file, so each
// test can see what login stored without touching the real Keychain.
const FAKE_STORE = (file, { writable = true } = {}) => `
  import fs from 'node:fs';
  const file = ${JSON.stringify(file)};
  const load = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
  const save = (items) => fs.writeFileSync(file, JSON.stringify(items));
  const credentialStore = {
    label: 'macOS Keychain',
    async read(account) { return load()[account] ?? null; },
    async write(account, secret) {
      if (!${writable}) return false;
      save({ ...load(), [account]: secret });
      return true;
    },
    async remove(account) {
      const items = load();
      const had = account in items;
      delete items[account];
      save(items);
      return had;
    },
  };
`;

async function runScript(dir, body) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', body], {
    env: { ...process.env, SUBC_CONFIG_DIR: dir, SUBCONSCIOUS_API_KEY: '' },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolve) => child.on('close', resolve));
  return { code, stdout, stderr };
}

const deviceFetch = (key, { whoamiStatus = 200 } = {}) => `
  async (url, init) => {
    const u = String(url);
    if (u.endsWith('/register')) {
      globalThis.registerBody = init.body;
      return { ok: true, json: async () => ({ device_code: 'secret', user_code: 'ABCD-2345' }) };
    }
    if (u.endsWith('/whoami')) return { ok: ${whoamiStatus} === 200, status: ${whoamiStatus}, json: async () => ({}) };
    return { ok: true, json: async () => ({ key: ${JSON.stringify(key)} }) };
  }
`;

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return {};
  }
}

async function profileText(dir) {
  try {
    return await fs.readFile(path.join(dir, 'profiles', 'default.env'), 'utf8');
  } catch {
    return '';
  }
}

test('login stores the key in the Keychain, not in config.json or the profile', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-kc-'));
  const store = path.join(dir, 'fake-keychain.json');
  const result = await runScript(
    dir,
    `${FAKE_STORE(store)}
    import { getApiKey, loginCommand } from ${JSON.stringify(authModule)};
    await loginCommand([], { profileName: 'default', openBrowser() {}, credentialStore, fetchImpl: ${deviceFetch('sk-gw-new12345.k')} });
    const auth = await getApiKey({ name: 'default', values: {} }, { credentialStore });
    console.log('RESOLVED=' + auth.key + '|' + auth.source);
    console.log('REGISTER=' + globalThis.registerBody);
  `,
  );
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await readJson(store), { default: 'sk-gw-new12345.k' });
  assert.equal(
    (await readJson(path.join(dir, 'config.json'))).subconscious_api_key,
    undefined,
  );
  assert.ok(!(await profileText(dir)).includes('sk-gw-new12345.k'));
  assert.match(result.stdout, /RESOLVED=sk-gw-new12345\.k\|macOS Keychain/);
  assert.match(result.stdout, /Stored in macOS Keychain/);
  assert.match(result.stdout, /unused for 30 days/);
  const register = JSON.parse(result.stdout.match(/REGISTER=(.*)/)[1]);
  assert.equal(register.hostname, os.hostname());
  await fs.rm(dir, { recursive: true, force: true });
});

test('login falls back to the 0600 config file when the Keychain refuses the write', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-kc-fb-'));
  const store = path.join(dir, 'fake-keychain.json');
  const result = await runScript(
    dir,
    `${FAKE_STORE(store, { writable: false })}
    import { loginCommand } from ${JSON.stringify(authModule)};
    await loginCommand([], { profileName: 'default', openBrowser() {}, credentialStore, fetchImpl: ${deviceFetch('sk-gw-file1234.k')} });
  `,
  );
  assert.equal(result.code, 0, result.stderr);
  const configFile = path.join(dir, 'config.json');
  assert.equal(
    (await readJson(configFile)).subconscious_api_key,
    'sk-gw-file1234.k',
  );
  assert.equal((await fs.stat(configFile)).mode & 0o777, 0o600);
  assert.match(result.stdout, /Could not use the macOS Keychain/);
  await fs.rm(dir, { recursive: true, force: true });
});

test('login replaces a stored key the platform rejects with 401', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-kc-401-'));
  const store = path.join(dir, 'fake-keychain.json');
  await fs.writeFile(store, JSON.stringify({ default: 'sk-gw-revoked1.k' }));
  const result = await runScript(
    dir,
    `${FAKE_STORE(store)}
    import { loginCommand } from ${JSON.stringify(authModule)};
    await loginCommand([], { profileName: 'default', openBrowser() {}, credentialStore, fetchImpl: ${deviceFetch('sk-gw-fresh123.k', { whoamiStatus: 401 })} });
  `,
  );
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await readJson(store), { default: 'sk-gw-fresh123.k' });
  assert.match(result.stdout, /no longer valid/);
  await fs.rm(dir, { recursive: true, force: true });
});

test('login keeps a stored key the platform still accepts', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-kc-ok-'));
  const store = path.join(dir, 'fake-keychain.json');
  await fs.writeFile(store, JSON.stringify({ default: 'sk-gw-current1.k' }));
  const result = await runScript(
    dir,
    `${FAKE_STORE(store)}
    import { loginCommand } from ${JSON.stringify(authModule)};
    await loginCommand([], { profileName: 'default', openBrowser() {}, credentialStore, fetchImpl: ${deviceFetch('sk-gw-unused12.k')} });
  `,
  );
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await readJson(store), { default: 'sk-gw-current1.k' });
  assert.match(result.stdout, /Already logged in/);
  await fs.rm(dir, { recursive: true, force: true });
});

test('logout removes the Keychain item', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-kc-out-'));
  const store = path.join(dir, 'fake-keychain.json');
  await fs.writeFile(store, JSON.stringify({ default: 'sk-gw-current1.k' }));
  const result = await runScript(
    dir,
    `${FAKE_STORE(store)}
    import { logoutCommand } from ${JSON.stringify(authModule)};
    await logoutCommand([], { profileName: 'default', credentialStore });
  `,
  );
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await readJson(store), {});
  assert.match(result.stdout, /Logged out/);
  await fs.rm(dir, { recursive: true, force: true });
});

test('update-key stores a pasted key in the Keychain too', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-kc-paste-'));
  const store = path.join(dir, 'fake-keychain.json');
  const result = await runScript(
    dir,
    `${FAKE_STORE(store)}
    import { updateApiKeyCommand } from ${JSON.stringify(authModule)};
    await updateApiKeyCommand(['sk-gw-pasted12.k'], { profileName: 'default', credentialStore });
  `,
  );
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await readJson(store), { default: 'sk-gw-pasted12.k' });
  assert.equal(
    (await readJson(path.join(dir, 'config.json'))).subconscious_api_key,
    undefined,
  );
  await fs.rm(dir, { recursive: true, force: true });
});
