import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runCommand } from '../bin/command-output.js';

const node = process.execPath;

test('runCommand returns the exit status and stdout', async () => {
  const result = await runCommand(node, ['-e', 'process.stdout.write("ok")']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ok');
});

test('runCommand kills a child that ignores SIGTERM at the deadline', async () => {
  const started = Date.now();
  const result = await runCommand(
    node,
    ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'],
    { timeout: 200 },
  );
  assert.equal(result.status, null);
  assert.match(result.error.message, /timed out after 200ms/);
  assert.ok(Date.now() - started < 3000);
});

test('runCommand stops waiting when a grandchild keeps the pipe open', async () => {
  const script = [
    'const { spawn } = require("node:child_process");',
    'spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], {',
    '  stdio: ["ignore", "inherit", "ignore"],',
    '}).unref();',
  ].join('\n');
  const started = Date.now();
  // Windows closes the pipe when the parent exits, so only the bound is shared.
  await runCommand(node, ['-e', script], { timeout: 300 });
  assert.ok(Date.now() - started < 3000);
});

test('runCommand stops the child when the caller aborts', async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  const started = Date.now();
  const result = await runCommand(node, ['-e', 'setInterval(() => {}, 1000)'], {
    timeout: 10_000,
    signal: controller.signal,
  });
  assert.equal(result.status, null);
  assert.match(result.error.message, /cancelled/);
  assert.ok(Date.now() - started < 3000);
});

test('runCommand reports a missing command without throwing', async () => {
  const result = await runCommand('subc-no-such-command-for-test', []);
  assert.equal(result.status, null);
  assert.ok(result.error);
});
