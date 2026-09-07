import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createTuiState, isTuiResult, nativeTargetName, resolveTuiExecutable } from '../bin/tui.js';

test('nativeTargetName maps npm platforms and architectures to Go binaries', () => {
  assert.equal(nativeTargetName('darwin', 'arm64'), 'subc-tui-darwin-arm64');
  assert.equal(nativeTargetName('linux', 'x64'), 'subc-tui-linux-amd64');
  assert.equal(nativeTargetName('win32', 'x64'), 'subc-tui-windows-amd64.exe');
  assert.equal(nativeTargetName('freebsd', 'x64'), null);
});

test('SUBC_TUI_BIN overrides packaged and source-checkout binaries', async () => {
  const executable = await resolveTuiExecutable({ binary: '/tmp/custom-subc-tui' });
  assert.deepEqual(executable, {
    command: '/tmp/custom-subc-tui',
    args: [],
    cwd: undefined,
  });
});

test('TUI results can carry an inline base URL into the selected launch', () => {
  assert.equal(
    isTuiResult({
      args: ['-p', 'default', 'claude'],
      baseUrl: 'https://gateway.example',
    }),
    true,
  );
  assert.equal(isTuiResult({ args: ['claude'], baseUrl: 42 }), false);
});

test('createTuiState surfaces the gateway primary model from the live catalog', async (t) => {
  const testConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-tui-test-'));
  const previousConfigDir = process.env.SUBC_CONFIG_DIR;
  const previousFetch = globalThis.fetch;
  process.env.SUBC_CONFIG_DIR = testConfigDir;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      object: 'list',
      data: [
        { id: 'subconscious/one', object: 'model' },
        { id: 'subconscious/two', object: 'model', metadata: { primary: true } },
      ],
    }),
  });

  t.after(async () => {
    globalThis.fetch = previousFetch;
    if (previousConfigDir === undefined) {
      delete process.env.SUBC_CONFIG_DIR;
    } else {
      process.env.SUBC_CONFIG_DIR = previousConfigDir;
    }
    await fs.rm(testConfigDir, { recursive: true, force: true });
  });

  const { ensureProfile } = await import('../bin/profiles.js');
  await ensureProfile('default', 'sk-tui-test');
  const state = await createTuiState('default');

  assert.equal(state.modelSource, 'available');
  assert.equal(state.primaryModel, 'subconscious/two');
  assert.deepEqual(state.models, ['subconscious/two', 'subconscious/one']);
});
