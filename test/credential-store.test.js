import assert from 'node:assert/strict';
import test from 'node:test';
import { createCredentialStore } from '../bin/credential-store.js';

function fakeSecurity() {
  const items = new Map();
  const calls = [];
  const run = async (cmd, args, input) => {
    calls.push({ cmd, args, input });
    if (args[0] === '-i') {
      const m = /-s "([^"]*)" -a "([^"]*)" -w "([^"]*)"/.exec(input);
      if (m) items.set(`${m[1]}|${m[2]}`, m[3]);
      return { code: 0, stdout: '', stderr: '' };
    }
    const service = args[args.indexOf('-s') + 1];
    const account = args[args.indexOf('-a') + 1];
    const id = `${service}|${account}`;
    if (args[0] === 'find-generic-password') {
      return items.has(id)
        ? { code: 0, stdout: `${items.get(id)}\n`, stderr: '' }
        : { code: 44, stdout: '', stderr: 'not found' };
    }
    if (args[0] === 'delete-generic-password') {
      return { code: items.delete(id) ? 0 : 44, stdout: '', stderr: '' };
    }
    return { code: 1, stdout: '', stderr: '' };
  };
  return { run, calls, items };
}

const KEY = 'sk-gw-abcd1234.opaque_TOKEN-9';

test('macOS: writes the key to the Keychain through stdin, never argv', async () => {
  const sec = fakeSecurity();
  const store = createCredentialStore({
    platform: 'darwin',
    env: {},
    run: sec.run,
  });

  assert.equal(await store.write('default', KEY), true);
  assert.equal(await store.read('default'), KEY);
  const write = sec.calls.find((call) => call.args[0] === '-i');
  assert.ok(write.input.includes(KEY));
  for (const call of sec.calls) assert.ok(!call.args.includes(KEY));
  assert.equal(store.label, 'macOS Keychain');
});

test('macOS: a missing item reads as null and remove reports it', async () => {
  const sec = fakeSecurity();
  const store = createCredentialStore({
    platform: 'darwin',
    env: {},
    run: sec.run,
  });

  assert.equal(await store.read('default'), null);
  await store.write('default', KEY);
  assert.equal(await store.remove('default'), true);
  assert.equal(await store.read('default'), null);
});

test('macOS: a write that does not read back counts as failed', async () => {
  const store = createCredentialStore({
    platform: 'darwin',
    env: {},
    run: async () => ({ code: 0, stdout: '', stderr: '' }),
  });
  assert.equal(await store.write('default', KEY), false);
});

test('refuses to pass a value that could break out of the quoted command', async () => {
  const sec = fakeSecurity();
  const store = createCredentialStore({
    platform: 'darwin',
    env: {},
    run: sec.run,
  });
  assert.equal(await store.write('default', 'sk"\nrm -rf'), false);
  assert.equal(sec.calls.length, 0);
});

test('profiles get separate Keychain items, and a custom config dir gets its own service', async () => {
  const sec = fakeSecurity();
  const plain = createCredentialStore({
    platform: 'darwin',
    env: {},
    run: sec.run,
  });
  const custom = createCredentialStore({
    platform: 'darwin',
    env: { SUBC_CONFIG_DIR: '/tmp/work' },
    run: sec.run,
  });

  await plain.write('default', KEY);
  await plain.write('work', 'sk-gw-other123.x');
  assert.equal(await plain.read('work'), 'sk-gw-other123.x');
  assert.equal(await custom.read('default'), null);
  assert.equal(await custom.write('default', KEY), true);
  assert.equal(await custom.read('default'), KEY);
  assert.equal(await plain.read('default'), KEY);
});

test('Linux, Windows and SUBC_CREDENTIAL_STORE=file use no Keychain', async () => {
  for (const options of [
    { platform: 'linux', env: {} },
    { platform: 'win32', env: {} },
    { platform: 'darwin', env: { SUBC_CREDENTIAL_STORE: 'file' } },
  ]) {
    const sec = fakeSecurity();
    const store = createCredentialStore({ ...options, run: sec.run });
    assert.equal(store.label, null);
    assert.equal(await store.write('default', KEY), false);
    assert.equal(await store.read('default'), null);
    assert.equal(sec.calls.length, 0);
  }
});
