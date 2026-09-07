import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import * as profiles from '../bin/profiles.js';
import { createTuiState, isTuiResult, nativeTargetName, resolveTuiExecutable } from '../bin/tui.js';

const testConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-tui-test-'));
process.env.SUBC_CONFIG_DIR = testConfigDir;
process.env.NO_COLOR = '1';
process.env.SUBC_DISABLE_UPDATE_CHECK = '1';

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

test('createTuiState includes resolved platform URL fields', async () => {
  await profiles.ensureProfile('platform-test', 'secret-key');
  await profiles.updateProfile('platform-test', {
    PLATFORM_URL: 'https://platform-dev.example',
  });
  const state = await createTuiState('platform-test');
  assert.equal(state.platformUrl, 'https://platform-dev.example');
  assert.equal(state.savedPlatformUrl, 'https://platform-dev.example');
  assert.equal(state.platformOverridden, false);
});
