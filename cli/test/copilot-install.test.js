import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const installPath = new URL('../bin/runbook/copilot/install.sh', import.meta.url);

function runInstall(home) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [installPath.pathname, 'install'], {
      env: {
        ...process.env,
        HOME: home,
        GATEWAY_URL: 'https://gateway.example',
        API_KEY: 'test-copilot-key',
        MODEL: 'subconscious/glm-5.2',
        SUBCONSCIOUS_MODELS: 'subconscious/glm-5.2',
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

async function createVsCodeUserDirectory(home) {
  const suffix = process.platform === 'darwin'
    ? ['Library', 'Application Support', 'Code', 'User']
    : ['.config', 'Code', 'User'];
  const directory = path.join(home, ...suffix);
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

test('Copilot installer advertises thinking within the deployed context window', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-copilot-install-'));
  try {
    const userDirectory = await createVsCodeUserDirectory(home);
    const result = await runInstall(home);
    assert.equal(result.code, 0, result.stderr);

    const configuration = JSON.parse(
      await fs.readFile(path.join(userDirectory, 'chatLanguageModels.json'), 'utf8'),
    );
    const provider = configuration.find(({ name }) => name === 'Subconscious Gateway');
    assert.ok(provider);
    assert.equal(provider.apiType, 'chat-completions');
    assert.equal(provider.models.length, 1);
    assert.deepEqual(
      {
        thinking: provider.models[0].thinking,
        maxInputTokens: provider.models[0].maxInputTokens,
        maxOutputTokens: provider.models[0].maxOutputTokens,
      },
      { thinking: true, maxInputTokens: 12288, maxOutputTokens: 4096 },
    );
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
