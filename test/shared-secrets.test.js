import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { setupCommand } from './helpers/agent-command.js';

// Every runbook used to write its own copy of the API key into a file inside the
// agent's directory, so one key existed in up to five places. These tests check
// that an install now leaves exactly one copy, that each agent directory holds a
// pointer to it, and that a hook still reaches the gateway through that pointer.

const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-secrets-test-'));

after(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

const exists = (file) =>
  fs.access(file).then(
    () => true,
    () => false,
  );

function runSyncOnce(command) {
  return spawnSync(command.file, command.args, {
    encoding: 'utf8',
    env: command.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// ── Shared credentials ────────────────────────────────────────────────────

test('every runbook writes one shared secrets file, and only one', async () => {
  const dir = path.join(testDir, 'shared');
  const home2 = path.join(dir, 'home');
  await fs.mkdir(path.join(home2, '.config', 'Code', 'User'), {
    recursive: true,
  });
  const env = (extra = {}) => ({
    ...process.env,
    HOME: home2,
    NO_COLOR: '1',
    GATEWAY_URL: 'https://gateway.example',
    API_KEY: 'sk-shared',
    MODEL: 'subconscious/glm-5.3-marathon',
    SUBCONSCIOUS_MODELS: 'subconscious/glm-5.3-marathon',
    ...extra,
  });

  for (const [id, args] of [
    ['codex', ['install']],
    ['cursor', ['install']],
    ['copilot', ['install']],
    ['pi', ['install']],
  ]) {
    const result = runSyncOnce(setupCommand(id, args, env()));
    assert.equal(result.status, 0, `${id}: ${result.stderr}`);
  }

  const secrets = path.join(home2, '.subconscious', 'secrets.env');
  const text = await fs.readFile(secrets, 'utf8');
  assert.match(text, /SUBCONSCIOUS_API_KEY='sk-shared'/);
  assert.equal((await fs.stat(secrets)).mode & 0o777, 0o600);
  assert.equal(
    (await fs.stat(path.join(home2, '.subconscious'))).mode & 0o777,
    0o700,
  );

  // The key now exists in exactly one place, and Pi's provider config is the
  // documented exception because its format cannot name a file.
  const files = [
    '.codex/subconscious-hooks.env',
    '.cursor/subconscious-hooks.env',
    '.copilot/subconscious-hooks.env',
    '.pi/agent/subconscious.env',
  ];
  for (const relative of files) {
    const body = await fs.readFile(path.join(home2, relative), 'utf8');
    assert.doesNotMatch(body, /sk-shared/, `${relative} still holds the key`);
    assert.match(body, /SUBCONSCIOUS_SECRETS_FILE=/);
    assert.match(body, /SUBCONSCIOUS_GATEWAY_URL='https:\/\/gateway\.example'/);
  }
  const piModels = await fs.readFile(
    path.join(home2, '.pi', 'agent', 'models.json'),
    'utf8',
  );
  assert.match(piModels, /sk-shared/);
});

test('a hook still reports to the gateway when only the pointer exists', async () => {
  const dir = path.join(testDir, 'hook-follows');
  const home2 = path.join(dir, 'home');
  await fs.mkdir(home2, { recursive: true });
  const secretDir = path.join(dir, 'secrets');
  const result = runSyncOnce(
    setupCommand('codex', ['install'], {
      ...process.env,
      HOME: home2,
      NO_COLOR: '1',
      GATEWAY_URL: 'https://gateway.example',
      API_KEY: 'sk-shared',
      MODEL: 'subconscious/glm-5.3-marathon',
      SUBCONSCIOUS_MODELS: 'subconscious/glm-5.3-marathon',
      CODEX_DIR: path.join(home2, '.codex'),
    }),
  );
  assert.equal(result.status, 0, result.stderr);

  const posted = path.join(dir, 'posted');
  const stubCurl = path.join(dir, 'curl');
  await fs.writeFile(
    stubCurl,
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${posted}"\n`,
    { mode: 0o755 },
  );
  await fs.mkdir(secretDir, { recursive: true });

  const run = spawnSync(
    'bash',
    [path.join(import.meta.dirname, '../bin/runbook/codex/hook.sh')],
    {
      encoding: 'utf8',
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        HOME: home2,
      },
      input: JSON.stringify({
        hook_event_name: 'PreCompact',
        session_id: 'sess-1',
        turn_id: 'turn-1',
      }),
    },
  );
  assert.equal(run.status, 0, run.stderr);

  // The bearer token came from the shared file the pointer named.
  const args = await fs.readFile(posted, 'utf8');
  assert.match(args, /Authorization: Bearer sk-shared/);
  assert.match(args, /https:\/\/gateway\.example\/v1\/agent-hooks/);
});

test('an older install with the key inline still works', async () => {
  const dir = path.join(testDir, 'legacy');
  const home2 = path.join(dir, 'home');
  await fs.mkdir(path.join(home2, '.cursor', 'hooks'), { recursive: true });
  const posted = path.join(dir, 'posted');
  const stubCurl = path.join(dir, 'curl');
  await fs.writeFile(
    stubCurl,
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${posted}"\n`,
    { mode: 0o755 },
  );
  await fs.writeFile(
    path.join(home2, '.cursor', 'subconscious-hooks.env'),
    "# older install\nexport SUBCONSCIOUS_GATEWAY_URL='https://legacy.example'\n" +
      "export SUBCONSCIOUS_API_KEY='sk-legacy'\n",
    { mode: 0o600 },
  );

  const run = spawnSync(
    'bash',
    [path.join(import.meta.dirname, '../bin/runbook/cursor/hook.sh')],
    {
      encoding: 'utf8',
      env: { PATH: `${dir}:${process.env.PATH}`, HOME: home2 },
      input: JSON.stringify({
        hook_event_name: 'beforeSubmitPrompt',
        conversation_id: 'c1',
        prompt: 'hello',
      }),
    },
  );
  assert.equal(run.status, 0, run.stderr);
  const args = await fs.readFile(posted, 'utf8');
  assert.match(args, /Authorization: Bearer sk-legacy/);
  assert.match(args, /https:\/\/legacy\.example\/v1\/agent-hooks/);
});

test('an inline key wins over the shared file', async () => {
  const dir = path.join(testDir, 'precedence');
  const home2 = path.join(dir, 'home');
  await fs.mkdir(path.join(home2, '.cursor', 'hooks'), { recursive: true });
  const posted = path.join(dir, 'posted');
  const stubCurl = path.join(dir, 'curl');
  await fs.writeFile(
    stubCurl,
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${posted}"\n`,
    { mode: 0o755 },
  );
  await fs.mkdir(path.join(dir, 'shared'), { recursive: true });
  await fs.writeFile(
    path.join(dir, 'shared', 'secrets.env'),
    "export SUBCONSCIOUS_GATEWAY_URL='https://shared.example'\n" +
      "export SUBCONSCIOUS_API_KEY='sk-shared'\n",
  );
  await fs.writeFile(
    path.join(home2, '.cursor', 'subconscious-hooks.env'),
    "export SUBCONSCIOUS_GATEWAY_URL='https://inline.example'\n" +
      "export SUBCONSCIOUS_SECRETS_FILE='" +
      path.join(dir, 'shared', 'secrets.env') +
      "'\nexport SUBCONSCIOUS_API_KEY='sk-inline'\n",
    { mode: 0o600 },
  );

  const run = spawnSync(
    'bash',
    [path.join(import.meta.dirname, '../bin/runbook/cursor/hook.sh')],
    {
      encoding: 'utf8',
      env: { PATH: `${dir}:${process.env.PATH}`, HOME: home2 },
      input: JSON.stringify({
        hook_event_name: 'beforeSubmitPrompt',
        conversation_id: 'c1',
        prompt: 'hello',
      }),
    },
  );
  assert.equal(run.status, 0, run.stderr);
  const args = await fs.readFile(posted, 'utf8');
  assert.match(args, /Authorization: Bearer sk-inline/);
  assert.doesNotMatch(args, /sk-shared/);
});

test('SUBCONSCIOUS_SECRETS_FILE chooses where the shared file goes', async () => {
  const dir = path.join(testDir, 'override');
  const home2 = path.join(dir, 'home');
  await fs.mkdir(home2, { recursive: true });
  const custom = path.join(dir, 'vault', 'subc.env');
  const result = runSyncOnce(
    setupCommand('codex', ['install'], {
      ...process.env,
      HOME: home2,
      NO_COLOR: '1',
      GATEWAY_URL: 'https://gateway.example',
      API_KEY: 'sk-custom',
      MODEL: 'subconscious/glm-5.3-marathon',
      SUBCONSCIOUS_MODELS: 'subconscious/glm-5.3-marathon',
      CODEX_DIR: path.join(home2, '.codex'),
      SUBCONSCIOUS_SECRETS_FILE: custom,
    }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    await fs.readFile(custom, 'utf8'),
    /SUBCONSCIOUS_API_KEY='sk-custom'/,
  );
  const pointer = await fs.readFile(
    path.join(home2, '.codex', 'subconscious-hooks.env'),
    'utf8',
  );
  assert.ok(pointer.includes(custom), pointer);
});
