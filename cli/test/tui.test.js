import assert from 'node:assert/strict';
import test from 'node:test';

import { isTuiResult, nativeTargetName, resolveTuiExecutable } from '../bin/tui.js';

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
