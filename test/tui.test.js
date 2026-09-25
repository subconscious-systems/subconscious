import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import * as profiles from '../bin/profiles.js';
import {
  createLocalTuiState,
  createTuiState,
  isTuiResult,
  nativeTargetName,
  resolveTuiExecutable,
  runTui,
  tuiSourceIsNewerThan,
  writeAtomicJson,
} from '../bin/tui.js';

const testConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-tui-test-'));
process.env.SUBC_CONFIG_DIR = testConfigDir;
process.env.NO_COLOR = '1';
process.env.SUBC_DISABLE_UPDATE_CHECK = '1';

async function writeFakeTui(script) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-fake-tui-'));
  const file = path.join(dir, 'fake-tui.mjs');
  await fs.writeFile(file, script);
  return file;
}

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

test('source checkouts skip a native TUI binary older than the Go source', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-stale-tui-'));
  const binary = path.join(dir, 'subc-tui');
  const source = path.join(dir, 'main.go');
  const now = Date.now();
  await fs.writeFile(binary, 'old');
  await fs.utimes(binary, new Date(now - 10_000), new Date(now - 10_000));
  await fs.writeFile(source, 'package main\n');
  await fs.utimes(source, new Date(now), new Date(now));
  assert.equal(await tuiSourceIsNewerThan(binary, source), true);
  await fs.utimes(binary, new Date(now + 10_000), new Date(now + 10_000));
  assert.equal(await tuiSourceIsNewerThan(binary, source), false);
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
  const state = await createTuiState('platform-test', {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 'subconscious/test' }] }),
    }),
    discoverSessions: async () => [],
    disableUpdateCheck: true,
  });
  assert.equal(state.platformUrl, 'https://platform-dev.example');
  assert.equal(state.savedPlatformUrl, 'https://platform-dev.example');
  assert.equal(state.platformOverridden, false);
  assert.equal(state.modelsLoading, false);
  assert.equal(state.sessionsLoading, false);
});

test('writeAtomicJson replaces a file that is being read', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-atomic-json-'));
  const file = path.join(dir, 'updates.json');
  let stop = false;
  const reader = (async () => {
    while (!stop) {
      try {
        JSON.parse(await fs.readFile(file, 'utf8'));
      } catch {
        // A replace can leave a missing file for one poll.
      }
    }
  })();

  try {
    for (let i = 0; i < 20; i++) {
      await writeAtomicJson(file, { n: i, modelsLoading: false, sessionsLoading: false });
    }
    const last = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(last.n, 19);
    assert.equal(last.modelsLoading, false);
    assert.equal(last.sessionsLoading, false);
  } finally {
    stop = true;
    await reader;
  }
});

test('createLocalTuiState stays on disk and marks remote data as loading', async () => {
  const fetches = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    fetches.push(args);
    throw new Error('network should not run for local TUI state');
  };
  try {
    await profiles.ensureProfile('local-tui', 'secret-key');
    const state = await createLocalTuiState('local-tui');
    assert.equal(state.modelsLoading, true);
    assert.equal(state.sessionsLoading, true);
    assert.equal(state.modelSource, 'packaged');
    assert.deepEqual(state.sessions, []);
    assert.equal(fetches.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('runTui streams catalog and session patches after the TUI starts', async () => {
  await profiles.ensureProfile('stream-tui', 'secret-key');
  const fake = await writeFakeTui(`
    import fs from 'node:fs/promises';
    const updates = process.argv[process.argv.indexOf('--updates') + 1];
    const result = process.argv[process.argv.indexOf('--result') + 1];
    const deadline = Date.now() + 3000;
    let captured;
    while (Date.now() < deadline) {
      try {
        const data = JSON.parse(await fs.readFile(updates, 'utf8'));
        if (data.modelsLoading === false && data.sessionsLoading === false) {
          captured = data;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    if (!captured) process.exit(2);
    await fs.writeFile(result, JSON.stringify({ args: ['models'], captured }) + '\\n');
  `);

  const result = await runTui({
    profileName: 'stream-tui',
    binary: process.execPath,
    binaryArgs: [fake],
    stdio: 'ignore',
    disableUpdateCheck: true,
    resolveCatalog: async () => ({
      models: ['subconscious/live'],
      source: 'available',
      error: null,
    }),
    discoverSessions: async () => [
      {
        key: 'claude:session-1',
        harness: 'claude',
        harnessName: 'Claude Code',
        title: 'Repair auth',
        cwd: '/work',
        updatedAt: '2026-09-03T10:00:00Z',
        model: 'subconscious/live',
        portable: true,
      },
    ],
  });

  assert.equal(result.args[0], 'models');
  assert.equal(result.captured.modelSource, 'available');
  assert.deepEqual(result.captured.models, ['subconscious/live']);
  assert.equal(result.captured.sessions[0].key, 'claude:session-1');
});

test('runTui aborts leftover remote work when the TUI exits first', async () => {
  await profiles.ensureProfile('abort-tui', 'secret-key');
  const fake = await writeFakeTui(`
    import fs from 'node:fs';
    const result = process.argv[process.argv.indexOf('--result') + 1];
    fs.writeFileSync(result, JSON.stringify({ args: ['whoami'] }) + '\\n');
  `);

  let catalogCalls = 0;
  const started = Date.now();
  const result = await runTui({
    profileName: 'abort-tui',
    binary: process.execPath,
    binaryArgs: [fake],
    stdio: 'ignore',
    disableUpdateCheck: true,
    resolveCatalog: ({ signal }) =>
      new Promise((resolve, reject) => {
        catalogCalls += 1;
        const timer = setTimeout(
          () => resolve({ models: ['too-late'], source: 'available', error: null }),
          10_000,
        );
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            const error = new Error('cancelled');
            error.name = 'AbortError';
            reject(error);
          },
          { once: true },
        );
      }),
    discoverSessions: ({ signal }) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve([]), 10_000);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            const error = new Error('cancelled');
            error.name = 'AbortError';
            reject(error);
          },
          { once: true },
        );
      }),
  });

  assert.equal(result.args[0], 'whoami');
  assert.equal(catalogCalls, 1);
  assert.ok(Date.now() - started < 2000);
});
