import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { mergeClaudeSettings, pinClaudeModel } from '../bin/t3-launch.js';
import {
  BUILT_IN_CLAUDE_MODELS,
  fakeGateway,
  fakeT3Probe,
  GOOD_KEY,
  MODELS,
  readRecords,
  run,
  snapshot,
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

async function installedBox(options = {}, args = ['--provider', 'claude']) {
  const sandbox = await box(options);
  const result = await subc(sandbox, ['t3', 'install', ...args]);
  assert.equal(result.code, 0, result.stderr);
  return sandbox;
}

function launch(sandbox, args, { log, env = {}, input, cwd } = {}) {
  return run(sandbox.claudeLauncher, args, {
    env: sandbox.claudeT3Env({ FAKE_CLAUDE_LOG: log, ...env }),
    input,
    cwd,
  });
}

const logFile = (sandbox, name) => path.join(sandbox.root, `${name}.log`);
const profileFile = (sandbox) =>
  path.join(sandbox.subc, 'profiles', 'default.env');

// The argv T3 Code 0.1.11 passes, from step 0.
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

function sessionArgs(model) {
  return [
    '--output-format',
    'stream-json',
    '--verbose',
    '--input-format',
    'stream-json',
    '--thinking=adaptive',
    '--thinking-display=summarized',
    '--effort=high',
    `--model=${model}`,
    '--permission-prompt-tool=stdio',
    '--allowedTools=mcp__t3-code__*',
    '--tools=default',
    '--permission-mode=bypassPermissions',
    '--allow-dangerously-skip-permissions',
    '--include-partial-messages',
    '--add-dir=/projects/app',
    '--add-dir=/t3/userdata/attachments',
    '--session-id=00000000-0000-4000-8000-000000000000',
    '--thinking-display',
    'summarized',
    '--settings',
    '{"showThinkingSummaries":true}',
  ];
}

function textGenerationArgs(model) {
  return [
    '-p',
    '--output-format',
    'json',
    '--json-schema',
    '{"type":"object"}',
    '--model',
    model,
    '--settings',
    '{"disableAllHooks":true}',
    '--tools',
    '',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--strict-mcp-config',
    '--permission-mode',
    'dontAsk',
  ];
}

/** The `--settings` values in an argv, parsed. */
function settingsOf(args) {
  const values = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--settings') values.push(JSON.parse(args[++i]));
    else if (args[i].startsWith('--settings=')) values.push(args[i]);
  }
  return values;
}

/** The argv with the one `--settings` value replaced by a marker. */
function withoutSettingsValue(args) {
  return args.map((arg, i) =>
    args[i - 1] === '--settings' ? '<settings>' : arg,
  );
}

function assertPicker(settings) {
  assert.deepEqual(settings.availableModels, MODELS);
  assert.equal(settings.modelPicker.replaceBuiltInOptions, true);
  assert.deepEqual(
    settings.modelPicker.options.map((option) => option.model),
    MODELS,
  );
}

/**
 * The --settings value pins the gateway, so a repo's or the user's Claude
 * settings cannot send the key to another host.
 */
function assertPinnedEnv(settings) {
  assert.equal(settings.env?.ANTHROPIC_BASE_URL, gateway.url);
  assert.equal(
    settings.env?.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,
    `${gateway.url}/v1/logs`,
  );
  assert.ok(!JSON.stringify(settings).includes(GOOD_KEY), 'no key in argv');
}

before(async () => {
  if (skip) return;
  gateway = await fakeGateway();
  installed = await installedBox();
});

after(async () => {
  for (const sandbox of boxes) await sandbox.cleanup();
  await gateway?.close();
});

