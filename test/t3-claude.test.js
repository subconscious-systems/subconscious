import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { mergeClaudeSettings, pinClaudeModel } from '../bin/t3-launch.js';
import {
  fakeGateway,
  GOOD_KEY,
  MODELS,
  readRecords,
  run,
  subc,
  t3Sandbox,
} from './helpers/t3-sandbox.js';

const skip = process.platform === 'win32';

let gateway;
let installed;
const boxes = [];

async function box(options = {}) {
  const sandbox = await t3Sandbox({ gateway, withClaude: true, ...options });
  boxes.push(sandbox);
  return sandbox;
}

const install = (sandbox) =>
  subc(sandbox, ['t3', 'install', '--provider', 'claude']);

function launch(sandbox, args, { log, env = {}, input } = {}) {
  return run(sandbox.claudeLauncher, args, {
    env: sandbox.claudeT3Env({ FAKE_CLAUDE_LOG: log, ...env }),
    input,
  });
}

let logs = 0;
const logFile = (sandbox) => path.join(sandbox.root, `claude-${++logs}.log`);

// The argv T3 Code 0.1.11 passes for its provider probe.
const PROBE_ARGS = [
  '--output-format',
  'stream-json',
  '--verbose',
  '--input-format',
  'stream-json',
  '--setting-sources=user,project,local',
  '--strict-mcp-config',
  '--no-session-persistence',
  '--settings',
  '{"disableAllHooks":true}',
];

// T3 Code's text generation argv: --settings sits before an empty word.
const textGenerationArgs = (model) => [
  '-p',
  '--output-format',
  'json',
  '--model',
  model,
  '--settings',
  '{"disableAllHooks":true}',
  '--tools',
  '',
  '--permission-mode',
  'dontAsk',
];

/** The `--settings` values in an argv, parsed. */
function settingsOf(args) {
  const values = [];
  for (let i = 0; i < args.length; i++)
    if (args[i] === '--settings') values.push(JSON.parse(args[++i]));
  return values;
}

/** The argv with the one `--settings` value replaced by a marker. */
const withoutSettingsValue = (args) =>
  args.map((arg, i) => (args[i - 1] === '--settings' ? '<settings>' : arg));

/** The picker and the pinned gateway, with no key in the argv. */
function assertSubcSettings(settings) {
  assert.deepEqual(settings.availableModels, MODELS);
  assert.equal(settings.modelPicker.replaceBuiltInOptions, true);
  assert.equal(settings.env?.ANTHROPIC_BASE_URL, gateway.url);
  assert.ok(!JSON.stringify(settings).includes(GOOD_KEY), 'no key in argv');
}

before(async () => {
  if (skip) return;
  gateway = await fakeGateway();
  installed = await box();
  const result = await install(installed);
  assert.equal(result.code, 0, result.stderr);
});

after(async () => {
  for (const sandbox of boxes) await sandbox.cleanup();
  await gateway?.close();
});

test('a probe launch routes Claude Code to the gateway with the shared ~/.claude', {
  skip,
}, async () => {
  const sandbox = installed;
  const log = logFile(sandbox);
  const result = await launch(sandbox, PROBE_ARGS, { log });
  assert.equal(result.code, 0, result.stderr);
  const dir = path.join(sandbox.root, 'instance claude home');
  const own = await launch(sandbox, PROBE_ARGS, {
    log,
    env: { CLAUDE_CONFIG_DIR: dir },
  });
  assert.equal(own.code, 0, own.stderr);
  const [record, ownRecord] = await readRecords(log);

  // T3 Code's args in order, with the picker merged into its own settings.
  assert.deepEqual(withoutSettingsValue(record.args), [
    ...PROBE_ARGS.slice(0, -1),
    '<settings>',
  ]);
  const [settings, ...more] = settingsOf(record.args);
  assert.equal(more.length, 0, 'exactly one --settings');
  assert.equal(settings.disableAllHooks, true);
  assertSubcSettings(settings);

  const { env } = record;
  assert.equal(env.ANTHROPIC_BASE_URL, gateway.url);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, GOOD_KEY);
  assert.equal(env.ANTHROPIC_MODEL, MODELS[0]);
  // No CLAUDE_CONFIG_DIR and the user's HOME: Claude Code reads ~/.claude.
  // One that T3 Code sets is kept.
  assert.equal(env.CLAUDE_CONFIG_DIR, undefined);
  assert.equal(env.HOME, sandbox.home);
  assert.equal(ownRecord.env.CLAUDE_CONFIG_DIR, dir);
  // T3 Code's protocol variables reach Claude Code unchanged.
  for (const name of [
    'CLAUDE_CODE_ENTRYPOINT',
    'CLAUDE_AGENT_SDK_VERSION',
    'T3CODE_THREAD_ID',
  ])
    assert.equal(env[name], sandbox.claudeT3Env()[name], name);
});

