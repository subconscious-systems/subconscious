import assert from 'node:assert/strict';
import { accessSync, constants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { agentById } from '../bin/agent-data.js';
import { launchPlan } from '../bin/agent-launch.js';
import { launchCommand, runSync } from './helpers/agent-command.js';
import { fakeGateway, run } from './helpers/t3-sandbox.js';

const skip = process.platform === 'win32';
const HOOK = fileURLToPath(
  new URL('../bin/runbook/codex/hook.sh', import.meta.url),
);
const TOOLS = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin'];

let gateway;
let other;
let root;

before(async () => {
  if (skip) return;
  gateway = await fakeGateway();
  other = await fakeGateway();
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'subc-codex-hook-')),
  );
});

after(async () => {
  await gateway?.close();
  await other?.close();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

/** A HOME whose env file names `other` and its key, as an older launch left it. */
async function hookHome(name) {
  const home = path.join(root, name);
  await fs.mkdir(path.join(home, '.codex'), { recursive: true });
  await fs.writeFile(
    path.join(home, '.codex', 'subconscious-hooks.env'),
    `export SUBCONSCIOUS_GATEWAY_URL='${other.url}'\nexport SUBCONSCIOUS_API_KEY='sk-env-file'\n`,
    { mode: 0o600 },
  );
  return home;
}

function fireHook(home, env) {
  return run('bash', [HOOK], {
    env: { PATH: TOOLS.join(path.delimiter), HOME: home, ...env },
    input: JSON.stringify({
      hook_event_name: 'PreCompact',
      session_id: 'thr_hooktest',
      turn_id: 'turn_1',
    }),
  });
}

const hookPosts = (server) =>
  server.requests.filter((request) => request.url === '/v1/agent-hooks');

test('the hook sends nothing for a Codex session subc did not start', {
  skip,
}, async () => {
  const home = await hookHome('plain-codex');
  const result = await fireHook(home, {
    SUBCONSCIOUS_API_KEY: 'sk-launch',
    SUBCONSCIOUS_GATEWAY_URL: gateway.url,
  });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, '');
  assert.deepEqual(hookPosts(gateway), []);
  assert.deepEqual(hookPosts(other), []);
});

test("the hook reports with the launch's key and gateway, not the env file", {
  skip,
}, async () => {
  const home = await hookHome('launched');
  const result = await fireHook(home, {
    SUBCONSCIOUS_CODEX_LAUNCH: 'subc',
    SUBCONSCIOUS_API_KEY: 'sk-launch',
    SUBCONSCIOUS_GATEWAY_URL: gateway.url,
  });
  assert.equal(result.code, 0);
  const posts = hookPosts(gateway);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].authorization, 'Bearer sk-launch');
  assert.equal(JSON.parse(posts[0].body).conversation_id, 'thr_hooktest');
  assert.deepEqual(hookPosts(other), []);
});

test('the hook falls back to the env file when the launch gave no key', {
  skip,
}, async () => {
  const home = await hookHome('env-file');
  const before = hookPosts(other).length;
  const result = await fireHook(home, { SUBCONSCIOUS_CODEX_LAUNCH: 'subc' });
  assert.equal(result.code, 0);
  const posts = hookPosts(other).slice(before);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].authorization, 'Bearer sk-env-file');
});

test('a session with its own Codex home keeps its hook log there', {
  skip,
}, async () => {
  const home = await hookHome('dedicated');
  const codexHome = path.join(home, 'dedicated-codex');
  await fs.mkdir(codexHome);
  const result = await fireHook(home, {
    SUBCONSCIOUS_CODEX_LAUNCH: 'subc',
    SUBCONSCIOUS_API_KEY: 'sk-launch',
    SUBCONSCIOUS_GATEWAY_URL: gateway.url,
    CODEX_HOME: codexHome,
  });
  assert.equal(result.code, 0);
  await fs.access(
    path.join(codexHome, 'subconscious-hook-logs', 'thr_hooktest.log'),
  );
  await assert.rejects(
    fs.access(path.join(home, '.codex', 'subconscious-hook-logs')),
  );
});

test('every subc Codex launch marks itself for the hook', () => {
  const agent = agentById('codex');
  const env = {
    GATEWAY_URL: 'https://gateway.example',
    API_KEY: 'sk-test',
    MODEL: 'subconscious/glm-5.3-marathon',
  };
  for (const prompt of [undefined, 'task']) {
    const plan = launchPlan(agent, { env, prompt });
    assert.equal(plan.env.SUBCONSCIOUS_CODEX_LAUNCH, 'subc');
  }
});

