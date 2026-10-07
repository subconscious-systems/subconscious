import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { agentById } from '../bin/agent-data.js';
import { resolveAgentEnv, resolveInputs } from '../bin/agent-launch.js';
import {
  claudeVscodeEnvironment,
  claudeVscodeMain,
  parseTopMembers,
  SETTINGS_DELETE,
  spliceSettingsDocument,
  VSCODE_APPS,
} from '../bin/claude-vscode.js';
import { run, setupCommand } from './helpers/agent-command.js';

const ENV_VARS_KEY = 'claudeCode.environmentVariables';
const PROMPT_KEY = 'claudeCode.disableLoginPrompt';

// ── JSONC splicing ──────────────────────────────────────────────────────────

test('splice inserts the two owned keys and preserves comments and other members', () => {
  const doc = `{
  // my editor settings
  "editor.fontSize": 14, // keep this
  "workbench.colorTheme": "Dark+"
}`;
  const out = spliceSettingsDocument(doc, {
    [ENV_VARS_KEY]: [{ name: 'ANTHROPIC_BASE_URL', value: 'https://gw' }],
    [PROMPT_KEY]: true,
  });
  const { members } = parseTopMembers(out);
  assert.deepEqual(
    members.map((m) => m.key),
    ['editor.fontSize', 'workbench.colorTheme', ENV_VARS_KEY, PROMPT_KEY],
  );
  assert.match(out, /\/\/ my editor settings/);
  assert.match(out, /\/\/ keep this/);
  assert.equal(out.includes('"editor.fontSize": 14'), true);
  // Idempotent: a second identical splice changes nothing.
  assert.equal(
    spliceSettingsDocument(out, {
      [ENV_VARS_KEY]: [{ name: 'ANTHROPIC_BASE_URL', value: 'https://gw' }],
      [PROMPT_KEY]: true,
    }),
    out,
  );
});

test('splice writes into empty and single-line documents', () => {
  const empty = spliceSettingsDocument('{\n}', { a: 1 });
  assert.deepEqual(
    parseTopMembers(empty).members.map((m) => m.value),
    [1],
  );
  const single = spliceSettingsDocument('{"a": 1}', { b: [1, 2] });
  const parsed = parseTopMembers(single);
  assert.deepEqual(
    Object.fromEntries(parsed.members.map((m) => [m.key, m.value])),
    { a: 1, b: [1, 2] },
  );
});

test('splice replaces a value without touching its other formatting', () => {
  const doc = '{\n  "x": { "deep": ["old"] },\n  "y": 2\n}';
  const out = spliceSettingsDocument(doc, {
    x: { deep: [1, '//not'] },
  });
  assert.match(out, /"y": 2/);
  const { members } = parseTopMembers(out);
  assert.deepEqual(members.find((m) => m.key === 'x').value, {
    deep: [1, '//not'],
  });
});

test('splice deletes members and keeps commas balanced', () => {
  const first = spliceSettingsDocument(
    '{\n  "first": 1,\n  "second": 2,\n  "third": 3\n}',
    { first: SETTINGS_DELETE, third: SETTINGS_DELETE },
  );
  const { members } = parseTopMembers(first);
  assert.deepEqual(
    members.map((m) => [m.key, m.value]),
    [['second', 2]],
  );
  const only = spliceSettingsDocument('{\n  "only": 1\n}', {
    only: SETTINGS_DELETE,
  });
  assert.deepEqual(parseTopMembers(only).members, []);
});

test('install then uninstall restores the document byte for byte', () => {
  const docs = [
    `{\n  // header\n  "editor.fontSize": 14, // inline\n  "workbench.colorTheme": "Dark+"\n}`,
    '{\n}',
    '{"a": 1}',
    '{\r\n  "a": 1,\r\n  "b": ["c"]\r\n}',
    '{\n  "a": 1,\n\n  "b": 2\n}',
  ];
  for (const doc of docs) {
    const installed = spliceSettingsDocument(doc, {
      [ENV_VARS_KEY]: [{ name: 'N', value: 'V' }],
      [PROMPT_KEY]: true,
    });
    const restored = spliceSettingsDocument(installed, {
      [ENV_VARS_KEY]: SETTINGS_DELETE,
      [PROMPT_KEY]: SETTINGS_DELETE,
    });
    assert.equal(restored, doc, doc);
  }
});

