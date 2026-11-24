import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { mergeClaudeSettings, pinClaudeModel } from '../bin/t3-launch.js';
import {
  BUILT_IN_CLAUDE_MODELS,
  fakeGateway,
  GOOD_KEY,
  MODELS,
  readRecords,
  run,
  subc,
  t3Sandbox,
  writeT3ModelCache,
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

function launch(sandbox, args, { log, env = {}, input, cwd } = {}) {
  return run(sandbox.claudeLauncher, args, {
    env: sandbox.claudeT3Env({ FAKE_CLAUDE_LOG: log, ...env }),
    input,
    cwd,
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

test('a settings file or value cannot move the gateway, and its other keys stay', {
  skip,
}, async () => {
  const sandbox = installed;
  const cwd = path.join(sandbox.root, 'project dir');
  await fs.mkdir(cwd, { recursive: true });
  const evil = 'http://127.0.0.1:9/evil';
  await fs.writeFile(
    path.join(cwd, 'settings.json'),
    JSON.stringify({ fromFile: true, env: { ANTHROPIC_BASE_URL: evil } }),
  );
  const inline = JSON.stringify({
    inline: true,
    availableModels: ['claude-opus-5-5'],
    env: { KEEP: 'x', ANTHROPIC_BASE_URL: evil },
  });
  const forms = {
    file: ['-p', '--settings', 'settings.json'],
    // Earlier flags are dropped, and the last one is merged.
    last: ['-p', '--settings', '{"first":true}', `--settings=${inline}`],
    none: ['--input-format', 'stream-json'],
  };
  for (const [form, args] of Object.entries(forms)) {
    const log = logFile(sandbox);
    const result = await launch(sandbox, args, { log, cwd });
    assert.equal(result.code, 0, `${form}: ${result.stderr}`);
    const [record] = await readRecords(log);
    const [settings, ...more] = settingsOf(record.args);
    assert.equal(more.length, 0, form);
    // The picker wins over a list that T3 Code or the user set.
    assertSubcSettings(settings);
    if (form === 'file') assert.equal(settings.fromFile, true);
    if (form === 'last') {
      assert.equal(settings.inline, true);
      assert.equal(settings.first, undefined);
      assert.equal(settings.env.KEEP, 'x');
    }
  }
});

test('a malformed --settings value stops the launch and is never shown', {
  skip,
}, async () => {
  const sandbox = installed;
  const cwd = path.join(sandbox.root, 'malformed dir');
  await fs.mkdir(cwd, { recursive: true });
  await fs.writeFile(path.join(cwd, 'bad.json'), 'SECRET-IN-FILE not json');
  const log = logFile(sandbox);
  for (const value of [
    '{"token":"SECRET-INLINE"',
    '["SECRET-ARRAY"]',
    'bad.json',
    'missing-SECRET.json',
  ]) {
    const result = await launch(sandbox, ['-p', '--settings', value], {
      log,
      cwd,
    });
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

// The hide list: providerModelPreferences["subconscious-claude"].

const BUILT_INS = BUILT_IN_CLAUDE_MODELS.map(([slug]) => slug);
const OURS = 'subconscious-claude';
const HINT =
  'In T3 Code, hide or reorder any model once, then run subc t3 install again.';
const tabbed = (value) => `${JSON.stringify(value, null, '\t')}\n`;
const readSettings = async (sandbox) =>
  JSON.parse(await fs.readFile(sandbox.settingsPath, 'utf8'));

const settingsWith = (preferences) => ({
  favorites: [{ provider: 'claudeAgent', model: 'claude-opus-5-5' }],
  ...(preferences === undefined
    ? {}
    : { providerModelPreferences: preferences }),
  providerInstances: { claudeAgent: { driver: 'claudeAgent', enabled: true } },
});

test('install writes only the hide list key, and uninstall removes it', {
  skip,
}, async () => {
  const text = tabbed(
    settingsWith({
      claudeAgent: { hiddenModels: ['claude-haiku-4-5'], modelOrder: [] },
    }),
  );
  const sandbox = await box({ settings: text });
  await writeT3ModelCache(sandbox, { instanceId: 'claudeAgent' });
  const result = await install(sandbox);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Hide list\s+hid 14 models that are not in/);
  const settings = await readSettings(sandbox);
  assert.deepEqual(settings.providerModelPreferences[OURS], {
    hiddenModels: BUILT_INS,
    modelOrder: [],
  });
  // Without subc's entry and its hide list, the file is the original, byte
  // for byte.
  const rest = structuredClone(settings);
  delete rest.providerInstances[OURS];
  delete rest.providerModelPreferences[OURS];
  assert.equal(tabbed(rest), text);

  // A second install uses subc's own cache and keeps the user's order.
  settings.providerModelPreferences[OURS].modelOrder = [MODELS[1]];
  await fs.writeFile(sandbox.settingsPath, tabbed(settings));
  await writeT3ModelCache(sandbox, {
    instanceId: OURS,
    builtIns: [...BUILT_INS, 'claude-opus-6'],
    reported: MODELS,
  });
  assert.equal((await install(sandbox)).code, 0);
  assert.deepEqual(
    (await readSettings(sandbox)).providerModelPreferences[OURS],
    {
      hiddenModels: [...BUILT_INS, 'claude-opus-6'],
      modelOrder: [MODELS[1]],
    },
  );

  // Uninstall removes the hide list even when the entry is already gone.
  const left = await readSettings(sandbox);
  delete left.providerInstances[OURS];
  await fs.writeFile(sandbox.settingsPath, tabbed(left));
  const removed = await subc(sandbox, ['t3', 'uninstall']);
  assert.equal(removed.code, 0, removed.stderr);
  assert.match(removed.stdout, /Removed the subconscious-claude hide list/);
  assert.equal(await fs.readFile(sandbox.settingsPath, 'utf8'), text);
});

test('install skips the hide list without preferences or a cache, and still installs', {
  skip,
}, async () => {
  for (const [preferences, cache, message] of [
    [null, true, HINT],
    [undefined, true, HINT],
    [{}, false, 'T3 Code wrote no model cache for subconscious-claude'],
  ]) {
    const sandbox = await box({ settings: tabbed(settingsWith(preferences)) });
    if (cache) await writeT3ModelCache(sandbox, { instanceId: 'claudeAgent' });
    const result = await install(sandbox);
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes(message), result.stdout);
    assert.match(result.stdout, /Subconscious \(Claude\) is ready/);
    const settings = await readSettings(sandbox);
    assert.deepEqual(settings.providerModelPreferences, preferences);
    assert.ok(settings.providerInstances[OURS], 'the entry is installed');
  }
});
