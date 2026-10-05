import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { run, setupCommand } from './helpers/agent-command.js';

function runInstall(home, action = 'install') {
  return run(
    setupCommand('cursor', [action], {
      ...process.env,
      HOME: home,
      GATEWAY_URL: 'https://gateway.example',
      API_KEY: 'test-cursor-key',
      MODEL: 'subconscious/glm-5.3-marathon',
      SUBCONSCIOUS_MODELS: [
        'subconscious/glm-5.3-marathon',
        'subconscious/tim-qwen3.6-27b',
      ].join('\n'),
    }),
  );
}

test('Cursor installer separates the UI /v1 URL from the hook origin', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-cursor-install-'));
  try {
    const result = await runInstall(home);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Base URL: https:\/\/gateway\.example\/v1/);

    const hookEnv = await fs.readFile(
      path.join(home, '.cursor', 'subconscious-hooks.env'),
      'utf8',
    );
    assert.match(
      hookEnv,
      /SUBCONSCIOUS_GATEWAY_URL='https:\/\/gateway\.example'/,
    );
    assert.doesNotMatch(
      hookEnv,
      /SUBCONSCIOUS_GATEWAY_URL='https:\/\/gateway\.example\/v1'/,
    );

    const hooks = JSON.parse(
      await fs.readFile(path.join(home, '.cursor', 'hooks.json'), 'utf8'),
    );
    assert.equal(hooks.hooks.beforeSubmitPrompt.length, 1);
    assert.equal(hooks.hooks.preCompact.length, 1);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('Cursor hooks execute from home paths containing spaces and shell characters', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-cursor-path-'));
  const home = path.join(root, `space & "quote" 'apostrophe' home`);
  await fs.mkdir(home);
  try {
    for (const action of ['install', 'install']) {
      const result = await runInstall(home, action);
      assert.equal(result.code, 0, result.stderr);
      const hooks = JSON.parse(
        await fs.readFile(path.join(home, '.cursor', 'hooks.json'), 'utf8'),
      );
      for (const event of ['beforeSubmitPrompt', 'preCompact']) {
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
        assert.deepEqual(JSON.parse(executed.stdout), {
          continue: true,
          permission: 'allow',
        });
      }
    }
    const removed = await runInstall(home, 'uninstall');
    assert.equal(removed.code, 0, removed.stderr);
    const hooks = JSON.parse(
      await fs.readFile(path.join(home, '.cursor', 'hooks.json'), 'utf8'),
    );
    assert.ok(
      Object.values(hooks.hooks).every((entries) => entries.length === 0),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
