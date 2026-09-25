import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  OPENCODE_PROVIDER_ID,
  OPENCODE_PROVIDER_NAME,
  opencodeModelDisplayName,
} from '../bin/opencode-provider.js';

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
    'subconscious/deepseek-v4.1-flash-marathon',
    'subconscious/deepseek-v4.1-flash-marathon-other',
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
  assert.deepEqual(config.disabled_providers, ['subconscious-cli']);
  assert.deepEqual(Object.keys(config.provider), [OPENCODE_PROVIDER_ID]);
  assert.equal(config.provider[OPENCODE_PROVIDER_ID].name, OPENCODE_PROVIDER_NAME);
  assert.deepEqual(config.provider[OPENCODE_PROVIDER_ID].whitelist, models);
  assert.equal(
    config.provider[OPENCODE_PROVIDER_ID].options.modelsDiscovery.enabled,
    false,
  );
  assert.deepEqual(Object.keys(config.provider[OPENCODE_PROVIDER_ID].models), models);
  assert.equal(config.model, `${OPENCODE_PROVIDER_ID}/${models[0]}`);
  assert.equal(config.provider[OPENCODE_PROVIDER_ID].models['gw-glm-5.2'], undefined);
  assert.equal(
    config.provider[OPENCODE_PROVIDER_ID].models['subconscious/glm-5.2'].name,
    'Glm 5.2',
  );
  assert.equal(
    config.provider[OPENCODE_PROVIDER_ID].models['subconscious/tim-qwen3.6-27b'].name,
    'Tim Qwen3.6 27B',
  );
  assert.equal(
    config.provider[OPENCODE_PROVIDER_ID].models['subconscious/deepseek-v4-flash-marathon'].name,
    'Deepseek V4 Flash Marathon',
  );
  for (const [id, model] of Object.entries(config.provider[OPENCODE_PROVIDER_ID].models)) {
    const vision = id === 'subconscious/deepseek-v4.1-flash-marathon';
    assert.equal(model.attachment, vision ? true : undefined, id);
    assert.deepEqual(model.modalities, vision ? { input: ['text', 'image'], output: ['text'] } : undefined, id);
  }
});

test('OpenCode enables vision for an explicitly selected model missing from the catalog', () => {
  const model = 'subconscious/deepseek-v4.1-flash-marathon';
  const result = spawnSync('bash', [new URL('../bin/runbook/opencode/run.sh', import.meta.url).pathname], {
    encoding: 'utf8',
    env: {
      ...process.env, PATH: `${testDir}:${process.env.PATH}`, GATEWAY_URL: 'https://gateway.example',
      API_KEY: 'sk-test', MODEL: model, SUBCONSCIOUS_MODELS: 'custom/model', SUBC_ENV_FILE: os.devNull,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.equal(config.model, `${OPENCODE_PROVIDER_ID}/${model}`);
  assert.equal(config.provider[OPENCODE_PROVIDER_ID].models[model].attachment, true);
});

test('the standalone OpenCode installer also advertises vision and preserves other providers', async () => {
  const home = await fs.mkdtemp(path.join(testDir, 'install-'));
  const file = path.join(home, '.opencode', 'opencode.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ provider: { other: { models: { keep: {} } } } }));
  const model = 'subconscious/deepseek-v4.1-flash-marathon';
  const result = spawnSync('bash', [new URL('../bin/runbook/opencode/install.sh', import.meta.url).pathname, 'install'], {
    encoding: 'utf8',
    env: {
      ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'),
      GATEWAY_URL: 'https://gateway.example', API_KEY: 'sk-test', MODEL: model,
      SUBCONSCIOUS_MODELS: 'subconscious/deepseek-v4-flash-marathon', SUBC_ENV_FILE: os.devNull,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(config.provider.other, { models: { keep: {} } });
  assert.equal(config.provider.subconscious.name, OPENCODE_PROVIDER_NAME);
  assert.equal(config.model, `${OPENCODE_PROVIDER_ID}/${model}`);
  assert.equal(config.provider.subconscious.models[model].attachment, true);
  assert.deepEqual(config.provider.subconscious.models[model].modalities, { input: ['text', 'image'], output: ['text'] });
  assert.equal(config.provider.subconscious.models['subconscious/deepseek-v4-flash-marathon'].attachment, undefined);
});

test('OpenCode model display names are capitalized from the id', () => {
  assert.equal(opencodeModelDisplayName('subconscious/glm-5.3-marathon'), 'Glm 5.3 Marathon');
  assert.equal(opencodeModelDisplayName('subconscious/tim-qwen3.6-27b'), 'Tim Qwen3.6 27B');
  assert.equal(opencodeModelDisplayName('subconscious/deepseek-v4.1-flash-marathon'), 'Deepseek V4.1 Flash Marathon');
  assert.equal(opencodeModelDisplayName('subconscious/custom-model'), 'Custom Model');
  assert.equal(opencodeModelDisplayName('subconscious/gpt-oss-20b'), 'GPT OSS 20B');
});