test('uninstalling after a trailing-comment install leaves a valid document with comments intact', () => {
  const doc = `{\n  "editor.fontSize": 14 // keep this on my line\n}`;
  const installed = spliceSettingsDocument(doc, {
    [ENV_VARS_KEY]: [{ name: 'N', value: 'V' }],
    [PROMPT_KEY]: true,
  });
  const restored = spliceSettingsDocument(installed, {
    [ENV_VARS_KEY]: SETTINGS_DELETE,
    [PROMPT_KEY]: SETTINGS_DELETE,
  });
  // Byte-exactness is impossible here (subc anchored a comma before the
  // comment during install), but the result must parse and keep the comment
  // and every user value.
  const { members } = parseTopMembers(restored);
  assert.deepEqual(
    members.map((m) => [m.key, m.value]),
    [['editor.fontSize', 14]],
  );
  assert.match(restored, /keep this on my line/);
});

test('splice refuses documents that are not one JSON object', () => {
  assert.throws(() => parseTopMembers('[]'), /must hold a single JSON object/);
  assert.throws(() => parseTopMembers('{ "a": 1, "b" }'), /expected ':'/);
  assert.throws(
    () => parseTopMembers('[1, 2]'),
    /must hold a single JSON object/,
  );
});

test('commas inside strings and comments never confuse the splicer', () => {
  const doc = `{\n  "a": "with, comma",\n  "u": "https://x,co", // a, b\n  "c": 1\n}`;
  const out = spliceSettingsDocument(doc, { b: 2 });
  const { members } = parseTopMembers(out);
  assert.deepEqual(
    members.map((m) => m.key),
    ['a', 'u', 'c', 'b'],
  );
  assert.match(out, /"with, comma"/);
  assert.match(out, /https:\/\/x,co/);
});

// ── env assembly ─────────────────────────────────────────────────────────────

function resolvedTestEnv(overrides = {}) {
  const agent = agentById('claude-code');
  const env = resolveAgentEnv(
    agent,
    resolveInputs(
      agent,
      {
        GATEWAY_URL: 'https://gateway.example',
        API_KEY: 'sk-test',
        MODEL: 'subconscious/glm-5.3-marathon',
        SUBCONSCIOUS_MODELS: 'subconscious/glm-5.3-marathon',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'subconscious/glm-5.3-marathon',
        ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: 'subconscious/glm-5.3-marathon',
        ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION: 'Subconscious model',
        SUBC_CONFIG_DIR: '/tmp/subc-test-config',
        ...overrides,
      },
      {},
      { strict: false },
    ),
  );
  return { agent, env };
}

test('claudeVscodeEnvironment carries the launch env without credentials or PATH', () => {
  const { agent, env } = resolvedTestEnv();
  const entries = claudeVscodeEnvironment(agent, env);
  const names = entries.map((entry) => entry.name);
  assert.equal(names.includes('ANTHROPIC_BASE_URL'), true);
  assert.equal(names.includes('ANTHROPIC_AUTH_TOKEN'), true);
  assert.equal(names.includes('CLAUDE_CONFIG_DIR'), true);
  assert.equal(names.includes('ANTHROPIC_DEFAULT_OPUS_MODEL'), true);
  assert.equal(names.includes('API_KEY'), false);
  assert.equal(names.includes('CLAUDE_CODE_API_KEY'), false);
  assert.equal(names.includes('PATH'), false);
  assert.equal(names.includes('GATEWAY_URL'), false);
  // Every value is a string and no entry is empty.
  for (const entry of entries) {
    assert.equal(typeof entry.value, 'string');
    assert.notEqual(entry.value, '');
    assert.notEqual(entry.value, undefined);
  }
  // No duplicates.
  assert.equal(new Set(names).size, names.length);
  const byName = Object.fromEntries(entries.map((e) => [e.name, e.value]));
  assert.equal(byName.ANTHROPIC_BASE_URL, 'https://gateway.example');
  assert.equal(byName.ANTHROPIC_AUTH_TOKEN, 'sk-test');
  assert.equal(byName.CLAUDE_CONFIG_DIR, '/tmp/subc-test-config/claude-code');
});

test('VSCODE_APPS lists the supported editors in a stable order', () => {
  assert.deepEqual(VSCODE_APPS, [
    'Code',
    'Code - Insiders',
    'VSCodium',
    'Cursor',
  ]);
});

// ── End to end through the runbook script ───────────────────────────────────

function appDir(home, app = 'Code') {
  return path.join(
    home,
    ...(process.platform === 'darwin'
      ? ['Library', 'Application Support', app, 'User']
      : ['.config', app, 'User']),
  );
}

