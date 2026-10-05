import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { run, setupCommand } from './helpers/agent-command.js';

function runInstall(
  home,
  gatewayUrl = 'https://gateway.example',
  overrides = {},
  action = 'install',
) {
  return run(
    setupCommand('copilot', [action], {
      ...process.env,
      HOME: home,
      GATEWAY_URL: gatewayUrl,
      API_KEY: 'test-copilot-key',
      MODEL: 'subconscious/glm-5.3-marathon',
      SUBCONSCIOUS_MODELS: 'subconscious/glm-5.3-marathon',
      ...overrides,
    }),
  );
}

async function createVsCodeUserDirectory(home) {
  const suffix =
    process.platform === 'darwin'
      ? ['Library', 'Application Support', 'Code', 'User']
      : ['.config', 'Code', 'User'];
  const directory = path.join(home, ...suffix);
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

test('Copilot installer advertises thinking within the deployed context window', async () => {
  const home = await fs.mkdtemp(
    path.join(os.tmpdir(), 'subc-copilot-install-'),
  );
  try {
    const userDirectory = await createVsCodeUserDirectory(home);
    const result = await runInstall(home);
    assert.equal(result.code, 0, result.stderr);

    const configuration = JSON.parse(
      await fs.readFile(
        path.join(userDirectory, 'chatLanguageModels.json'),
        'utf8',
      ),
    );
    const provider = configuration.find(
      ({ name }) => name === 'Subconscious Gateway',
    );
    assert.ok(provider);
    assert.equal(provider.apiType, 'messages');
    assert.equal(provider.models.length, 1);
    assert.deepEqual(
      {
        thinking: provider.models[0].thinking,
        maxInputTokens: provider.models[0].maxInputTokens,
        maxOutputTokens: provider.models[0].maxOutputTokens,
      },
      { thinking: true, maxInputTokens: 5000000, maxOutputTokens: 65536 },
    );
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('Copilot enables vision for DeepSeek V4.1 without enabling it for other models', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-copilot-vision-'));
  const visionModel = 'subconscious/deepseek-v4.1-flash-marathon';
  const models = [
    visionModel,
    'subconscious/deepseek-v4-flash-marathon',
    `${visionModel}-other`,
    'custom/model',
  ];
  try {
    const userDirectory = await createVsCodeUserDirectory(home);
    const result = await runInstall(home, 'https://gateway.example', {
      MODEL: visionModel,
      SUBCONSCIOUS_MODELS: models.join('\n'),
    });
    assert.equal(result.code, 0, result.stderr);
    const providers = JSON.parse(
      await fs.readFile(
        path.join(userDirectory, 'chatLanguageModels.json'),
        'utf8',
      ),
    );
    const provider = providers.find(
      ({ name }) => name === 'Subconscious Gateway',
    );
    assert.deepEqual(
      provider.models.map((model) => model.id),
      models,
    );
    for (const model of provider.models)
      assert.equal(model.vision, model.id === visionModel, model.id);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('Copilot installer normalizes gateway origins and API paths', async () => {
  for (const gatewayUrl of [
    'https://api-dev.subconscious.dev',
    'https://api-dev.subconscious.dev/v1',
    'https://api-dev.subconscious.dev/v1/chat/completions',
    'https://api-dev.subconscious.dev/v1/responses',
    'https://api-dev.subconscious.dev/v1/messages',
  ]) {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-copilot-url-'));
    try {
      const userDirectory = await createVsCodeUserDirectory(home);
      const result = await runInstall(home, gatewayUrl);
      assert.equal(result.code, 0, result.stderr);
      const configuration = JSON.parse(
        await fs.readFile(
          path.join(userDirectory, 'chatLanguageModels.json'),
          'utf8',
        ),
      );
      const provider = configuration.find(
        ({ name }) => name === 'Subconscious Gateway',
      );
      assert.equal(
        provider.models[0].url,
        'https://api-dev.subconscious.dev/v1/messages',
      );
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  }
});

test('Copilot setup rejects malformed provider configuration without changing files', async () => {
  for (const original of ['{broken', '{}', 'null', '[null]', '["provider"]']) {
    for (const action of ['install', 'uninstall']) {
      const home = await fs.mkdtemp(
        path.join(os.tmpdir(), 'subc-copilot-invalid-'),
      );
      try {
        const directory = await createVsCodeUserDirectory(home);
        const file = path.join(directory, 'chatLanguageModels.json');
        await fs.writeFile(file, original);
        const result = await runInstall(
          home,
          'https://gateway.example',
          {},
          action,
        );
        assert.notEqual(result.code, 0, `${action} accepted ${original}`);
        assert.equal(await fs.readFile(file, 'utf8'), original);
        await assert.rejects(fs.access(path.join(home, '.copilot')), {
          code: 'ENOENT',
        });
      } finally {
        await fs.rm(home, { recursive: true, force: true });
      }
    }
  }
});

test('Copilot install and uninstall preserve user providers with similar names', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-copilot-owned-'));
  try {
    const directory = await createVsCodeUserDirectory(home);
    const file = path.join(directory, 'chatLanguageModels.json');
    const other = {
      name: 'My Subconscious experiments',
      models: [{ id: 'custom' }],
    };
    await fs.writeFile(
      file,
      JSON.stringify([other, { name: 'Subconscious Gateway', models: [] }]),
    );
    for (const action of ['install', 'install', 'uninstall']) {
      const result = await runInstall(
        home,
        'https://gateway.example',
        {},
        action,
      );
      assert.equal(result.code, 0, result.stderr);
      const providers = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.deepEqual(
        providers.filter(
          (provider) => provider.name !== 'Subconscious Gateway',
        ),
        [other],
      );
      assert.equal(
        providers.filter((provider) => provider.name === 'Subconscious Gateway')
          .length,
        action === 'uninstall' ? 0 : 1,
      );
    }
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('Copilot hook commands execute from home paths containing shell characters', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-copilot-path-'));
  const home = path.join(root, `space & "quote" 'apostrophe' home`);
  try {
    await createVsCodeUserDirectory(home);
    for (let run = 0; run < 2; run++) {
      const result = await runInstall(home);
      assert.equal(result.code, 0, result.stderr);
      const hooks = JSON.parse(
        await fs.readFile(
          path.join(home, '.copilot', 'hooks', 'subconscious-hooks.json'),
          'utf8',
        ),
      );
      for (const event of ['UserPromptSubmit', 'PreCompact']) {
        assert.equal(hooks.hooks[event].length, 1);
        const executed = spawnSync(
          'sh',
          ['-c', hooks.hooks[event][0].command],
          {
            encoding: 'utf8',
            input: '',
            env: { ...process.env, HOME: home },
          },
        );
        assert.equal(executed.status, 0, executed.stderr);
        assert.deepEqual(JSON.parse(executed.stdout), { continue: true });
      }
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
