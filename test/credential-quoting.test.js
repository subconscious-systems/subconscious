import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { setupCommand } from './helpers/agent-command.js';

// Credentials reach the runbooks from --api-key, a profile, or the
// environment, and every runbook wrote them into a file that hook.sh sources.
// Interpolating the raw value between single quotes meant a value containing a
// quote produced a malformed file: the hook then sourced it, got nothing, and
// silently stopped reporting. These tests install with a key containing a
// quote and assert it survives the round trip byte for byte.

const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-quote-test-'));
const home = path.join(testDir, 'home');
await fs.mkdir(path.join(home, '.config', 'Code', 'User'), { recursive: true });

after(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

/** A key containing a quote, which is what breaks single-quoted interpolation. */
function awkwardKey(marker) {
  return `sk-test'; echo ${marker}; echo '`;
}

function baseEnv(extra = {}) {
  return {
    ...process.env,
    HOME: home,
    NO_COLOR: '1',
    GATEWAY_URL: 'https://gateway.example',
    API_KEY: 'sk-unused',
    MODEL: 'subconscious/glm-5.3-marathon',
    SUBCONSCIOUS_MODELS: 'subconscious/glm-5.3-marathon',
    ...extra,
  };
}

const exists = (file) =>
  fs.access(file).then(
    () => true,
    () => false,
  );

/** What the file yields when a shell sources it, plus whether it ran anything. */
async function sourceAndRead(file, marker) {
  const script = `set -u; . "$1"; printf '%s' "\${SUBCONSCIOUS_API_KEY-}"`;
  const result = spawnSync('bash', ['-c', script, 'bash', file], {
    encoding: 'utf8',
  });
  return { value: result.stdout, ran: await exists(marker) };
}

const RUNBOOKS = [
  {
    id: 'codex',
    label: 'Codex',
    envFile: () => path.join(home, '.codex', 'subconscious-hooks.env'),
    env: () => ({ CODEX_DIR: path.join(home, '.codex') }),
    args: (key) => ['install', '--api-key', key],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    envFile: () => path.join(home, '.cursor', 'subconscious-hooks.env'),
    env: () => ({}),
    args: (key) => ['install', '--api-key', key],
  },
  {
    id: 'copilot',
    label: 'Copilot',
    envFile: () => path.join(home, '.copilot', 'subconscious-hooks.env'),
    env: () => ({}),
    args: (key) => ['install', '--api-key', key],
  },
  {
    id: 'pi',
    label: 'Pi',
    envFile: () => path.join(home, '.pi', 'agent', 'subconscious.env'),
    env: () => ({ PI_CODING_AGENT_DIR: path.join(home, '.pi', 'agent') }),
    args: (key) => ['install', '--api-key', key],
  },
];

for (const runbook of RUNBOOKS) {
  test(`${runbook.label} writes a hook env file that round-trips a key containing a quote`, async () => {
    const marker = path.join(testDir, `${runbook.id}-UNEXPECTED`);
    const key = awkwardKey(marker);
    const command = setupCommand(
      runbook.id,
      runbook.args(key),
      baseEnv(runbook.env()),
    );
    const result = runSyncOnce(command);
    assert.equal(result.status, 0, result.stderr);

    const envFile = runbook.envFile();
    assert.ok(await exists(envFile), `${runbook.label} wrote no env file`);

    const { value, ran } = await sourceAndRead(envFile, marker);
    assert.equal(ran, false, `${runbook.label} env file lost the API key`);
    assert.equal(
      value,
      key,
      `${runbook.label} env file did not round-trip the API key`,
    );
    assert.equal(
      (await fs.stat(envFile)).mode & 0o777,
      0o600,
      `${runbook.label} env file is not mode 600`,
    );
  });
}

test('Pi writes models.json with the API key intact for a quoted key', async () => {
  const marker = path.join(testDir, 'pi-json-UNEXPECTED');
  const key = awkwardKey(marker);
  const result = runSyncOnce(
    setupCommand(
      'pi',
      ['install', '--api-key', key],
      baseEnv({ PI_CODING_AGENT_DIR: path.join(home, '.pi', 'agent') }),
    ),
  );
  assert.equal(result.status, 0, result.stderr);

  const modelsPath = path.join(home, '.pi', 'agent', 'models.json');
  const models = JSON.parse(await fs.readFile(modelsPath, 'utf8'));
  assert.equal(models.providers.subconscious.apiKey, key);
  assert.equal(await exists(marker), false);
});

test('Pi writes every catalog model, not just the first', async () => {
  // One model makes MODEL_ENTRIES_JSON a bare object, which is valid on its
  // own; two or more make it a comma-joined list that needs its own brackets.
  const dir = path.join(home, 'pi-multi');
  const catalog = [
    'subconscious/one',
    'subconscious/two',
    'subconscious/three',
  ];
  const result = runSyncOnce(
    setupCommand(
      'pi',
      ['install'],
      baseEnv({
        PI_CODING_AGENT_DIR: dir,
        SUBCONSCIOUS_MODELS: catalog.join('\n'),
        API_KEY: 'sk-plain',
      }),
    ),
  );
  assert.equal(result.status, 0, result.stderr);
  const models = JSON.parse(
    await fs.readFile(path.join(dir, 'models.json'), 'utf8'),
  );
  assert.deepEqual(
    models.providers.subconscious.models.map((m) => m.id),
    // modelIds() puts the launch MODEL first, then the catalog.
    ['subconscious/glm-5.3-marathon', ...catalog],
  );
});

test('Pi refuses a model id that would change the shape of models.json', async () => {
  // modelIds() in bin/launch-values.js owns this check and runs while the
  // command is built, so the install never reaches models.json. Asserted at
  // that boundary rather than duplicated in the runbook.
  assert.throws(
    () =>
      setupCommand(
        'pi',
        ['install'],
        baseEnv({
          PI_CODING_AGENT_DIR: path.join(home, 'pi-models'),
          SUBCONSCIOUS_MODELS: 'subconscious/ok","unexpected":"yes',
          API_KEY: 'sk-plain',
        }),
      ),
    /Invalid model id/,
  );
  assert.equal(
    await exists(path.join(home, 'pi-models', 'models.json')),
    false,
  );
});

function runSyncOnce(command) {
  return spawnSync(command.file, command.args, {
    encoding: 'utf8',
    env: command.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