test('text generation keeps its argv order and its stdin', {
  skip,
}, async () => {
  const sandbox = installed;
  const log = logFile(sandbox);
  const args = textGenerationArgs(MODELS[1]);
  const result = await launch(sandbox, args, {
    log,
    env: { FAKE_CLAUDE_READ_STDIN: '1' },
    input: 'Write a title for this thread.',
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '', 'no fallback line for a catalog model');
  const [record] = await readRecords(log);
  assert.equal(record.stdin, 'Write a title for this thread.');
  assert.deepEqual(withoutSettingsValue(record.args), [
    ...args.slice(0, 6),
    '<settings>',
    ...args.slice(7),
  ]);
  assertSubcSettings(settingsOf(record.args)[0]);
});

test('a --settings value cannot move the gateway, and its other keys stay', {
  skip,
}, async () => {
  const sandbox = installed;
  const evil = 'http://127.0.0.1:9/evil';
  const inline = JSON.stringify({
    inline: true,
    availableModels: ['claude-opus-5-5'],
    env: { KEEP: 'x', ANTHROPIC_BASE_URL: evil },
  });
  for (const args of [
    ['-p', '--settings', '{"first":true}', `--settings=${inline}`],
    ['--input-format', 'stream-json'],
  ]) {
    const log = logFile(sandbox);
    const result = await launch(sandbox, args, { log });
    assert.equal(result.code, 0, result.stderr);
    const [record] = await readRecords(log);
    // Claude Code uses the last --settings value, and the picker wins over a
    // list that T3 Code or the user set.
    const settings = settingsOf(record.args).at(-1);
    assertSubcSettings(settings);
    if (args.length > 2) assert.equal(settings.env.KEEP, 'x');
  }
});

test('a --settings value that is not a JSON object stops the launch and is never shown', {
  skip,
}, async () => {
  const sandbox = installed;
  const log = logFile(sandbox);
  for (const value of [
    '{"token":"SECRET-INLINE"',
    '["SECRET-ARRAY"]',
    'SECRET-settings.json',
  ]) {
    const result = await launch(sandbox, ['-p', '--settings', value], { log });
    assert.equal(result.code, 1, value);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /--settings value that is not a JSON object/);
    assert.ok(!result.stderr.includes('SECRET'), value);
  }
  assert.deepEqual(await readRecords(log), []);
});

test('a model outside the catalog runs as the profile model, with one stderr line', {
  skip,
}, async () => {
  const sandbox = installed;
  const log = logFile(sandbox);
  for (const args of [
    [...PROBE_ARGS, '--model=claude-sonnet-5-5'],
    textGenerationArgs('claude-haiku-4-5'),
  ]) {
    const result = await launch(sandbox, args, { log });
    assert.equal(result.code, 0, result.stderr);
    assert.match(
      result.stderr,
      /^subc-t3-claude: claude-\S+ is not in the Subconscious model catalog for this key, so Claude Code uses subconscious\/sandbox-a instead\.\n$/,
    );
  }
  // The --model flag wins over ANTHROPIC_MODEL in Claude Code, so the argv
  // itself names the profile model.
  const [session, text] = await readRecords(log);
  assert.ok(session.args.includes(`--model=${MODELS[0]}`));
  assert.equal(text.args[text.args.indexOf('--model') + 1], MODELS[0]);
  assert.ok(!JSON.stringify([session.args, text.args]).includes('claude-'));
});

test('an update that replaces the versioned file keeps the launcher working', {
  skip,
}, async () => {
  const sandbox = await box();
  assert.equal((await install(sandbox)).code, 0);
  const versions = path.dirname(await fs.realpath(sandbox.claudeBin));
  const next = path.join(versions, '2.1.330');
  await fs.copyFile(await fs.realpath(sandbox.claudeBin), next);
  await fs.rm(sandbox.claudeBin);
  await fs.rm(path.join(versions, '2.1.326'));
  await fs.symlink(next, sandbox.claudeBin);
  const log = logFile(sandbox);
  const result = await launch(sandbox, PROBE_ARGS, { log });
  assert.equal(result.code, 0, result.stderr);
  assert.equal((await readRecords(log)).length, 1);
});

test('install warns when T3 Code is too old to list the Subconscious models', {
  skip,
}, async () => {
  const sandbox = await box();
  const version = path.join(
    sandbox.t3Home,
    'userdata',
    'desktop-last-started-version',
  );
  await fs.writeFile(version, '0.1.7\n');
  const old = await install(sandbox);
  assert.equal(old.code, 0, old.stderr);
  assert.match(old.stdout, /T3 Code 0\.1\.7 shows only its built-in models/);
  await fs.writeFile(version, '0.1.11\n');
  const current = await install(sandbox);
  assert.equal(current.code, 0, current.stderr);
  assert.doesNotMatch(current.stdout, /shows only its built-in models/);
});

test('pinClaudeModel and mergeClaudeSettings leave words after -- alone', () => {
  assert.deepEqual(
    pinClaudeModel(
      ['--model', 'x', '--model=y', '--', '--model', 'z'],
      ['y'],
      'p',
    ),
    {
      args: ['--model', 'p', '--model=y', '--', '--model', 'z'],
      replaced: 'x',
    },
  );
  assert.deepEqual(
    mergeClaudeSettings(['-p', '--', '--settings', 'x'], { a: 1 }),
    ['-p', '--settings', '{"a":1}', '--', '--settings', 'x'],
  );
});
