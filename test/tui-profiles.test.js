import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-tui-profiles-'));
process.env.SUBC_CONFIG_DIR = root;
process.env.SUBC_DISABLE_UPDATE_CHECK = '1';
delete process.env.SUBCONSCIOUS_API_KEY;
delete process.env.SUBCONSCIOUS_BASE_URL;
delete process.env.SUBCONSCIOUS_URL;
delete process.env.SUBCONSCIOUS_MODEL;

const { ensureProfile, loadProfile, updateProfile } = await import(
  '../bin/profiles.js'
);
const { createLocalTuiState, runTui } = await import('../bin/tui.js');

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test('switching TUI profiles reloads paths, endpoints, models and authentication', async () => {
  for (const name of ['first', 'second', 'third']) {
    await ensureProfile(name, `sk-${name}`);
    await updateProfile(name, {
      GATEWAY_URL: `https://${name}-gateway.example`,
      PLATFORM_URL: `https://${name}-platform.example`,
      MODEL: `subconscious/${name}`,
      CLAUDE_CODE_SUBAGENT_MODEL: `subconscious/${name}-subagent`,
    });
  }
  const script = path.join(root, 'fake-tui.mjs');
  const seenPath = path.join(root, 'seen.jsonl');
  await fs.writeFile(
    script,
    `import fs from 'node:fs/promises';
const args = process.argv.slice(2);
const state = JSON.parse(await fs.readFile(args[args.indexOf('--state') + 1], 'utf8'));
await fs.appendFile(args[0], JSON.stringify(state) + '\\n');
const next = { first: 'second', second: 'third' }[state.activeProfile];
const selection = { args: next ? ['-p', next] : ['-p', state.activeProfile, 'claude'] };
await fs.writeFile(args[args.indexOf('--result') + 1], JSON.stringify(selection));
`,
  );
  const requests = [];
  const result = await runTui({
    profileName: 'first',
    binary: process.execPath,
    binaryArgs: [script, seenPath],
    stdio: 'pipe',
    discoverSessions: async () => [],
    resolveCatalog: async ({ baseUrl, apiKey }) => {
      requests.push({ baseUrl, apiKey });
      return { models: [], source: 'available', error: null };
    },
  });
  assert.deepEqual(result, { args: ['-p', 'third', 'claude'] });
  const states = (await fs.readFile(seenPath, 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  assert.deepEqual(
    states.map((state) => state.activeProfile),
    ['first', 'second', 'third'],
  );
  for (const state of states) {
    const name = state.activeProfile;
    assert.equal(state.profilePath, path.join(root, 'profiles', `${name}.env`));
    assert.equal(state.gatewayUrl, `https://${name}-gateway.example`);
    assert.equal(state.savedGatewayUrl, state.gatewayUrl);
    assert.equal(state.platformUrl, `https://${name}-platform.example`);
    assert.equal(state.savedPlatformUrl, state.platformUrl);
    assert.equal(state.selectedModel, `subconscious/${name}`);
    assert.equal(state.subagentModel, `subconscious/${name}-subagent`);
  }
  assert.deepEqual(
    requests,
    ['first', 'second', 'third'].map((name) => ({
      baseUrl: `https://${name}-gateway.example`,
      apiKey: `sk-${name}`,
    })),
  );
  assert.doesNotMatch(JSON.stringify(states), /sk-first|sk-second|sk-third/);
});

test('profile reload discards supplied state and lets the user quit the new menu', async () => {
  const script = path.join(root, 'quit-tui.mjs');
  const seenPath = path.join(root, 'quit-state.json');
  await fs.writeFile(
    script,
    `import fs from 'node:fs/promises';
const args = process.argv.slice(2);
const state = JSON.parse(await fs.readFile(args[args.indexOf('--state') + 1], 'utf8'));
if (state.activeProfile === 'first') {
  await fs.writeFile(args[args.indexOf('--result') + 1], JSON.stringify({ args: ['-p', 'second'] }));
} else {
  await fs.writeFile(args[0], JSON.stringify(state));
}
`,
  );
  const requests = [];
  const result = await runTui({
    profileName: 'first',
    state: await createLocalTuiState('first'),
    profile: await loadProfile('first'),
    binary: process.execPath,
    binaryArgs: [script, seenPath],
    stdio: 'pipe',
    discoverSessions: async () => [],
    resolveCatalog: async ({ baseUrl, apiKey }) => {
      requests.push({ baseUrl, apiKey });
      return { models: [], source: 'available', error: null };
    },
  });
  assert.equal(result, null);
  const state = JSON.parse(await fs.readFile(seenPath, 'utf8'));
  assert.equal(state.activeProfile, 'second');
  assert.equal(state.profilePath, path.join(root, 'profiles', 'second.env'));
  assert.deepEqual(requests, [
    { baseUrl: 'https://second-gateway.example', apiKey: 'sk-second' },
  ]);
});
