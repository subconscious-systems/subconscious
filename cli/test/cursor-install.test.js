import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const installPath = new URL('../bin/runbook/cursor/install.sh', import.meta.url);

function runInstall(home) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [installPath.pathname, 'install'], {
      env: {
        ...process.env,
        HOME: home,
        GATEWAY_URL: 'https://gateway.example',
        API_KEY: 'test-cursor-key',
        MODEL: 'subconscious/glm-5.2',
        SUBCONSCIOUS_MODELS: [
          'subconscious/glm-5.2',
          'subconscious/tim-qwen3.6-27b',
        ].join('\n'),
        MBTA_ENV_FILE: '/dev/null',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
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
