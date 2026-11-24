import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import {
  fakeGateway,
  GOOD_KEY,
  MODELS,
  readRecords,
  run,
  subc,
  t3Sandbox,
} from './helpers/t3-sandbox.js';

const skip = process.platform === 'win32';
const OURS = 'subconscious-opencode';
// The helper argv T3 Code 0.1.11 passes (OpenCodeRuntime.ts:601), with
// port 0 so the fake picks a free port.
const SERVE_ARGS = ['serve', '--hostname=127.0.0.1', '--port=0'];

let gateway;
let installed;
const boxes = [];

async function box(options = {}) {
  const sandbox = await t3Sandbox({ gateway, withOpenCode: true, ...options });
  boxes.push(sandbox);
  return sandbox;
}

const install = (sandbox, env) =>
  subc(sandbox, ['t3', 'install', '--provider', 'opencode'], env);

function launch(sandbox, args, { log, env = {} } = {}) {
  return run(sandbox.opencodeLauncher, args, {
    env: sandbox.openCodeT3Env({ FAKE_OPENCODE_LOG: log, ...env }),
  });
}

let logs = 0;
const logFile = (sandbox) => path.join(sandbox.root, `opencode-${++logs}.log`);
const readSettings = async (sandbox) =>
  JSON.parse(await fs.readFile(sandbox.settingsPath, 'utf8'));

before(async () => {
  if (skip) return;
  gateway = await fakeGateway();
  installed = await box();
  const result = await install(installed);
  assert.equal(result.code, 0, result.stderr);
});

after(async () => {
  for (const sandbox of boxes) await sandbox.cleanup();
  await gateway?.close();
});

test('a serve launch gets only the Subconscious provider and keeps T3 Code names', {
  skip,
}, async () => {
  const sandbox = installed;
  const log = logFile(sandbox);
  // Known serve flags pass in = and space form.
  const args = [
    ...SERVE_ARGS,
    '--cors',
    'http://localhost:3000',
    '--print-logs',
  ];
  const result = await launch(sandbox, args, {
    log,
    env: { OPENCODE_SERVER_PASSWORD: 'v1-password-4567' },
  });
  assert.equal(result.code, 0, result.stderr);
  const [{ args: argv, config, env }] = await readRecords(log);
  assert.deepEqual(argv, args);
  // T3 Code's {} config is replaced by the launch config.
  assert.deepEqual(config.enabled_providers, ['subconscious']);
  assert.deepEqual(Object.keys(config.provider), ['subconscious']);
  const provider = config.provider.subconscious;
  assert.equal(provider.options.baseURL, `${gateway.url}/v1`);
  assert.equal(provider.options.apiKey, '{env:SUBCONSCIOUS_API_KEY}');
  assert.deepEqual(Object.keys(provider.models), MODELS);
  assert.equal(config.model, `subconscious/${MODELS[0]}`);
  assert.equal(env.SUBCONSCIOUS_API_KEY, GOOD_KEY);
  // T3 Code's own names reach the helper.
  assert.equal(env.T3CODE_HOME, sandbox.t3Home);
  assert.equal(env.OPENCODE_PASSWORD, 't3-helper-password-0123');
  assert.equal(env.OPENCODE_SERVER_PASSWORD, 'v1-password-4567');
});

test('an entry as T3 Code rewrites it is current, and a server URL is drift', {
  skip,
}, async () => {
  const sandbox = await box();
  assert.equal((await install(sandbox)).code, 0);
  // T3 Code 0.1.11 rewrites the file on start and removes config.enabled.
  const settings = await readSettings(sandbox);
  settings.providerInstances[OURS].config = {
    binaryPath: sandbox.opencodeLauncher,
  };
  await fs.writeFile(sandbox.settingsPath, JSON.stringify(settings, null, 2));
  const status = () =>
    subc(sandbox, ['t3', 'status', '--provider', 'opencode']);
  const current = await status();
  assert.equal(current.code, 0, current.stdout);
  assert.match(current.stdout, /subconscious-opencode: installed\n/);

  // With a Server URL, T3 Code skips the launcher.
  settings.providerInstances[OURS].config.serverUrl = 'http://127.0.0.1:4096';
  settings.providerInstances[OURS].config.serverPassword = { secretRef: 'x' };
  await fs.writeFile(sandbox.settingsPath, JSON.stringify(settings));
  assert.match(
    (await status()).stdout,
    /installed, changed in T3 \(serverUrl, serverPassword\); run subc t3 install/,
  );
  assert.equal((await install(sandbox)).code, 0);
  assert.deepEqual(
    (await readSettings(sandbox)).providerInstances[OURS].config,
    {
      binaryPath: sandbox.opencodeLauncher,
    },
  );
});