test('a probe launch routes Claude Code to the gateway with the shared ~/.claude', {
  skip,
}, async () => {
  const sandbox = installed;
  const log = logFile(sandbox, 'probe');
  const result = await launch(sandbox, PROBE_ARGS, { log });
  assert.equal(result.code, 0, result.stderr);
  const [record] = await readRecords(log);

  // T3 Code's args in order, with the picker merged into its own settings.
  assert.deepEqual(withoutSettingsValue(record.args), [
    ...PROBE_ARGS.slice(0, -1),
    '<settings>',
  ]);
  const [settings, ...more] = settingsOf(record.args);
  assert.equal(more.length, 0, 'exactly one --settings');
  assert.equal(settings.disableAllHooks, true);
  assertPicker(settings);
  assertPinnedEnv(settings);

  const { env } = record;
  assert.equal(env.ANTHROPIC_BASE_URL, gateway.url);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, GOOD_KEY);
  assert.equal(env.ANTHROPIC_MODEL, MODELS[0]);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.OTEL_EXPORTER_OTLP_HEADERS, `x-api-key=${GOOD_KEY}`);
  assert.equal(env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT, `${gateway.url}/v1/logs`);
  assert.equal(env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, '0');
  // No CLAUDE_CONFIG_DIR and the user's HOME: Claude Code reads ~/.claude
  // and ~/.claude.json, so the user's settings and MCP servers apply, and
  // --setting-sources from T3 Code still names the user scope.
  assert.equal(env.CLAUDE_CONFIG_DIR, undefined);
  assert.equal(env.HOME, sandbox.home);
  assert.ok(record.args.includes('--setting-sources=user,project,local'));
  // T3 Code's protocol variables reach Claude Code unchanged.
  for (const name of [
    'CLAUDE_CODE_ENTRYPOINT',
    'CLAUDE_AGENT_SDK_VERSION',
    'CLAUDE_CODE_SDK_READS_SESSION_STATE',
    'CLAUDE_CODE_AUTO_CONNECT_IDE',
    'CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL',
    'MISE_OFFLINE',
    'T3CODE_THREAD_ID',
  ])
    assert.equal(env[name], sandbox.claudeT3Env()[name], name);
});

test('a CLAUDE_CONFIG_DIR from T3 Code is kept', { skip }, async () => {
  const sandbox = installed;
  const log = logFile(sandbox, 'config-dir');
  const dir = path.join(sandbox.root, 'instance claude home');
  const result = await launch(sandbox, PROBE_ARGS, {
    log,
    env: { CLAUDE_CONFIG_DIR: dir },
  });
  assert.equal(result.code, 0, result.stderr);
  const [record] = await readRecords(log);
  assert.equal(record.env.CLAUDE_CONFIG_DIR, dir);
});

test('a session keeps every T3 Code flag and its catalog model', {
  skip,
}, async () => {
  const sandbox = installed;
  const log = logFile(sandbox, 'session');
  const args = sessionArgs(MODELS[1]);
  const result = await launch(sandbox, args, { log });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '', 'no fallback line for a catalog model');
  const [record] = await readRecords(log);
  assert.deepEqual(withoutSettingsValue(record.args), [
    ...args.slice(0, -1),
    '<settings>',
  ]);
  const settings = settingsOf(record.args);
  assert.equal(settings.length, 1);
  assert.equal(settings[0].showThinkingSummaries, true);
  assertPicker(settings[0]);
});

