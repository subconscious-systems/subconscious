import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { launchCommand, runSync } from './helpers/agent-command.js';

const skip = process.platform === 'win32';
const TOOLS = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin'];

let root;

before(async () => {
  if (skip) return;
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'subc-codex-launch-')),
  );
});

after(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});

// A fake codex that saves its env, one NAME=VALUE per line, and its argv.
const FAKE = `#!/bin/sh
env > "$CAPTURED_ENV"
printf '%s\\n' "$@" > "$CAPTURED_ARGS"
`;

async function runbookBox(name, apiKey = 'sk-test') {
  const dir = path.join(root, name);
  const bin = path.join(dir, 'bin');
  const tmp = path.join(dir, 'tmp');
  await fs.mkdir(bin, { recursive: true });
  await fs.mkdir(tmp, { recursive: true });
  await fs.writeFile(path.join(bin, 'codex'), FAKE, { mode: 0o755 });
  const env = {
    PATH: [bin, ...TOOLS].join(path.delimiter),
    HOME: dir,
    TMPDIR: tmp,
    GATEWAY_URL: 'https://gateway.example',
    API_KEY: apiKey,
    MODEL: 'subconscious/glm-5.3-marathon',
    CODEX_DIR: path.join(dir, '.codex'),
    CAPTURED_ENV: path.join(dir, 'env.txt'),
    CAPTURED_ARGS: path.join(dir, 'args.txt'),
  };
  const launch = (extra = {}) => {
    const result = runSync(
      launchCommand('codex', { env: { ...env, ...extra } }),
    );
    assert.equal(result.status, 0, result.stderr);
  };
  const captured = async () => ({
    env: (await fs.readFile(env.CAPTURED_ENV, 'utf8')).split('\n'),
    args: (await fs.readFile(env.CAPTURED_ARGS, 'utf8')).split('\n'),
  });
  return { dir, tmp, env, launch, captured };
}

test('an ordinary launch writes a temp catalog and no hooks', {
  skip,
}, async () => {
  const box = await runbookBox('ordinary');
  box.launch();
  await assert.rejects(fs.access(box.env.CODEX_DIR));
  const { args, env } = await box.captured();
  const catalog = args
    .find((arg) => arg.startsWith('model_catalog_json='))
    .slice('model_catalog_json='.length);
  // macOS mktemp -t ignores TMPDIR, so the file is in the user temp dir.
  try {
    assert.match(path.basename(catalog), /^codex-model-catalog\./);
    await fs.access(catalog);
  } finally {
    await fs.rm(catalog, { force: true });
  }
  assert.ok(!env.some((line) => line.startsWith('SUBCONSCIOUS_CODEX_LAUNCH=')));
});

test('a protocol launch reuses one catalog file', { skip }, async () => {
  const box = await runbookBox('protocol');
  const catalogDir = path.join(box.dir, 'catalog');
  await fs.mkdir(catalogDir, { mode: 0o700 });
  const catalog = path.join(catalogDir, 'model-catalog.json');
  const protocol = {
    SUBC_CODEX_PROTOCOL_LAUNCH: '1',
    SUBC_CODEX_CATALOG_FILE: catalog,
  };
  box.launch(protocol);
  const first = await fs.stat(catalog);
  assert.equal(first.mode & 0o777, 0o600);
  box.launch(protocol);
  assert.equal((await fs.stat(catalog)).mtimeMs, first.mtimeMs);
  assert.deepEqual(await fs.readdir(catalogDir), ['model-catalog.json']);
  await assert.rejects(fs.access(box.env.CODEX_DIR));
  assert.deepEqual(await fs.readdir(box.tmp), []);
  const { env, args } = await box.captured();
  assert.ok(args.includes(`model_catalog_json=${catalog}`));
  assert.ok(!env.some((line) => line.startsWith('SUBC_CODEX_')), env.join(' '));
  const models = JSON.parse(await fs.readFile(catalog, 'utf8')).models;
  assert.equal(models[0].slug, 'subconscious/glm-5.3-marathon');

  // A changed model list replaces the file in place.
  box.launch({ ...protocol, MODEL: 'subconscious/other-model' });
  const replaced = JSON.parse(await fs.readFile(catalog, 'utf8')).models;
  assert.equal(replaced[0].slug, 'subconscious/other-model');
  assert.deepEqual(await fs.readdir(catalogDir), ['model-catalog.json']);
});

test('a protocol launch leaves old hooks for subc t3 install to remove', {
  skip,
}, async () => {
  const box = await runbookBox('protocol-old-hooks');
  await fs.mkdir(box.env.CODEX_DIR, { recursive: true });
  const script = path.join(box.env.CODEX_DIR, 'subconscious-hook.sh');
  await fs.writeFile(script, '#!/usr/bin/env bash\n', { mode: 0o755 });
  const catalogDir = path.join(box.dir, 'catalog');
  await fs.mkdir(catalogDir, { mode: 0o700 });
  box.launch({
    SUBC_CODEX_PROTOCOL_LAUNCH: '1',
    SUBC_CODEX_CATALOG_FILE: path.join(catalogDir, 'model-catalog.json'),
  });
  await fs.access(script);
});

test('the key never appears in the argv of the Codex launch', {
  skip,
}, async () => {
  const key = 'sk-argv-secret-0123';
  const box = await runbookBox('argv', key);
  box.launch();
  const { args, env } = await box.captured();
  assert.ok(!args.some((arg) => arg.includes(key)), args.join(' '));
  assert.ok(env.includes(`SUBCONSCIOUS_API_KEY=${key}`));
  const catalog = args
    .find((arg) => arg.startsWith('model_catalog_json='))
    .slice('model_catalog_json='.length);
  await fs.rm(catalog, { force: true });
});
