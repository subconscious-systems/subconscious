import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { mergeClaudeSettings, pinClaudeModel } from '../bin/t3-launch.js';
import {
  BUILT_IN_CLAUDE_MODELS,
  fakeGateway,
  fakeT3Probe,
  fakeT3Server,
  GOOD_KEY,
  MODELS,
  readRecords,
  run,
  snapshot,
  subc,
  t3Sandbox,
  USER_CLAUDE_JSON,
  USER_CLAUDE_SETTINGS,
  writeT3ModelCache,
} from './helpers/t3-sandbox.js';

const skip = process.platform === 'win32';
const ADAPTER = fileURLToPath(new URL('../bin/t3-claude.js', import.meta.url));

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

/** Every file under ~/.claude, and ~/.claude.json, for no-write checks. */
async function claudeFiles(sandbox) {
  return {
    dir: await snapshot(sandbox.claudeDir),
    json: await fs.readFile(sandbox.claudeJson, 'utf8'),
  };
}

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

test('install --dry-run --provider claude checks everything and writes nothing', {
  skip,
}, async () => {
  const sandbox = await box();
  const before = await snapshot(sandbox.home);
  const requests = gateway.requests.length;
  const result = await subc(sandbox, [
    't3',
    'install',
    '--provider',
    'claude',
    '--dry-run',
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Plan: Subconscious \(Claude\) in T3 Code/);
  assert.match(result.stdout, /\.local\/bin\/claude \(2\.1\.326\)/);
  assert.match(result.stdout, /uses your ~\/\.claude/);
  assert.match(result.stdout, /Dry run: nothing was changed/);
  assert.deepEqual(await snapshot(sandbox.home), before);
  assert.ok(gateway.requests.length > requests, 'the live catalog was read');
});

test('install --provider claude adds only the Claude entry, with no homePath', {
  skip,
}, async () => {
  const sandbox = await box();
  const claudeBefore = await claudeFiles(sandbox);
  const result = await subc(sandbox, ['t3', 'install', '--provider', 'claude']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Subconscious \(Claude\) is ready in T3 Code/);
  const text = await fs.readFile(sandbox.settingsPath, 'utf8');
  const settings = JSON.parse(text);
  assert.deepEqual(settings.futureTopLevelSetting, { keep: [1, 2, 3] });
  assert.deepEqual(Object.keys(settings.providerInstances), [
    'claudeAgent',
    'subconscious-claude',
  ]);
  assert.deepEqual(settings.providerInstances.claudeAgent, {
    driver: 'claudeAgent',
    enabled: true,
  });
  assert.deepEqual(settings.providerInstances['subconscious-claude'], {
    driver: 'claudeAgent',
    displayName: 'Subconscious (Claude)',
    enabled: true,
    config: { binaryPath: sandbox.claudeLauncher },
  });
  assert.equal((await fs.stat(sandbox.claudeLauncher)).mode & 0o777, 0o755);
  await assert.rejects(fs.access(sandbox.launcher), 'no Codex launcher');

  // The launcher pins the ~/.local/bin/claude link, not its versioned file.
  const launcher = await fs.readFile(sandbox.claudeLauncher, 'utf8');
  assert.match(launcher, /^#!\/usr\/bin\/env -S bash -p\n/);
  assert.ok(
    launcher.includes(`\nsubc_claude='${sandbox.claudeBin}'\n`),
    launcher,
  );
  assert.match(launcher, /--claude "\$subc_claude"/);
  assert.ok(!launcher.includes(GOOD_KEY));
  assert.ok(!text.includes(GOOD_KEY));
  assert.ok(!`${result.stdout}${result.stderr}`.includes(GOOD_KEY));

  // The version check ran with a throwaway config dir. ~/.claude and
  // ~/.claude.json are as they were.
  assert.deepEqual(await claudeFiles(sandbox), claudeBefore);
  await assert.rejects(
    fs.access(path.join(sandbox.claudeDir, 'fake-version-check')),
  );
  assert.equal(
    await fs.readFile(path.join(sandbox.claudeDir, 'settings.json'), 'utf8'),
    USER_CLAUDE_SETTINGS,
  );
  assert.equal(await fs.readFile(sandbox.claudeJson, 'utf8'), USER_CLAUDE_JSON);
});

test('install clears launchArgs on its own entry', { skip }, async () => {
  const sandbox = await installedBox();
  const settings = JSON.parse(await fs.readFile(sandbox.settingsPath, 'utf8'));
  const entry = settings.providerInstances['subconscious-claude'];
  entry.config.launchArgs = '--model claude-opus-5-5';
  entry.config.customModels = [{ slug: 'mine' }];
  await fs.writeFile(sandbox.settingsPath, JSON.stringify(settings));
  const status = await subc(sandbox, ['t3', 'status', '--provider', 'claude']);
  assert.match(
    status.stdout,
    /subconscious-claude: installed, changed in T3 \(launchArgs\)/,
  );
  const result = await subc(sandbox, ['t3', 'install', '--provider', 'claude']);
  assert.equal(result.code, 0, result.stderr);
  const repaired = JSON.parse(await fs.readFile(sandbox.settingsPath, 'utf8'))
    .providerInstances['subconscious-claude'];
  assert.deepEqual(repaired.config, {
    customModels: [{ slug: 'mine' }],
    binaryPath: sandbox.claudeLauncher,
  });
});

test('a probe launch routes Claude Code to the gateway with the shared ~/.claude', {
  skip,
}, async () => {
  const sandbox = installed;
  const claudeBefore = await claudeFiles(sandbox);
  const log = logFile(sandbox, 'probe');
  const result = await launch(sandbox, PROBE_ARGS, { log });
  assert.equal(result.code, 0, result.stderr);
  const [record] = await readRecords(log);
  // Stdout is the stream-json protocol, so it carries Claude's line alone.
  assert.equal(
    result.stdout,
    `${JSON.stringify({ type: 'system', subtype: 'init', fake: 'claude' })}\n`,
  );
  assert.equal(result.stderr, '');
  // The process T3 Code started is the one that became Claude Code.
  assert.equal(record.pid, result.pid);

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
  assert.deepEqual(await claudeFiles(sandbox), claudeBefore);
});

test('only ANTHROPIC_AUTH_TOKEN and OTEL_EXPORTER_OTLP_HEADERS carry the key', {
  skip,
}, async () => {
  const sandbox = await installedBox();
  // A profile line can hold another copy of the key.
  await fs.appendFile(profileFile(sandbox), `OPENCODE_API_KEY=${GOOD_KEY}\n`);
  const log = logFile(sandbox, 'key-copies');
  const result = await launch(sandbox, PROBE_ARGS, { log });
  assert.equal(result.code, 0, result.stderr);
  const [record] = await readRecords(log);
  const holders = Object.entries(record.env)
    .filter(([, value]) => String(value).includes(GOOD_KEY))
    .map(([name]) => name)
    .sort();
  assert.deepEqual(holders, [
    'ANTHROPIC_AUTH_TOKEN',
    'OTEL_EXPORTER_OTLP_HEADERS',
  ]);
  const equal = Object.entries(record.env)
    .filter(([, value]) => value === GOOD_KEY)
    .map(([name]) => name);
  assert.deepEqual(equal, ['ANTHROPIC_AUTH_TOKEN']);
  for (const name of [
    'API_KEY',
    'CLAUDE_CODE_API_KEY',
    'SUBC_CLAUDE_SETTINGS',
    'SUBCONSCIOUS_MODELS',
    'SUBC_MODEL_METADATA',
  ])
    assert.equal(record.env[name], undefined, name);
  assert.ok(
    Object.keys(record.env).every(
      (name) => !/^(SUBC_|SUBCONSCIOUS_)/.test(name),
    ),
  );
  assert.ok(!record.args.join('\n').includes(GOOD_KEY), 'no key in argv');
  assert.ok(!result.stderr.includes(GOOD_KEY), 'no key in stderr');
  assert.ok(
    !(await fs.readFile(sandbox.claudeLauncher, 'utf8')).includes(GOOD_KEY),
  );
});

test('a hostile T3 Code env cannot steer the launch', { skip }, async () => {
  const sandbox = installed;
  const log = logFile(sandbox, 'hostile');
  const requests = gateway.requests.length;
  const result = await launch(sandbox, PROBE_ARGS, {
    log,
    env: {
      ANTHROPIC_API_KEY: 'sk-ant-evil',
      ANTHROPIC_AUTH_TOKEN: 'sk-ant-evil-token',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:9/evil',
      ANTHROPIC_MODEL: 'claude-opus-5-5',
      ANTHROPIC_SMALL_FAST_MODEL: 'claude-haiku-4-5',
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-evil',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_USE_VERTEX: '1',
      CLAUDE_CODE_USE_FOUNDRY: '1',
      CLAUDE_GATEWAY_URL: 'http://127.0.0.1:9/evil-claude',
      CLAUDE_CODE_API_KEY: 'sk-evil-claude-key',
      CLAUDE_CODE_ENABLE_TELEMETRY: '0',
      COMPACT_WINDOW: '123456',
      SUBCONSCIOUS_API_KEY: 'sk-inherited-evil',
      SUBCONSCIOUS_BASE_URL: 'http://127.0.0.1:9/evil',
      SUBCONSCIOUS_MODELS: 'evil/pinned-model',
      SUBCONSCIOUS_MODEL: 'evil/model',
      SUBC_CONFIG_DIR: path.join(sandbox.root, 'evil-config'),
      SUBC_MODEL_METADATA: '[]',
      OTEL_EXPORTER_OTLP_HEADERS: 'x-api-key=sk-evil-otel',
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'http://127.0.0.1:9/logs',
      API_KEY: 'sk-evil-api-key',
      GATEWAY_URL: 'http://127.0.0.1:9/evil-gateway',
      MODEL: 'evil/model',
    },
  });
  assert.equal(result.code, 0, result.stderr);
  const [record] = await readRecords(log);
  const { env } = record;
  assert.equal(env.ANTHROPIC_BASE_URL, gateway.url);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, GOOD_KEY);
  assert.equal(env.ANTHROPIC_MODEL, MODELS[0]);
  assert.equal(env.ANTHROPIC_SMALL_FAST_MODEL, MODELS[0]);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.equal(env.CLAUDE_CODE_USE_BEDROCK, undefined);
  assert.equal(env.CLAUDE_CODE_USE_VERTEX, undefined);
  assert.equal(env.CLAUDE_CODE_USE_FOUNDRY, undefined);
  assert.equal(env.CLAUDE_GATEWAY_URL, undefined);
  assert.equal(env.CLAUDE_CODE_ENABLE_TELEMETRY, '1');
  assert.equal(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '1000000');
  assert.equal(env.OTEL_EXPORTER_OTLP_HEADERS, `x-api-key=${GOOD_KEY}`);
  assert.equal(env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT, `${gateway.url}/v1/logs`);
  assert.equal(env.API_KEY, undefined);
  assert.equal(env.SUBC_CONFIG_DIR, undefined);
  assertPicker(settingsOf(record.args)[0]);
  const values = Object.values(env).join('\n');
  assert.ok(!values.includes('evil'), 'no hostile value reached Claude Code');
  const launches = gateway.requests.slice(requests);
  assert.ok(launches.length > 0);
  assert.ok(
    launches.every((request) => request.authorization === `Bearer ${GOOD_KEY}`),
    'only the profile key reached the gateway',
  );
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

test('version, help, and update run the real Claude Code offline', {
  skip,
}, async () => {
  const sandbox = installed;
  const requests = gateway.requests.length;
  const before = await snapshot(sandbox.subc);
  for (const args of [['--version'], ['-v']]) {
    const result = await launch(sandbox, args);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, '2.1.326 (Claude Code)\n');
  }
  const hostile = { ANTHROPIC_API_KEY: 'sk-ant-t3', SUBCONSCIOUS_MODEL: 'x' };
  for (const args of [['-h'], ['--help'], ['update']]) {
    const log = logFile(sandbox, `passthrough-${args.join('')}`);
    const result = await launch(sandbox, args, { log, env: hostile });
    assert.equal(result.code, 0, `${args.join(' ')}: ${result.stderr}`);
    const [record] = await readRecords(log);
    assert.deepEqual(record.args, args);
    // T3 Code's env reaches Claude Code as it was: no Subconscious launch.
    const expected = sandbox.claudeT3Env({ FAKE_CLAUDE_LOG: log, ...hostile });
    for (const [name, value] of Object.entries(expected))
      if (name !== 'PATH') assert.equal(record.env[name], value, name);
    assert.equal(record.env.ANTHROPIC_AUTH_TOKEN, undefined);
    assert.equal(record.env.ANTHROPIC_BASE_URL, undefined);
  }
  assert.equal(gateway.requests.length, requests, 'no network request');
  assert.deepEqual(await snapshot(sandbox.subc), before, 'no file written');

  // A passthrough never reads the profile, so a broken one cannot stop it.
  await fs.writeFile(profileFile(sandbox), 'MODEL=not a model!\n');
  try {
    const result = await launch(sandbox, ['--version']);
    assert.equal(result.code, 0, result.stderr);
  } finally {
    await fs.writeFile(
      profileFile(sandbox),
      `GATEWAY_URL=${gateway.url}\nAPI_KEY=${GOOD_KEY}\nMODEL=UNSET\n`,
    );
  }
});

test('other Claude commands are refused before Claude runs', {
  skip,
}, async () => {
  const sandbox = installed;
  const requests = gateway.requests.length;
  for (const args of [
    [],
    ['auth', 'login'],
    ['mcp', 'add', 'x', '--', 'cmd', '-p'],
    ['setup-token'],
    ['doctor'],
    ['--resume', 'abc'],
    ['update', 'now'],
  ]) {
    const log = logFile(sandbox, 'refused');
    const result = await launch(sandbox, args, { log });
    // The launcher reads the plan through a process substitution, so it
    // exits 1 for any adapter failure, as the Codex launcher does.
    assert.equal(result.code, 1, args.join(' '));
    assert.equal(result.stdout, '');
    assert.match(
      result.stderr,
      /^subc-t3-claude: `claude .*` is not available through the Subconscious provider\. Run claude directly for it\.\n$/,
    );
    assert.deepEqual(await readRecords(log), []);
    // The adapter itself exits 64 (EX_USAGE).
    const adapter = await run(
      process.execPath,
      [
        ADAPTER,
        '--claude',
        sandbox.claudeBin,
        '--config-dir',
        sandbox.subc,
        '--',
        ...args,
      ],
      { env: sandbox.claudeT3Env({ FAKE_CLAUDE_LOG: log }) },
    );
    assert.equal(adapter.code, 64, args.join(' '));
    assert.equal(adapter.stdout, '');
  }
  assert.equal(gateway.requests.length, requests, 'no network request');
});

test('a rejected key or an unreachable gateway stops the launch', {
  skip,
}, async () => {
  const sandbox = await installedBox();
  await fs.writeFile(
    profileFile(sandbox),
    `GATEWAY_URL=${gateway.url}\nAPI_KEY=sk-rejected-key\nMODEL=UNSET\n`,
  );
  const log = logFile(sandbox, 'rejected');
  const rejected = await launch(sandbox, PROBE_ARGS, { log });
  assert.equal(rejected.code, 1);
  assert.equal(rejected.stdout, '');
  assert.match(
    rejected.stderr,
    /did not return the model catalog for this key/,
  );
  assert.ok(!rejected.stderr.includes('sk-rejected-key'));

  await fs.writeFile(
    profileFile(sandbox),
    `GATEWAY_URL=http://127.0.0.1:9\nAPI_KEY=${GOOD_KEY}\nMODEL=UNSET\n`,
  );
  const offline = await launch(sandbox, textGenerationArgs(MODELS[0]), {
    log,
  });
  assert.equal(offline.code, 1);
  assert.match(offline.stderr, /Could not read the model catalog/);
  assert.ok(!offline.stderr.includes(GOOD_KEY));
  assert.deepEqual(await readRecords(log), []);
});

test('each launch reads the default profile again', { skip }, async () => {
  const sandbox = await installedBox();
  const log = logFile(sandbox, 'dynamic');
  const first = await launch(sandbox, PROBE_ARGS, { log });
  assert.equal(first.code, 0, first.stderr);
  await fs.writeFile(
    profileFile(sandbox),
    `GATEWAY_URL=${gateway.url}\nAPI_KEY=${GOOD_KEY}\nMODEL=${MODELS[1]}\nCLAUDE_GATEWAY_URL=http://127.0.0.1:1/claude\nCLAUDE_CODE_AUTO_COMPACT_WINDOW=200000\n`,
  );
  const second = await launch(sandbox, PROBE_ARGS, { log });
  assert.equal(second.code, 0, second.stderr);
  const [before, after] = await readRecords(log);
  assert.equal(before.env.ANTHROPIC_MODEL, MODELS[0]);
  assert.equal(before.env.ANTHROPIC_BASE_URL, gateway.url);
  assert.equal(after.env.ANTHROPIC_MODEL, MODELS[1]);
  assert.equal(after.env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:1/claude');
  assert.equal(after.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '200000');
  // The picker leads with the profile model.
  assert.deepEqual(settingsOf(after.args)[0].availableModels, [
    MODELS[1],
    MODELS[0],
  ]);
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

test('a Claude Code below 2.1.280 stops install, and below 2.1.301 warns', {
  skip,
}, async () => {
  const sandbox = await box();
  const before = await snapshot(sandbox.home);
  const old = await subc(sandbox, ['t3', 'install', '--provider', 'claude'], {
    FAKE_CLAUDE_VERSION: '2.1.279',
  });
  assert.equal(old.code, 1);
  assert.match(
    old.stderr,
    /Claude Code 2\.1\.279 is older than 2\.1\.280, the oldest version this provider supports/,
  );
  assert.deepEqual(await snapshot(sandbox.home), before);

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

test('status lists the Claude provider offline, with no key', {
  skip,
}, async () => {
  const sandbox = await installedBox();
  await fs.writeFile(
    profileFile(sandbox),
    'GATEWAY_URL=http://127.0.0.1:9\nMODEL=not a model!\n',
  );
  const claudeBefore = await claudeFiles(sandbox);
  const requests = gateway.requests.length;
  const status = await subc(sandbox, ['t3', 'status']);
  assert.equal(status.code, 0, status.stderr);
  assert.match(status.stdout, /Subconscious \(Codex\)/);
  assert.match(status.stdout, /subconscious-codex: not installed/);
  assert.match(status.stdout, /Subconscious \(Claude\)/);
  assert.match(status.stdout, /subconscious-claude: installed/);
  assert.match(status.stdout, /subc-t3-claude: current/);
  assert.ok(
    status.stdout.includes(`${sandbox.claudeBin} (2.1.326)`),
    status.stdout,
  );
  assert.match(status.stdout, /uses your ~\/\.claude/);
  assert.equal(gateway.requests.length, requests, 'no network request');
  assert.deepEqual(await claudeFiles(sandbox), claudeBefore);
});

test('uninstall removes the entry and the launcher and never touches ~/.claude', {
  skip,
}, async () => {
  const sandbox = await installedBox();
  const claudeBefore = await claudeFiles(sandbox);
  const result = await subc(sandbox, [
    't3',
    'uninstall',
    '--provider',
    'claude',
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Removed subconscious-claude/);
  await assert.rejects(fs.access(sandbox.claudeLauncher));
  const settings = JSON.parse(await fs.readFile(sandbox.settingsPath, 'utf8'));
  assert.deepEqual(Object.keys(settings.providerInstances), ['claudeAgent']);
  assert.deepEqual(settings.futureTopLevelSetting, { keep: [1, 2, 3] });
  assert.deepEqual(await claudeFiles(sandbox), claudeBefore);
});

test('Codex keeps working when both providers are installed', {
  skip,
}, async () => {
  const sandbox = await installedBox({}, []);
  const settings = JSON.parse(await fs.readFile(sandbox.settingsPath, 'utf8'));
  assert.deepEqual(Object.keys(settings.providerInstances), [
    'claudeAgent',
    'subconscious-codex',
    'subconscious-claude',
  ]);
  assert.deepEqual(settings.providerInstances['subconscious-codex'], {
    driver: 'codex',
    displayName: 'Subconscious (Codex)',
    enabled: true,
    config: {
      setupMode: 'existing',
      binaryPath: sandbox.launcher,
      homePath: sandbox.codexHome,
    },
  });

  const again = await subc(sandbox, ['t3', 'install']);
  assert.equal(again.code, 0, again.stderr);
  assert.equal(again.stdout.match(/already set up/g)?.length, 2);

  const codexLog = logFile(sandbox, 'both-codex');
  const codex = await run(sandbox.launcher, ['app-server'], {
    env: sandbox.t3Env({ FAKE_CODEX_LOG: codexLog }),
  });
  assert.equal(codex.code, 0, codex.stderr);
  const [codexRecord] = await readRecords(codexLog);
  assert.equal(codexRecord.args.at(-1), 'app-server');
  assert.equal(codexRecord.env.SUBCONSCIOUS_API_KEY, GOOD_KEY);
  assert.equal(codexRecord.env.ANTHROPIC_AUTH_TOKEN, undefined);

  const claudeLog = logFile(sandbox, 'both-claude');
  const claude = await launch(sandbox, PROBE_ARGS, { log: claudeLog });
  assert.equal(claude.code, 0, claude.stderr);
  assert.equal((await readRecords(claudeLog)).length, 1);

  const removed = await subc(sandbox, [
    't3',
    'uninstall',
    '--provider',
    'claude',
  ]);
  assert.equal(removed.code, 0, removed.stderr);
  const left = JSON.parse(await fs.readFile(sandbox.settingsPath, 'utf8'));
  assert.deepEqual(
    left.providerInstances['subconscious-codex'],
    settings.providerInstances['subconscious-codex'],
  );
  await fs.access(sandbox.launcher);
});

test('install without --provider skips Claude when its CLI is missing', {
  skip,
}, async () => {
  const sandbox = await box();
  await fs.rm(sandbox.claudeBin);
  const result = await subc(sandbox, ['t3', 'install', '--dry-run']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Plan: Subconscious \(Codex\) in T3 Code/);
  assert.match(
    result.stdout,
    /Skipped.*Subconscious \(Claude\): Claude Code CLI is not installed/,
  );
  const named = await subc(sandbox, ['t3', 'install', '--provider', 'claude']);
  assert.equal(named.code, 1);
  assert.match(named.stderr, /Claude Code CLI is not installed/);
});

test('install without --provider repairs Codex and skips an old Claude Code', {
  skip,
}, async () => {
  const sandbox = await installedBox({}, ['--provider', 'codex']);
  // A stale Codex provider: status asks for subc t3 install.
  await fs.rm(sandbox.launcher);
  const result = await subc(sandbox, ['t3', 'install'], {
    FAKE_CLAUDE_VERSION: '2.1.200',
  });
  assert.equal(result.code, 0, result.stderr);
  assert.match(
    result.stdout,
    /Skipped.*Subconscious \(Claude\): Claude Code 2\.1\.200 is older than 2\.1\.280, the oldest version this provider supports/,
  );
  assert.match(
    result.stdout,
    /Subconscious \(Codex\) is (ready|already set up)/,
  );
  assert.ok(
    (await fs.readFile(sandbox.launcher, 'utf8')).includes('subc_codex='),
  );
  const settings = JSON.parse(await fs.readFile(sandbox.settingsPath, 'utf8'));
  assert.ok(settings.providerInstances['subconscious-codex']);
  assert.equal(settings.providerInstances['subconscious-claude'], undefined);
  await assert.rejects(fs.lstat(sandbox.claudeLauncher));

  // --provider stays strict: one refused provider stops the whole install.
  const before = await snapshot(sandbox.home);
  const named = await subc(
    sandbox,
    ['t3', 'install', '--provider', 'codex', '--provider', 'claude'],
    { FAKE_CLAUDE_VERSION: '2.1.200' },
  );
  assert.equal(named.code, 1);
  assert.match(named.stderr, /Subconscious \(Claude\): Claude Code 2\.1\.200/);
  assert.match(named.stderr, /Nothing was changed\./);
  assert.deepEqual(await snapshot(sandbox.home), before);
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
  const stopServer = await fakeT3Server(sandbox);
  const stop = fakeT3Probe(sandbox, { reported: MODELS });
  try {
    return await subc(
      sandbox,
      ['t3', 'install', '--provider', 'claude'],
      extraEnv,
    );
  } finally {
    stop();
    await stopServer();
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

test('with no T3 Code server, install does not wait for a cache', {
  skip,
}, async () => {
  const sandbox = await box({ settings: tabbed(settingsWith({})) });
  await writeT3ModelCache(sandbox, { instanceId: 'claudeAgent' });
  const started = Date.now();
  const result = await subc(sandbox, ['t3', 'install', '--provider', 'claude']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /hid 14 models/);
  assert.ok(Date.now() - started < 10_000, 'no 30 s wait');
});

test('with no fresh cache, install uses the built-in cache, or skips the hide list', {
  skip,
}, async () => {
  // No T3 Code server runs here, so install does not wait for a probe. A
  // cache an earlier install left does not count for a new entry.
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

test("status shows T3 Code's sign-in warning for a rejected key", {
  skip,
}, async () => {
  const sandbox = await installedBox();
  await writeT3ModelCache(sandbox, {
    instanceId: 'subconscious-claude',
    status: 'warning',
    auth: { status: 'unknown' },
    message: 'Claude Agent CLI failed while checking account status.',
  });
  const result = await subc(sandbox, ['t3', 'status', '--provider', 'claude']);
  assert.equal(result.code, 1, result.stdout);
  assert.match(
    result.stdout,
    /T3 check\s+warning, checked .*: Claude Agent CLI failed while checking account status\./,
  );
  assert.match(result.stdout, /run subc login/);

  // A warning with a signed-in account is not about the key.
  await writeT3ModelCache(sandbox, {
    instanceId: 'subconscious-claude',
    status: 'warning',
    message: 'Claude Code 2.1.290 is older than T3 Code recommends.',
  });
  const warned = await subc(sandbox, ['t3', 'status', '--provider', 'claude']);
  assert.match(warned.stdout, /T3 check\s+warning, checked .*older than/);
  assert.doesNotMatch(warned.stdout, /run subc login/);
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