test('text generation keeps its argv order and its stdin', {
  skip,
}, async () => {
  const sandbox = installed;
  const log = logFile(sandbox, 'text-generation');
  const args = textGenerationArgs(MODELS[0]);
  const result = await launch(sandbox, args, {
    log,
    env: { FAKE_CLAUDE_READ_STDIN: '1' },
    input: 'Write a title for this thread.',
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.stdout,
    `${JSON.stringify({ type: 'result', subtype: 'success', result: 'fake', fake: 'claude' })}\n`,
  );
  const [record] = await readRecords(log);
  assert.equal(record.stdin, 'Write a title for this thread.');
  // The settings sit before --tools "", and the empty word survives.
  assert.deepEqual(withoutSettingsValue(record.args), [
    ...args.slice(0, 8),
    '<settings>',
    ...args.slice(9),
  ]);
  const [settings] = settingsOf(record.args);
  assert.equal(settings.disableAllHooks, true);
  assertPicker(settings);
});

test('a --settings file path is merged, and with no --settings one is added', {
  skip,
}, async () => {
  const sandbox = installed;
  const cwd = path.join(sandbox.root, 'project dir');
  await fs.mkdir(path.join(cwd, 'conf'), { recursive: true });
  await fs.writeFile(
    path.join(cwd, 'conf', 'settings.json'),
    JSON.stringify({ fromFile: true, availableModels: ['claude-opus-5-5'] }),
  );
  const log = logFile(sandbox, 'settings-file');
  const fromFile = await launch(
    sandbox,
    ['-p', '--settings', 'conf/settings.json', '--model', MODELS[0]],
    { log, cwd },
  );
  assert.equal(fromFile.code, 0, fromFile.stderr);
  const [record] = await readRecords(log);
  assert.equal(record.cwd, cwd);
  const [settings, ...more] = settingsOf(record.args);
  assert.equal(more.length, 0);
  assert.equal(settings.fromFile, true);
  // The picker wins over a list that T3 Code or the user set.
  assertPicker(settings);
  assertPinnedEnv(settings);

  // Earlier flags are dropped, and the last one, in either form, is merged.
  const twoLog = logFile(sandbox, 'settings-two');
  const two = await launch(
    sandbox,
    [
      '--output-format',
      'stream-json',
      '--settings',
      '{"first":true}',
      '--settings={"last":true}',
    ],
    { log: twoLog },
  );
  assert.equal(two.code, 0, two.stderr);
  const [twoRecord] = await readRecords(twoLog);
  assert.deepEqual(withoutSettingsValue(twoRecord.args), [
    '--output-format',
    'stream-json',
    '--settings',
    '<settings>',
  ]);
  const [last] = settingsOf(twoRecord.args);
  assert.equal(last.last, true);
  assert.equal(last.first, undefined);

  const noneLog = logFile(sandbox, 'settings-none');
  const none = await launch(
    sandbox,
    ['--input-format', 'stream-json', '--output-format', 'stream-json'],
    { log: noneLog },
  );
  assert.equal(none.code, 0, none.stderr);
  const [noneRecord] = await readRecords(noneLog);
  assert.deepEqual(noneRecord.args.slice(0, 4), [
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
  ]);
  const added = settingsOf(noneRecord.args);
  assert.equal(added.length, 1);
  assertPicker(added[0]);
  assertPinnedEnv(added[0]);
});

test("T3 Code's settings env is kept, except the names subc pins", {
  skip,
}, async () => {
  const sandbox = installed;
  const cwd = path.join(sandbox.root, 'env project');
  await fs.mkdir(cwd, { recursive: true });
  await fs.writeFile(
    path.join(cwd, 'settings.json'),
    JSON.stringify({
      env: { FROM_FILE: 'kept', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9/evil' },
    }),
  );
  for (const [name, value] of [
    [
      'inline',
      JSON.stringify({
        showThinkingSummaries: true,
        env: {
          T3_SETTING: 'kept',
          ANTHROPIC_BASE_URL: 'http://127.0.0.1:9/evil',
          OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'http://127.0.0.1:9/logs',
        },
      }),
    ],
    ['file', 'settings.json'],
  ]) {
    const log = logFile(sandbox, `settings-env-${name}`);
    const result = await launch(
      sandbox,
      ['--output-format', 'stream-json', '--settings', value],
      { log, cwd },
    );
    assert.equal(result.code, 0, result.stderr);
    const [record] = await readRecords(log);
    const [settings, ...more] = settingsOf(record.args);
    assert.equal(more.length, 0);
    assertPinnedEnv(settings);
    if (name === 'inline') {
      assert.equal(settings.showThinkingSummaries, true);
      assert.equal(settings.env.T3_SETTING, 'kept');
    } else {
      assert.equal(settings.env.FROM_FILE, 'kept');
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
  await fs.writeFile(path.join(cwd, 'list.json'), '["SECRET-IN-LIST"]');
  const log = logFile(sandbox, 'malformed');
  for (const value of [
    '{"token":"SECRET-INLINE"',
    '["SECRET-ARRAY"]',
    'bad.json',
    'list.json',
    'missing-SECRET.json',
  ]) {
    const result = await launch(
      sandbox,
      ['--output-format', 'stream-json', '--settings', value],
      { log, cwd },
    );
    assert.equal(result.code, 1, value);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /--settings value that is not a JSON object/);
    assert.ok(!result.stderr.includes('SECRET'), value);
    assert.ok(!result.stderr.includes(value), value);
  }
  const trailing = await launch(sandbox, ['-p', '--settings'], { log });
  assert.equal(trailing.code, 1);
  assert.deepEqual(await readRecords(log), []);
});

test('a model outside the catalog runs as the profile model, with one stderr line', {
  skip,
}, async () => {
  const sandbox = installed;
  const log = logFile(sandbox, 'fallback');
  const session = await launch(sandbox, sessionArgs('claude-sonnet-5-5'), {
    log,
  });
  assert.equal(session.code, 0, session.stderr);
  assert.equal(
    session.stderr,
    `subc-t3-claude: claude-sonnet-5-5 is not in the Subconscious model catalog for this key, so Claude Code uses ${MODELS[0]} instead.\n`,
  );
  const textGeneration = await launch(
    sandbox,
    textGenerationArgs('claude-haiku-4-5'),
    { log },
  );
  assert.equal(textGeneration.code, 0, textGeneration.stderr);
  assert.match(
    textGeneration.stderr,
    /^subc-t3-claude: claude-haiku-4-5 is not in the Subconscious model catalog for this key, so Claude Code uses subconscious\/sandbox-a instead\.\n$/,
  );
  const [sessionRecord, textRecord] = await readRecords(log);
  // The --model flag wins over ANTHROPIC_MODEL in Claude Code, so the argv
  // itself names the profile model.
  assert.ok(sessionRecord.args.includes(`--model=${MODELS[0]}`));
  assert.ok(!sessionRecord.args.join(' ').includes('claude-sonnet-5-5'));
  assert.equal(sessionRecord.env.ANTHROPIC_MODEL, MODELS[0]);
  const index = textRecord.args.indexOf('--model');
  assert.equal(textRecord.args[index + 1], MODELS[0]);
  assert.ok(!textRecord.args.includes('claude-haiku-4-5'));

  // The fallback is the profile's model, read at each launch.
  await fs.writeFile(
    profileFile(sandbox),
    `GATEWAY_URL=${gateway.url}\nAPI_KEY=${GOOD_KEY}\nMODEL=${MODELS[1]}\n`,
  );
  try {
    const profiled = await launch(sandbox, sessionArgs('claude-opus-5-5'), {
      log,
    });
    assert.match(
      profiled.stderr,
      /so Claude Code uses subconscious\/sandbox-b/,
    );
    const records = await readRecords(log);
    assert.ok(records.at(-1).args.includes(`--model=${MODELS[1]}`));
  } finally {
    await fs.writeFile(
      profileFile(sandbox),
      `GATEWAY_URL=${gateway.url}\nAPI_KEY=${GOOD_KEY}\nMODEL=UNSET\n`,
    );
  }
});

test('an update that replaces the versioned file keeps the launcher working', {
  skip,
}, async () => {
  const sandbox = await installedBox();
  const versions = path.dirname(await fs.realpath(sandbox.claudeBin));
  const next = path.join(versions, '2.1.330');
  await fs.copyFile(await fs.realpath(sandbox.claudeBin), next);
  await fs.rm(sandbox.claudeBin);
  await fs.rm(path.join(versions, '2.1.326'));
  await fs.symlink(next, sandbox.claudeBin);
  const log = logFile(sandbox, 'updated');
  const result = await launch(sandbox, PROBE_ARGS, { log });
  assert.equal(result.code, 0, result.stderr);
  assert.equal((await readRecords(log)).length, 1);
  const status = await subc(sandbox, ['t3', 'status', '--provider', 'claude']);
  assert.match(status.stdout, /subc-t3-claude: current/);
});

test('a Claude Code below 2.1.301 warns', {
  skip,
}, async () => {
  const sandbox = await box();
  const warned = await subc(
    sandbox,
    ['t3', 'install', '--provider', 'claude', '--dry-run'],
    { FAKE_CLAUDE_VERSION: '2.1.290' },
  );
  assert.equal(warned.code, 0, warned.stderr);
  assert.match(
    warned.stdout,
    /Claude Code 2\.1\.290 is older than 2\.1\.301, the version T3 Code recommends/,
  );
  const current = await subc(sandbox, [
    't3',
    'install',
    '--provider',
    'claude',
    '--dry-run',
  ]);
  assert.doesNotMatch(current.stdout, /the version T3 Code recommends/);
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
  assert.deepEqual(pinClaudeModel(['--model=y'], ['y'], 'p'), {
    args: ['--model=y'],
    replaced: null,
  });
  assert.deepEqual(
    mergeClaudeSettings(['-p', '--', '--settings', 'x'], { a: 1 }),
    ['-p', '--settings', '{"a":1}', '--', '--settings', 'x'],
  );
});

test('mergeClaudeSettings merges env name by name, and subc names win', () => {
  const extra = { picker: true, env: { ANTHROPIC_BASE_URL: 'http://gw' } };
  const merged = (args) => JSON.parse(mergeClaudeSettings(args, extra).at(-1));
  assert.deepEqual(
    merged([
      '--settings',
      JSON.stringify({ a: 1, env: { KEEP: 'x', ANTHROPIC_BASE_URL: 'evil' } }),
    ]),
    {
      a: 1,
      picker: true,
      env: { KEEP: 'x', ANTHROPIC_BASE_URL: 'http://gw' },
    },
  );
  // An env that is not an object is replaced.
  assert.deepEqual(merged(['--settings', '{"env":"text"}']), extra);
  assert.deepEqual(merged([]), extra);
});

// The hide list: providerModelPreferences["subconscious-claude"].

const BUILT_INS = BUILT_IN_CLAUDE_MODELS.map(([slug]) => slug);
const OURS = 'subconscious-claude';
const tabbed = (value) => `${JSON.stringify(value, null, '\t')}\n`;
const readSettings = async (sandbox) =>
  JSON.parse(await fs.readFile(sandbox.settingsPath, 'utf8'));

function settingsWith(preferences) {
  return {
    projectSettingsFolded: true,
    favorites: [{ provider: 'claudeAgent', model: 'claude-opus-5-5' }],
    ...(preferences === undefined
      ? {}
      : { providerModelPreferences: preferences }),
    providerInstances: {
      claudeAgent: { driver: 'claudeAgent', enabled: true },
    },
    futureTopLevelSetting: { keep: [1, 2, 3] },
  };
}

/** Install with T3 Code playing its probe of the new entry. */
async function installWithProbe(sandbox, extraEnv = {}) {
  const stop = fakeT3Probe(sandbox, { reported: MODELS });
  try {
    return await subc(
      sandbox,
      ['t3', 'install', '--provider', 'claude'],
      extraEnv,
    );
  } finally {
    stop();
  }
}

test('install writes only the hide list key and keeps every other setting', {
  skip,
}, async () => {
  const text = tabbed(
    settingsWith({
      claudeAgent: {
        hiddenModels: ['claude-haiku-4-5'],
        modelOrder: ['claude-opus-5-5'],
      },
      'subconscious-codex': { hiddenModels: [], modelOrder: ['x/y'] },
    }),
  );
  const sandbox = await box({ settings: text });
  await writeT3ModelCache(sandbox, { instanceId: 'claudeAgent' });
  const result = await installWithProbe(sandbox);
  assert.equal(result.code, 0, result.stderr);
  assert.match(
    result.stdout,
    /Hide list\s+hid 14 models that are not in the catalog: claude-opus-5-5, /,
  );
  const settings = await readSettings(sandbox);
  assert.deepEqual(settings.providerModelPreferences[OURS], {
    hiddenModels: BUILT_INS,
    modelOrder: [],
  });
  for (const model of MODELS)
    assert.ok(
      !settings.providerModelPreferences[OURS].hiddenModels.includes(model),
    );
  // Without subc's entry and its hide list, the file is the original, byte
  // for byte: favorites and the other instances' preferences are kept.
  const rest = structuredClone(settings);
  delete rest.providerInstances[OURS];
  delete rest.providerModelPreferences[OURS];
  assert.equal(tabbed(rest), text);

  // Uninstall removes exactly those two keys again.
  const removed = await subc(sandbox, [
    't3',
    'uninstall',
    '--provider',
    'claude',
  ]);
  assert.equal(removed.code, 0, removed.stderr);
  assert.match(
    removed.stdout,
    /Removed the subconscious-claude hide list from providerModelPreferences/,
  );
  assert.equal(await fs.readFile(sandbox.settingsPath, 'utf8'), text);
});

test('a second install keeps modelOrder and uses the current cache at once', {
  skip,
}, async () => {
  const sandbox = await box({ settings: tabbed(settingsWith({})) });
  const first = await installWithProbe(sandbox);
  assert.equal(first.code, 0, first.stderr);
  const settings = await readSettings(sandbox);
  settings.providerModelPreferences[OURS] = {
    hiddenModels: [MODELS[0], 'claude-opus-5-5'],
    modelOrder: [MODELS[1], MODELS[0]],
  };
  await fs.writeFile(sandbox.settingsPath, tabbed(settings));
  // The entry is current, so T3 Code does not probe again, and the cache
  // from the last probe counts. The default wait is 30 s.
  const started = Date.now();
  const again = await subc(sandbox, ['t3', 'install', '--provider', 'claude']);
  assert.equal(again.code, 0, again.stderr);
  assert.ok(Date.now() - started < 15_000, 'install did not wait for a probe');
  assert.deepEqual(
    (await readSettings(sandbox)).providerModelPreferences[OURS],
    {
      hiddenModels: BUILT_INS,
      modelOrder: [MODELS[1], MODELS[0]],
    },
  );
  const third = await subc(sandbox, ['t3', 'install', '--provider', 'claude']);
  assert.match(third.stdout, /Hide list\s+already hides 14 models/);
});

test('install skips the hide list when providerModelPreferences is null or missing', {
  skip,
}, async () => {
  const hint =
    'In T3 Code, hide or reorder any model once, then run subc t3 install again.';
  for (const preferences of [null, undefined]) {
    const sandbox = await box({ settings: tabbed(settingsWith(preferences)) });
    await writeT3ModelCache(sandbox, { instanceId: 'claudeAgent' });
    const started = Date.now();
    const result = await installWithProbe(sandbox);
    assert.equal(result.code, 0, result.stderr);
    assert.ok(Date.now() - started < 15_000, 'the skip does not wait');
    assert.ok(result.stdout.includes(hint), result.stdout);
    const settings = await readSettings(sandbox);
    assert.equal(settings.providerModelPreferences, preferences);
    assert.ok(settings.providerInstances[OURS], 'the entry is installed');
    const status = await subc(sandbox, [
      't3',
      'status',
      '--provider',
      'claude',
    ]);
    assert.ok(status.stdout.includes(hint), status.stdout);
    assert.match(status.stdout, /Hide list\s+skipped/);
  }
});

test('with no fresh cache, install uses the built-in cache, or skips the hide list', {
  skip,
}, async () => {
  // Nothing plays T3 Code's probe here, so install waits 30 s and then
  // falls back. A cache an earlier install left does not count for a new
  // entry.
  const sandbox = await box({ settings: tabbed(settingsWith({})) });
  await writeT3ModelCache(sandbox, {
    instanceId: OURS,
    builtIns: [],
    reported: ['stale/model'],
    checkedAt: '2020-01-01T00:00:00.000Z',
  });
  await writeT3ModelCache(sandbox, { instanceId: 'claudeAgent' });
  const fallback = await subc(sandbox, [
    't3',
    'install',
    '--provider',
    'claude',
  ]);
  assert.equal(fallback.code, 0, fallback.stderr);
  assert.match(fallback.stdout, /hid 14 models/);
  assert.deepEqual(
    (await readSettings(sandbox)).providerModelPreferences[OURS].hiddenModels,
    BUILT_INS,
  );

  // No cache at all: the hide list is skipped and install still succeeds.
  const bare = await box({ settings: tabbed(settingsWith({})) });
  const skipped = await subc(bare, ['t3', 'install', '--provider', 'claude']);
  assert.equal(skipped.code, 0, skipped.stderr);
  assert.match(
    skipped.stdout,
    /Skipped: T3 Code wrote no model cache for subconscious-claude or claudeAgent/,
  );
  assert.match(skipped.stdout, /Subconscious \(Claude\) is ready in T3 Code/);
  const settings = await readSettings(bare);
  assert.deepEqual(settings.providerModelPreferences, {});
  assert.ok(settings.providerInstances[OURS]);
  const status = await subc(bare, ['t3', 'status', '--provider', 'claude']);
  assert.match(status.stdout, /Hide list\s+not written\. Run subc t3 install/);
});

test('status reports the hide list, and drift for a new built-in model', {
  skip,
}, async () => {
  const sandbox = await box({ settings: tabbed(settingsWith({})) });
  await writeT3ModelCache(sandbox, { instanceId: 'claudeAgent' });
  const result = await installWithProbe(sandbox);
  assert.equal(result.code, 0, result.stderr);
  const clean = await subc(sandbox, ['t3', 'status', '--provider', 'claude']);
  assert.match(clean.stdout, /Hide list\s+written, 14 models hidden/);
  assert.doesNotMatch(clean.stdout, /drift/);

  // T3 Code's remote model list adds a built-in model.
  const builtIns = [...BUILT_INS, 'claude-opus-6'];
  await writeT3ModelCache(sandbox, { instanceId: 'claudeAgent', builtIns });
  await writeT3ModelCache(sandbox, {
    instanceId: OURS,
    builtIns,
    reported: MODELS,
  });
  const drift = await subc(sandbox, ['t3', 'status', '--provider', 'claude']);
  assert.equal(drift.code, 1, drift.stderr);
  assert.match(
    drift.stdout,
    /drift: T3 Code lists 1 built-in models that the hide list does not hide: claude-opus-6\. Run subc t3 install --provider claude again\./,
  );

  const fixed = await subc(sandbox, ['t3', 'install', '--provider', 'claude']);
  assert.equal(fixed.code, 0, fixed.stderr);
  const after = await subc(sandbox, ['t3', 'status', '--provider', 'claude']);
  assert.match(after.stdout, /written, 15 models hidden/);
  assert.doesNotMatch(after.stdout, /drift/);
});

test('install --dry-run prints the hide list and writes nothing', {
  skip,
}, async () => {
  const sandbox = await box({ settings: tabbed(settingsWith({})) });
  await writeT3ModelCache(sandbox, {
    instanceId: OURS,
    reported: MODELS,
  });
  const before = await snapshot(sandbox.home);
  const result = await subc(sandbox, [
    't3',
    'install',
    '--provider',
    'claude',
    '--dry-run',
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(
    result.stdout,
    /Hide list\s+would hide 14 models that are not in the catalog: claude-opus-5-5/,
  );
  assert.ok(!result.stdout.includes(`${MODELS[0]},`));
  assert.match(result.stdout, /Dry run: nothing was changed/);
  assert.deepEqual(await snapshot(sandbox.home), before);
});

test('uninstall removes a hide list whose entry is already gone, and nothing else', {
  skip,
}, async () => {
  const sandbox = await box({
    settings: tabbed(
      settingsWith({ claudeAgent: { hiddenModels: ['a'], modelOrder: [] } }),
    ),
  });
  const result = await installWithProbe(sandbox);
  assert.equal(result.code, 0, result.stderr);
  const settings = await readSettings(sandbox);
  delete settings.providerInstances[OURS];
  await fs.writeFile(sandbox.settingsPath, tabbed(settings));
  const removed = await subc(sandbox, [
    't3',
    'uninstall',
    '--provider',
    'claude',
  ]);
  assert.equal(removed.code, 0, removed.stderr);
  assert.match(removed.stdout, /Removed the subconscious-claude hide list/);
  const after = await readSettings(sandbox);
  assert.deepEqual(after.providerModelPreferences, {
    claudeAgent: { hiddenModels: ['a'], modelOrder: [] },
  });
  assert.deepEqual(after.favorites, settings.favorites);
});

test('help says that T3 Code does not show the fallback line', {
  skip,
}, async () => {
  const sandbox = await box();
  const help = await subc(sandbox, ['t3', 'help']);
  assert.doesNotMatch(help.stdout, /logs one line/);
  assert.match(help.stdout, /T3 Code does not show the\s+launcher's\s+stderr/);
});

test('help explains the hide list and how to turn it on', {
  skip,
}, async () => {
  const sandbox = await box();
  const help = await subc(sandbox, ['t3', 'help']);
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /hide list/);
  assert.match(help.stdout, /hide or reorder a\s+model in its settings/);
  assert.match(help.stdout, /drift/);
});

test("help says that a repo's Claude hooks and MCP servers see the key", {
  skip,
}, async () => {
  const sandbox = await box();
  const help = await subc(sandbox, ['t3', 'help']);
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /pins ANTHROPIC_BASE_URL/);
  assert.match(
    help.stdout,
    /Hooks in a repo's \.claude\/settings\.json and its project MCP servers\s+run with the key in their env/,
  );
});