function runVscode(home, action, overrides = {}) {
  return run(
    setupCommand('claude-code', ['vscode', ...action], {
      ...process.env,
      HOME: home,
      SUBC_CONFIG_DIR: path.join(home, 'subc'),
      GATEWAY_URL: 'https://gateway.example',
      API_KEY: 'sk-test',
      MODEL: 'subconscious/glm-5.3-marathon',
      SUBCONSCIOUS_MODELS:
        'subconscious/glm-5.3-marathon\nsubconscious/tim-qwen3.6-27b',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'subconscious/glm-5.3-marathon',
      ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: 'subconscious/glm-5.3-marathon',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'subconscious/tim-qwen3.6-27b',
      ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: 'subconscious/tim-qwen3.6-27b',
      ...overrides,
    }),
  );
}

test('vscode install writes the env, snaps, and uninstall restores byte for byte', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-vscode-e2e-'));
  try {
    const code = appDir(home, 'Code');
    const cursor = appDir(home, 'Cursor');
    await fs.mkdir(code, { recursive: true });
    await fs.mkdir(cursor, { recursive: true });
    const original = `{
  // keep me
  "editor.fontSize": 14
}`;
    for (const dir of [code, cursor]) {
      await fs.writeFile(path.join(dir, 'settings.json'), original);
    }

    const result = await runVscode(home, ['install']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Code:/);
    assert.match(result.stdout, /Cursor:/);
    assert.match(result.stdout, /plain text/);

    for (const dir of [code, cursor]) {
      const written = await fs.readFile(
        path.join(dir, 'settings.json'),
        'utf8',
      );
      const { members } = parseTopMembers(written);
      const envMember = members.find((m) => m.key === ENV_VARS_KEY);
      assert.ok(Array.isArray(envMember?.value) && envMember.value.length > 5);
      assert.equal(members.find((m) => m.key === PROMPT_KEY)?.value, true);
      assert.match(written, /\/\/ keep me/);
      assert.equal(written.includes('"editor.fontSize": 14'), true);
    }

    const snapshotPath = path.join(home, 'subc', 'claude-vscode-snapshot.json');
    const snapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf8'));
    assert.deepEqual(Object.keys(snapshot.apps).sort(), ['Code', 'Cursor']);
    const stat = await fs.stat(snapshotPath);
    assert.equal(stat.mode & 0o777, 0o600);

    const removed = await runVscode(home, ['uninstall']);
    assert.equal(removed.code, 0, removed.stderr);
    for (const dir of [code, cursor]) {
      const restored = await fs.readFile(
        path.join(dir, 'settings.json'),
        'utf8',
      );
      assert.equal(restored, original);
    }
    // The snapshot record is gone after a full uninstall.
    assert.equal(await fs.stat(snapshotPath).catch(() => null), null);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('vscode status and help run without an api key or profile', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-vscode-status-'));
  try {
    const codeEnvDir = appDir(home, 'Code');
    await fs.mkdir(codeEnvDir, { recursive: true });
    await fs.writeFile(path.join(codeEnvDir, 'settings.json'), '{\n}');
    const statusEnv = {
      ...process.env,
      HOME: home,
      SUBC_CONFIG_DIR: path.join(home, 'subc'),
    };
    delete statusEnv.API_KEY;
    const status = await run(
      setupCommand('claude-code', ['vscode', 'status'], statusEnv),
    );
    assert.equal(status.code, 0, status.stderr);
    assert.match(status.stdout, /Code: not configured/);
    assert.match(status.stdout, /Code - Insiders: not detected/);

    const help = await run(
      setupCommand('claude-code', ['vscode', 'help'], statusEnv),
    );
    assert.equal(help.code, 0, help.stderr);
    assert.match(help.stdout, /subc claude vscode install/);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('uninstall without a snapshot record refuses unless forced', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-vscode-nosnap-'));
  try {
    const codeDir = appDir(home, 'Code');
    await fs.mkdir(codeDir, { recursive: true });
    await fs.writeFile(
      path.join(codeDir, 'settings.json'),
      `{\n  ${JSON.stringify(ENV_VARS_KEY)}: [{"name":"N","value":"V"}],\n  ${JSON.stringify(PROMPT_KEY)}: true,\n  "mine": 1\n}`,
    );
    const refused = await runVscode(home, ['uninstall', '--app', 'Code']);
    assert.notEqual(refused.code, 0);
    assert.match(refused.stderr, /No snapshot record/);
    // An uninstall with no --app and no records is a clean no-op, not an error.
    const noop = await runVscode(home, ['uninstall']);
    assert.equal(noop.code, 0, noop.stderr);
    assert.match(noop.stdout, /nothing to restore/);
    // The file is untouched.
    assert.match(
      await fs.readFile(path.join(codeDir, 'settings.json'), 'utf8'),
      /"mine": 1/,
    );

    const forced = await runVscode(home, ['uninstall', '--force']);
    assert.equal(forced.code, 0, forced.stderr);
    const stripped = await fs.readFile(
      path.join(codeDir, 'settings.json'),
      'utf8',
    );
    assert.equal(stripped.includes(ENV_VARS_KEY), false);
    assert.equal(stripped.includes(PROMPT_KEY), false);
    assert.match(stripped, /"mine": 1/);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('vscode uninstall --app Cursor touches only Cursor', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-vscode-app-'));
  try {
    for (const app of ['Code', 'Cursor']) {
      await fs.mkdir(appDir(home, app), { recursive: true });
      await fs.writeFile(
        path.join(appDir(home, app), 'settings.json'),
        '{\n  "mine": 1\n}',
      );
    }
    for (const app of ['Code', 'Cursor']) {
      const r = await runVscode(home, ['install', '--app', app]);
      assert.equal(r.code, 0, r.stderr);
    }
    const beforeCode = await fs.readFile(
      path.join(appDir(home, 'Code'), 'settings.json'),
      'utf8',
    );
    const removed = await runVscode(home, ['uninstall', '--app', 'Cursor']);
    assert.equal(removed.code, 0, removed.stderr);
    assert.equal(
      await fs.readFile(
        path.join(appDir(home, 'Code'), 'settings.json'),
        'utf8',
      ),
      beforeCode,
    );
    const cursorRestored = await fs.readFile(
      path.join(appDir(home, 'Cursor'), 'settings.json'),
      'utf8',
    );
    assert.equal(cursorRestored, '{\n  "mine": 1\n}');
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('vscode install refuses a malformed settings.json and touches nothing', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-vscode-broken-'));
  try {
    const codeDir = appDir(home, 'Code');
    await fs.mkdir(codeDir, { recursive: true });
    const broken = '{\n  "a": 1,,\n';
    await fs.writeFile(path.join(codeDir, 'settings.json'), broken);
    const result = await runVscode(home, ['install']);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /cannot be parsed/);
    assert.equal(
      await fs.readFile(path.join(codeDir, 'settings.json'), 'utf8'),
      broken,
    );
    // No snapshot for a failed install.
    assert.equal(
      await fs
        .stat(path.join(home, 'subc', 'claude-vscode-snapshot.json'))
        .catch(() => null),
      null,
    );
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('install creates settings.json when the editor has none, and uninstall removes it again', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-vscode-create-'));
  try {
    const codeDir = appDir(home, 'Code');
    await fs.mkdir(codeDir, { recursive: true });
    const first = await runVscode(home, ['install']);
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /created settings\.json/);
    const created = await fs.readFile(
      path.join(codeDir, 'settings.json'),
      'utf8',
    );
    assert.ok(parseTopMembers(created).members.length >= 2);
    const second = await runVscode(home, ['install']);
    assert.equal(second.code, 0, second.stderr);
    assert.equal(
      await fs.readFile(path.join(codeDir, 'settings.json'), 'utf8'),
      created,
    );

    const removed = await runVscode(home, ['uninstall']);
    assert.equal(removed.code, 0, removed.stderr);
    assert.equal(
      await fs.stat(path.join(codeDir, 'settings.json')).catch(() => null),
      null,
    );
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('claudeVscodeMain installs and restores through the same entry Windows uses', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-vscode-main-'));
  try {
    const codeDir = appDir(home, 'Code');
    await fs.mkdir(codeDir, { recursive: true });
    await fs.writeFile(
      path.join(codeDir, 'settings.json'),
      '{\n  "mine": 1\n}',
    );
    const log = () => {};
    const env = {
      ...process.env,
      HOME: home,
      SUBC_CONFIG_DIR: path.join(home, 'subc'),
      GATEWAY_URL: 'https://gateway.example',
      API_KEY: 'sk-test',
      MODEL: 'subconscious/glm-5.3-marathon',
      SUBCONSCIOUS_MODELS: 'subconscious/glm-5.3-marathon',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'subconscious/glm-5.3-marathon',
    };
    await claudeVscodeMain(['vscode', 'install', '--app', 'Code'], {
      env,
      home,
      configDir: path.join(home, 'subc'),
      log,
    });
    const written = await fs.readFile(
      path.join(codeDir, 'settings.json'),
      'utf8',
    );
    assert.ok(written.includes(ENV_VARS_KEY));

    await claudeVscodeMain(['vscode', 'uninstall', '--app', 'Code'], {
      home,
      configDir: path.join(home, 'subc'),
      log,
    });
    assert.equal(
      await fs.readFile(path.join(codeDir, 'settings.json'), 'utf8'),
      '{\n  "mine": 1\n}',
    );
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
