import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  launchCommand,
  runSync,
  setupCommand,
} from './helpers/agent-command.js';

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
    'subconscious/deepseek-v4.1-flash-marathon',
    'subconscious/glm-5.2',
    'subconscious/deepseek-v4.1-flash-marathon-other',
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

  const result = runSync(
    launchCommand('pi', {
      args: ['--continue'],
      env: {
        ...process.env,
        PATH: `${fakeBinDir}:${process.env.PATH}`,
        PI_CODING_AGENT_DIR: piDir,
        GATEWAY_URL: 'https://gateway.example',
        API_KEY: 'sk-test',
        MODEL: models[0],
        SUBCONSCIOUS_MODELS: models.join('\n'),
      },
    }),
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    `--provider subconscious --model ${models[0]} --continue`,
  );

  const config = JSON.parse(await fs.readFile(modelsPath, 'utf8'));
  for (const model of config.providers.subconscious.models) {
    assert.deepEqual(
      model.input,
      model.id === models[0] ? ['text', 'image'] : undefined,
      model.id,
    );
  }
  assert.deepEqual(config.providers.other.models, [{ id: 'other/model' }]);
  assert.deepEqual(
    config.providers.subconscious.models.map((model) => model.id),
    models,
  );
  assert.equal(
    config.providers.subconscious.models.some(
      (model) => model.id === 'gw-glm-5.2',
    ),
    false,
  );
});

function piSetup(dir, action) {
  return runSync(
    setupCommand('pi', [action], {
      ...process.env,
      PI_CODING_AGENT_DIR: dir,
      GATEWAY_URL: 'https://gateway.example',
      API_KEY: 'sk-test',
      MODEL: 'subconscious/glm-5.3-marathon',
      SUBCONSCIOUS_MODELS: 'subconscious/glm-5.3-marathon',
    }),
  );
}

// What an older install left next to the provider: the compaction extension
// and its env file. The user also has an extension and a provider of their own.
async function writeOldPiInstall(dir) {
  const extensions = path.join(dir, 'extensions');
  await fs.mkdir(extensions, { recursive: true });
  await fs.writeFile(
    path.join(extensions, 'subconscious-compaction.ts'),
    '// old\n',
  );
  await fs.writeFile(path.join(extensions, 'mine.ts'), '// user\n');
  await fs.writeFile(path.join(dir, 'subconscious.env'), 'x=1\n');
  await fs.writeFile(
    path.join(dir, 'models.json'),
    JSON.stringify({ providers: { other: { models: [{ id: 'o' }] } } }),
  );
}

test('Pi install writes the provider and image window, and nothing for compaction', async () => {
  const dir = path.join(testDir, 'pi-fresh');
  const result = piSetup(dir, 'install');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await fs.readdir(dir)).sort(), [
    'extensions',
    'models.json',
  ]);
  assert.deepEqual(await fs.readdir(path.join(dir, 'extensions')), [
    'subconscious-image-window',
  ]);
  const { providers } = JSON.parse(
    await fs.readFile(path.join(dir, 'models.json'), 'utf8'),
  );
  assert.deepEqual(providers.subconscious.headers, {
    'x-subconscious-client': 'pi',
  });
  assert.deepEqual(providers.subconscious.models[0].compat, {
    sendSessionAffinityHeaders: true,
    sessionAffinityFormat: 'openai-nosession',
  });
});

test('Pi install over an old install removes the compaction files and keeps the user', async () => {
  const dir = path.join(testDir, 'pi-upgrade');
  await writeOldPiInstall(dir);
  const result = piSetup(dir, 'install');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await fs.readdir(dir)).sort(), [
    'extensions',
    'models.json',
  ]);
  assert.deepEqual((await fs.readdir(path.join(dir, 'extensions'))).sort(), [
    'mine.ts',
    'subconscious-image-window',
  ]);
  const { providers } = JSON.parse(
    await fs.readFile(path.join(dir, 'models.json'), 'utf8'),
  );
  assert.deepEqual(Object.keys(providers).sort(), ['other', 'subconscious']);
});

test('Pi uninstall removes an old install and keeps the user', async () => {
  const dir = path.join(testDir, 'pi-uninstall');
  await writeOldPiInstall(dir);
  const result = piSetup(dir, 'uninstall');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await fs.readdir(dir)).sort(), [
    'extensions',
    'models.json',
  ]);
  assert.deepEqual(await fs.readdir(path.join(dir, 'extensions')), ['mine.ts']);
});
