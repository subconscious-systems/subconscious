import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-pi-test-'));
const fakeBinDir = path.join(testDir, 'bin');
const piDir = path.join(testDir, 'pi-agent');
await fs.mkdir(fakeBinDir, { recursive: true });
await fs.mkdir(piDir, { recursive: true });
await fs.writeFile(
  path.join(fakeBinDir, 'pi'),
  '#!/bin/sh\nprintf \'%s\\n\' "$*"\n',
  { mode: 0o755 },
);

after(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

test('Pi launch replaces only the Subconscious provider with the live catalog', async () => {
  const models = [
    'subconscious/glm-5.2',
    'subconscious/deepseek-v4-flash-marathon',
    'subconscious/glm-5.3-marathon',
    'subconscious/tim-qwen3.6-27b',
  ];
  const modelsPath = path.join(piDir, 'models.json');
  await fs.writeFile(
    modelsPath,
    JSON.stringify({
      providers: {
        other: { models: [{ id: 'other/model' }] },
        subconscious: { models: [{ id: 'gw-glm-5.2' }] },
      },
    }),
  );

  const runbook = new URL('../bin/runbook/pi/run.sh', import.meta.url);
  const result = spawnSync('bash', [runbook.pathname, '--continue'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBinDir}:${process.env.PATH}`,
      PI_CODING_AGENT_DIR: piDir,
      GATEWAY_URL: 'https://gateway.example',
      API_KEY: 'sk-test',
      MODEL: models[0],
      SUBCONSCIOUS_MODELS: models.join('\n'),
      SUBC_ENV_FILE: os.devNull,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), `--provider subconscious --model ${models[0]} --continue`);

  const config = JSON.parse(await fs.readFile(modelsPath, 'utf8'));
  assert.deepEqual(config.providers.other.models, [{ id: 'other/model' }]);
  assert.deepEqual(
    config.providers.subconscious.models.map((model) => model.id),
    models,
  );
  assert.equal(
    config.providers.subconscious.models.some((model) => model.id === 'gw-glm-5.2'),
    false,
  );
});
