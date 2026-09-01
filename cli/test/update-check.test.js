import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compareVersions,
  fetchLatestVersion,
  installLatest,
  moveUpdateSelection,
  renderUpdateNotice,
  renderUpdateOptions,
  showUpdateNotice,
} from '../bin/update-check.js';

process.env.NO_COLOR = '1';

test('compareVersions follows semantic version precedence', () => {
  assert.equal(compareVersions('4.0.1', '4.0.0'), 1);
  assert.equal(compareVersions('4.1.0', '4.0.9'), 1);
  assert.equal(compareVersions('5.0.0', '4.99.99'), 1);
  assert.equal(compareVersions('4.0.0', '4.0.0'), 0);
  assert.equal(compareVersions('4.0.0-beta.2', '4.0.0-beta.1'), 1);
  assert.equal(compareVersions('4.0.0', '4.0.0-beta.2'), 1);
});

test('fetchLatestVersion checks the npm latest endpoint without caching', async () => {
  let request;
  const version = await fetchLatestVersion({
    timeoutMs: 50,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ version: '4.1.0' }) };
    },
  });

  assert.equal(version, '4.1.0');
  assert.equal(request.url, 'https://registry.npmjs.org/subconscious-cli/latest');
  assert.equal(request.options.cache, 'no-store');
  assert.ok(request.options.signal instanceof AbortSignal);
});

test('renderUpdateNotice keeps the selectable options outside the box', () => {
  const notice = renderUpdateNotice('4.0.0', '4.1.0');
  assert.match(notice, /Subconscious CLI update available/);
  assert.match(notice, /4\.0\.0 -> 4\.1\.0/);
  assert.doesNotMatch(notice, /Update\s+\|\n.*Skip/);

  const options = renderUpdateOptions(0, { installedVersion: '4.0.0' });
  assert.match(options, />\s+Update now/);
  assert.match(options, /Runs `npm install -g subconscious-cli@latest`/);
  assert.match(options, /\s+Skip for now/);
  assert.match(options, /Continue this command with version 4\.0\.0/);
});

test('arrow keys move and wrap the highlighted update option', () => {
  assert.equal(moveUpdateSelection(0, 'down'), 1);
  assert.equal(moveUpdateSelection(1, 'down'), 0);
  assert.equal(moveUpdateSelection(0, 'up'), 1);
  assert.equal(moveUpdateSelection(1, 'up'), 0);
  assert.equal(moveUpdateSelection(1, 'space'), 1);
});

test('showUpdateNotice prints on every newer-version check', async () => {
  const output = [];
  const options = {
    currentVersion: '4.0.0',
    latestVersion: '4.1.0',
    interactive: false,
    write: (text) => output.push(text),
  };

  await showUpdateNotice(options);
  await showUpdateNotice(options);

  assert.equal(output.length, 2);
  assert.match(output[0], /4\.0\.0 -> 4\.1\.0/);
  assert.match(output[1], /4\.0\.0 -> 4\.1\.0/);
});

test('showUpdateNotice installs after Update is selected', async () => {
  const output = [];
  let installs = 0;
  const result = await showUpdateNotice({
    currentVersion: '4.0.0',
    latestVersion: '4.1.0',
    interactive: true,
    select: async () => 'update',
    install: async () => {
      installs += 1;
      return true;
    },
    write: (text) => output.push(text),
  });

  assert.equal(installs, 1);
  assert.equal(result.action, 'updated');
  assert.match(output.join(''), /Update complete/);
  assert.match(output.join(''), /Re-run your subc command/);
});

test('showUpdateNotice continues without installing after Skip is selected', async () => {
  let installed = false;
  const result = await showUpdateNotice({
    currentVersion: '4.0.0',
    latestVersion: '4.1.0',
    interactive: true,
    select: async () => 'skip',
    install: async () => {
      installed = true;
      return true;
    },
    write: () => {},
  });

  assert.equal(installed, false);
  assert.equal(result.action, 'skip');
});

test('installLatest invokes npm without a shell', async () => {
  let invocation;
  const installed = await installLatest({
    spawnImpl: (command, args, options) => {
      invocation = { command, args, options };
      return {
        on(event, callback) {
          if (event === 'exit') callback(0);
        },
      };
    },
  });

  assert.equal(installed, true);
  assert.deepEqual(invocation, {
    command: 'npm',
    args: ['install', '-g', 'subconscious-cli@latest'],
    options: { stdio: 'inherit' },
  });
});

test('showUpdateNotice stays silent when current, disabled, or offline', async () => {
  const output = [];
  const write = (text) => output.push(text);

  assert.equal(
    await showUpdateNotice({
      currentVersion: '4.1.0',
      latestVersion: '4.1.0',
      interactive: false,
      write,
    }),
    null,
  );
  assert.equal(
    await showUpdateNotice({
      currentVersion: '4.1.0',
      interactive: false,
      fetchImpl: async () => {
        throw new Error('offline');
      },
      write,
    }),
    null,
  );
  assert.equal(await showUpdateNotice({ disabled: true, interactive: false, write }), null);
  assert.deepEqual(output, []);
});
