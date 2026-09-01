import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-opencode-test-'));
const fakeOpenCode = path.join(testDir, 'opencode');
await fs.writeFile(fakeOpenCode, '#!/bin/sh\nprintf \'%s\' "$OPENCODE_CONFIG_CONTENT"\n', {
  mode: 0o755,
});

after(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

test('OpenCode launch replaces the Subconscious catalog on every startup', () => {
  const models = [
    'subconscious/glm-5.2',
    'subconscious/deepseek-v4-flash-marathon',
    'subconscious/glm-5.3-marathon',
    'subconscious/tim-qwen3.6-27b',
  ];
  const runbook = new URL('../bin/runbook/opencode/run.sh', import.meta.url);
  const result = spawnSync('bash', [runbook.pathname], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${testDir}:${process.env.PATH}`,
      GATEWAY_URL: 'https://gateway.example',
      API_KEY: 'sk-test',
      MODEL: models[0],
      SUBCONSCIOUS_MODELS: models.join('\n'),
      SUBC_ENV_FILE: os.devNull,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.deepEqual(config.disabled_providers, ['subconscious']);
  assert.deepEqual(Object.keys(config.provider), ['subconscious-cli']);
  assert.deepEqual(Object.keys(config.provider['subconscious-cli'].models), models);
  assert.equal(config.model, `subconscious-cli/${models[0]}`);
  assert.equal(config.provider['subconscious-cli'].models['gw-glm-5.2'], undefined);
});
