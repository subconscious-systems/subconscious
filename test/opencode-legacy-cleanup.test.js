import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { windowsSetup } from '../bin/windows/setup.js';

async function fixture(model) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-open-legacy-'));
  const directory = path.join(root, '.opencode');
  const file = path.join(directory, 'opencode.json');
  await fs.mkdir(directory);
  await fs.writeFile(
    file,
    JSON.stringify({
      provider: {
        'subconscious-cli': { name: 'Legacy gateway' },
        other: { name: 'Keep this' },
      },
      model,
      theme: 'keep-this',
    }),
  );
  return { root, file };
}

test('native OpenCode cleanup recognizes and removes the legacy provider namespace', async () => {
  for (const model of [
    'subconscious-cli/subconscious/test',
    'subconscious/subconscious/test',
    'subconscious-cli-custom/test',
  ]) {
    const { root, file } = await fixture(model);
    try {
      const messages = [];
      await windowsSetup(
        'opencode',
        'status',
        [],
        {},
        { home: root, log: (message) => messages.push(message) },
      );
      assert.ok(
        messages.some((message) =>
          message.includes('legacy integration exists'),
        ),
      );
      await windowsSetup(
        'opencode',
        'uninstall',
        [],
        {},
        { home: root, log: () => {} },
      );
      const document = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.deepEqual(document.provider, { other: { name: 'Keep this' } });
      assert.equal(document.theme, 'keep-this');
      assert.equal(
        document.model,
        model.startsWith('subconscious-cli-custom/') ? model : undefined,
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

test('Unix OpenCode cleanup clears a model selected from either owned namespace', {
  skip: process.platform === 'win32',
}, async () => {
  for (const model of [
    'subconscious-cli/subconscious/test',
    'subconscious/subconscious/test',
    'subconscious-cli-custom/test',
  ]) {
    const { root, file } = await fixture(model);
    try {
      const result = spawnSync(
        'bash',
        [
          fileURLToPath(
            new URL('../bin/runbook/opencode/install.sh', import.meta.url),
          ),
          'uninstall',
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            HOME: root,
            XDG_CONFIG_HOME: path.join(root, '.config'),
          },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const document = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.deepEqual(document.provider, { other: { name: 'Keep this' } });
      assert.equal(
        document.model,
        model.startsWith('subconscious-cli-custom/') ? model : undefined,
      );
      assert.equal(document.theme, 'keep-this');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});