// A fake codex that saves its env, one NAME=VALUE per line, and its argv.
const FAKE = `#!/bin/sh
env > "$CAPTURED_ENV"
printf '%s\\n' "$@" > "$CAPTURED_ARGS"
`;

async function runbookBox(name) {
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
    API_KEY: 'sk-test',
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

test('an ordinary launch still merges hooks and writes a temp catalog', {
  skip,
}, async () => {
  const box = await runbookBox('ordinary');
  box.launch();
  await fs.access(path.join(box.env.CODEX_DIR, 'hooks.json'));
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
  assert.ok(env.includes('SUBCONSCIOUS_CODEX_LAUNCH=subc'));
});

test('a protocol launch writes no hooks and reuses one catalog file', {
  skip,
}, async () => {
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
  assert.ok(env.includes('SUBCONSCIOUS_CODEX_LAUNCH=subc'));
  const models = JSON.parse(await fs.readFile(catalog, 'utf8')).models;
  assert.equal(models[0].slug, 'subconscious/glm-5.3-marathon');

  // A changed model list replaces the file in place.
  box.launch({ ...protocol, MODEL: 'subconscious/other-model' });
  const replaced = JSON.parse(await fs.readFile(catalog, 'utf8')).models;
  assert.equal(replaced[0].slug, 'subconscious/other-model');
  assert.deepEqual(await fs.readdir(catalogDir), ['model-catalog.json']);
});

const HOOKS_LIB = fileURLToPath(
  new URL('../bin/runbook/codex/hooks-lib.sh', import.meta.url),
);

/**
 * A ~/.codex as an older subc left it: the previous hook script, and a
 * hooks.json whose PreCompact has subc's group and then one of the user's.
 */
async function oldInstall(name, command) {
  const codexDir = path.join(root, name, '.codex');
  await fs.mkdir(codexDir, { recursive: true });
  const hookDst = path.join(codexDir, 'subconscious-hook.sh');
  await fs.writeFile(hookDst, '#!/usr/bin/env bash\n# previous hook\n', {
    mode: 0o755,
  });
  const ours = (statusMessage) => ({
    hooks: [
      {
        type: 'command',
        command: command ?? hookDst,
        timeout: 3,
        statusMessage,
      },
    ],
  });
  const hooksJson = path.join(codexDir, 'hooks.json');
  await fs.writeFile(
    hooksJson,
    `${JSON.stringify(
      {
        hooks: {
          PreCompact: [
            ours('Reporting compaction start'),
            { hooks: [{ type: 'command', command: '/usr/local/bin/my-hook' }] },
          ],
          PostCompact: [ours('Reporting compaction end')],
        },
      },
      null,
      2,
    )}\n`,
  );
  return { codexDir, hookDst, hooksJson };
}

function ensureHooks(codexDir, env = {}) {
  return run(
    'bash',
    ['-c', `source "${HOOKS_LIB}" && codex_ensure_hooks best-effort`],
    {
      env: {
        PATH: TOOLS.join(path.delimiter),
        HOME: path.dirname(codexDir),
        CODEX_DIR: codexDir,
        HOOK_SRC: HOOK,
        GATEWAY_URL: 'https://gateway.example',
        API_KEY: 'sk-test',
        ...env,
      },
    },
  );
}

test('a new hook script leaves hooks.json and its trust unchanged', {
  skip,
}, async () => {
  const box = await oldInstall('upgrade');
  const before = await fs.readFile(box.hooksJson);
  const result = await ensureHooks(box.codexDir);
  assert.equal(result.code, 0, result.stderr);
  // Codex keys trust on each entry's position and hashes the entry, so the
  // file must not move or change.
  assert.deepEqual(await fs.readFile(box.hooksJson), before);
  assert.deepEqual(await fs.readFile(box.hookDst), await fs.readFile(HOOK));
  assert.doesNotMatch(result.stdout, /trust/);
  const envFile = path.join(box.codexDir, 'subconscious-hooks.env');
  assert.match(await fs.readFile(envFile, 'utf8'), /sk-test/);
});

test('an entry with an old hook path is fixed in place', {
  skip,
}, async () => {
  const box = await oldInstall(
    'moved',
    '/old/home/.codex/subconscious-hook.sh',
  );
  const result = await ensureHooks(box.codexDir);
  assert.equal(result.code, 0, result.stderr);
  const { hooks } = JSON.parse(await fs.readFile(box.hooksJson, 'utf8'));
  assert.equal(hooks.PreCompact.length, 2);
  assert.equal(hooks.PreCompact[0].hooks[0].command, box.hookDst);
  // The user's hook keeps its position, so it keeps its trust.
  assert.equal(hooks.PreCompact[1].hooks[0].command, '/usr/local/bin/my-hook');
  assert.equal(hooks.PostCompact.length, 1);
  assert.equal(hooks.PostCompact[0].hooks[0].command, box.hookDst);
  assert.match(result.stdout, /type \/hooks inside Codex once/);
});

test('an entry with an old hook path is fixed when everything else is current', {
  skip,
}, async () => {
  const box = await oldInstall('stale');
  assert.equal((await ensureHooks(box.codexDir)).code, 0);
  // Everything is current now. Point both entries at a path that is gone.
  const stale = '/old/home/.codex/subconscious-hook.sh';
  const text = await fs.readFile(box.hooksJson, 'utf8');
  await fs.writeFile(box.hooksJson, text.split(box.hookDst).join(stale));
  const result = await ensureHooks(box.codexDir);
  assert.equal(result.code, 0, result.stderr);
  const { hooks } = JSON.parse(await fs.readFile(box.hooksJson, 'utf8'));
  assert.equal(hooks.PreCompact[0].hooks[0].command, box.hookDst);
  assert.equal(hooks.PreCompact[1].hooks[0].command, '/usr/local/bin/my-hook');
  assert.equal(hooks.PostCompact[0].hooks[0].command, box.hookDst);
});

/**
 * A PATH whose grep, curl, cat and jq log their argv to `log`, then run the
 * real tool. Any of them that gets the key in argv shows it to ps.
 */
async function argvSpies(name) {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  const log = path.join(dir, 'argv.log');
  for (const tool of ['grep', 'curl', 'cat', 'jq']) {
    const real = TOOLS.map((bin) => path.join(bin, tool)).find((file) => {
      try {
        accessSync(file, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
    if (!real) continue;
    await fs.writeFile(
      path.join(dir, tool),
      `#!/bin/bash\nprintf '%s\\n' "${tool} $*" >>'${log}'\nexec '${real}' "$@"\n`,
      { mode: 0o755 },
    );
  }
  return { log, PATH: [dir, ...TOOLS].join(path.delimiter) };
}

test('the key never appears in the argv of a process', { skip }, async () => {
  const key = 'sk-argv-secret-0123';
  const spies = await argvSpies('argv-spies');
  const box = await oldInstall('argv');
  for (let i = 0; i < 2; i++) {
    const result = await ensureHooks(box.codexDir, {
      PATH: spies.PATH,
      API_KEY: key,
      GATEWAY_URL: gateway.url,
    });
    assert.equal(result.code, 0, result.stderr);
  }
  const before = hookPosts(gateway).length;
  const fired = await fireHook(path.dirname(box.codexDir), {
    PATH: spies.PATH,
    SUBCONSCIOUS_CODEX_LAUNCH: 'subc',
    SUBCONSCIOUS_API_KEY: key,
    SUBCONSCIOUS_GATEWAY_URL: gateway.url,
  });
  assert.equal(fired.code, 0, fired.stderr);
  const posts = hookPosts(gateway).slice(before);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].authorization, `Bearer ${key}`);
  const log = await fs.readFile(spies.log, 'utf8');
  assert.match(log, /^curl /m, 'the spies saw curl run');
  assert.ok(!log.includes(key), `key in argv:\n${log}`);
});

test('the hook sends nothing for a key it cannot quote', { skip }, async () => {
  const home = await hookHome('bad-key');
  const before = hookPosts(gateway).length;
  const result = await fireHook(home, {
    SUBCONSCIOUS_CODEX_LAUNCH: 'subc',
    SUBCONSCIOUS_API_KEY: 'sk-"injected',
    SUBCONSCIOUS_GATEWAY_URL: gateway.url,
  });
  assert.equal(result.code, 0);
  assert.match(result.stderr, /cannot send/);
  assert.equal(hookPosts(gateway).length, before);
});
