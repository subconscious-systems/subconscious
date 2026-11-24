/**
 * The checks that every `subc t3` provider must pass, run once per provider.
 * Each provider supplies a fixture: how T3 Code starts it, the argv it
 * configures, passes through, and refuses, and where the key may be. The
 * provider-specific behavior stays in t3.test.js (Codex), t3-claude.test.js,
 * and t3-opencode.test.js.
 */

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LAUNCHER_SHEBANG } from '../bin/t3-launch.js';
import { T3_PROVIDERS } from '../bin/t3-providers.js';
import {
  exportedFunctions,
  fakeGateway,
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
const OPENCODE_FRESHNESS =
  'A new key or model applies after the OpenCode helper restarts: restart T3 Code, or wait until its OpenCode threads have been idle for 30 minutes.';
// Names under which a profile line can hold another copy of the key.
const PROFILE_COPIES = [
  'EXTRA_COPY',
  'OPENCODE_API_KEY',
  'SUBC_OPENCODE_API_KEY',
];
const LISTENING = /^server listening on http:\/\/127\.0\.0\.1:\d+\n$/;

/** What each provider brings to the shared checks. */
const FIXTURES = {
  codex: {
    launcher: (box) => box.launcher,
    binary: (box) => path.join(box.bin, 'codex'),
    // T3 Code's env for Codex already carries every hostile name that the
    // sandbox knows.
    t3Env: (box, extra) => box.t3Env(extra),
    version: '0.167.2',
    versionOutput: (version) => `codex-cli ${version}\n`,
    versionArgs: [['--version']],
    tooOld: '0.142.0',
    minimum: '0.143.0',
    configured: ['app-server'],
    stdout: (record) =>
      `${JSON.stringify({ fake: 'codex', args: record.args })}\n`,
    passthrough: [
      ['-V'],
      ['--help'],
      ['help', 'exec'],
      ['app-server', '--help'],
      ['app-server', 'generate-json-schema', '--out', '/tmp/x'],
      [
        '-c',
        'features.plugins=false',
        '--config',
        'features.apps=false',
        'mcp',
        'list',
        '--json',
      ],
      ['mcp', 'get', 'docs', '--json'],
      ['exec', '--help'],
    ],
    passthroughEnv: {},
    notConfigured(record) {
      assert.equal(record.env.SUBCONSCIOUS_CODEX_LAUNCH, undefined);
      assert.equal(record.catalogPath, undefined);
    },
    refused: [
      [],
      ['login'],
      ['resume', '--last'],
      ['mcp', 'add', 'x', '--', 'cmd'],
      ['app-server', 'daemon', 'start'],
      ['-c', 'x=1', 'features', 'enable', 'apps'],
    ],
    keyCarriers: ['SUBCONSCIOUS_API_KEY'],
    // Codex's OpenAI credential stays empty, so a launch switched back to
    // OpenAI has no key to send.
    unset: [
      'API_KEY',
      'CODEX_API_KEY',
      'SUBCONSCIOUS_BASE_URL',
      'SUBCONSCIOUS_MODEL',
      'SUBC_CONFIG_DIR',
      'SUBC_CODEX_PROTOCOL_LAUNCH',
      'SUBC_CODEX_CATALOG_FILE',
    ],
    // run.sh hands the model metadata to Codex.
    subcNames: ['SUBC_MODEL_METADATA'],
    hostile: async () => ({
      CODEX_API_KEY: 'sk-codex-evil',
      CODEX_EXTERNAL_TOOLS: 'true',
      CODEX_REASONING_EFFORT: 'low',
      CODEX_CONTEXT_WINDOW: '1234',
      MAX_CONCURRENT_SUBAGENTS: '99',
    }),
    steered(record, gateway) {
      assert.equal(record.env.SUBCONSCIOUS_GATEWAY_URL, gateway.url);
      for (const arg of [
        'features.apps=false',
        'features.plugins=false',
        'apps._default.enabled=false',
      ])
        assert.ok(record.args.includes(arg), arg);
      assert.ok(!record.args.includes('model_reasoning_effort=low'));
      assert.ok(
        !record.args.includes('agents.max_concurrent_threads_per_session=99'),
      );
      assert.ok(record.catalog.models.every((m) => m.context_window !== 1234));
      assert.notEqual(record.env.CODEX_EXTERNAL_TOOLS, 'true');
    },
    model: (record) =>
      record.args.find((arg) => arg.startsWith('model='))?.slice(6),
    profileExtra: 'CODEX_REASONING_EFFORT=low\n',
    profileApplied(record) {
      assert.ok(record.args.includes('model_reasoning_effort=low'));
      assert.equal(record.catalog.models[0].slug, MODELS[1]);
    },
    entry: (box) => ({
      driver: 'codex',
      displayName: 'Subconscious (Codex)',
      enabled: true,
      config: {
        setupMode: 'existing',
        binaryPath: box.launcher,
        homePath: box.codexHome,
      },
    }),
    installedFiles: (box) =>
      ['hooks.json', 'subconscious-hook.sh', 'subconscious-hooks.env'].map(
        (name) => path.join(box.codexHome, name),
      ),
    userFiles: (box) => [path.join(box.codexDir, 'config.toml')],
    planLines: (box) => [
      `${box.codexHome} (shared with subc codex)`,
      'read again at each launch',
      'compaction hooks in that Codex home',
    ],
    statusLines: ['2 entries, env file present (mode 600)'],
    async afterKills(box) {
      // A kill during the plan can leave a temp catalog; the next launch
      // removes the old ones, so they stay bounded.
      const entries = await fs.readdir(box.catalogDir);
      assert.ok(
        entries.filter((name) => name !== 'model-catalog.json').length <= 20,
        `temp catalogs are bounded: ${entries.length}`,
      );
    },
  },

  claude: {
    launcher: (box) => box.claudeLauncher,
    // The ~/.local/bin/claude link, not its versioned file.
    binary: (box) => box.claudeBin,
    t3Env: (box, extra) => box.claudeT3Env(extra),
    version: '2.1.326',
    versionOutput: (version) => `${version} (Claude Code)\n`,
    versionArgs: [['--version'], ['-v']],
    tooOld: '2.1.279',
    minimum: '2.1.280',
    configured: [
      '--output-format',
      'stream-json',
      '--verbose',
      '--input-format',
      'stream-json',
    ],
    stdout: () =>
      `${JSON.stringify({ type: 'system', subtype: 'init', fake: 'claude' })}\n`,
    passthrough: [['-h'], ['--help'], ['update']],
    passthroughEnv: { ANTHROPIC_API_KEY: 'sk-ant-t3' },
    notConfigured(record) {
      assert.equal(record.env.ANTHROPIC_AUTH_TOKEN, undefined);
      assert.equal(record.env.ANTHROPIC_BASE_URL, undefined);
    },
    refused: [
      [],
      ['auth', 'login'],
      ['mcp', 'add', 'x', '--', 'cmd', '-p'],
      ['setup-token'],
      ['doctor'],
      ['--resume', 'abc'],
      ['update', 'now'],
    ],
    keyCarriers: ['ANTHROPIC_AUTH_TOKEN', 'OTEL_EXPORTER_OTLP_HEADERS'],
    unset: [
      'ANTHROPIC_API_KEY',
      'API_KEY',
      'CLAUDE_CODE_API_KEY',
      'SUBC_CLAUDE_SETTINGS',
      'SUBCONSCIOUS_MODELS',
      'SUBC_MODEL_METADATA',
    ],
    hostile: async () => ({
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
      OTEL_EXPORTER_OTLP_HEADERS: 'x-api-key=sk-evil-otel',
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'http://127.0.0.1:9/logs',
    }),
    steered({ env }, gateway) {
      assert.equal(env.ANTHROPIC_BASE_URL, gateway.url);
      assert.equal(env.ANTHROPIC_MODEL, MODELS[0]);
      assert.equal(env.ANTHROPIC_SMALL_FAST_MODEL, MODELS[0]);
      for (const name of [
        'CLAUDE_CODE_OAUTH_TOKEN',
        'CLAUDE_CODE_USE_BEDROCK',
        'CLAUDE_CODE_USE_VERTEX',
        'CLAUDE_CODE_USE_FOUNDRY',
        'CLAUDE_GATEWAY_URL',
      ])
        assert.equal(env[name], undefined, name);
      assert.equal(env.CLAUDE_CODE_ENABLE_TELEMETRY, '1');
      assert.equal(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '1000000');
      assert.equal(env.OTEL_EXPORTER_OTLP_HEADERS, `x-api-key=${GOOD_KEY}`);
      assert.equal(
        env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,
        `${gateway.url}/v1/logs`,
      );
    },
    model: (record) => record.env.ANTHROPIC_MODEL,
    profileExtra:
      'CLAUDE_GATEWAY_URL=http://127.0.0.1:1/claude\nCLAUDE_CODE_AUTO_COMPACT_WINDOW=200000\n',
    profileApplied({ env, args }) {
      assert.equal(env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:1/claude');
      assert.equal(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '200000');
      // The model picker in the --settings value leads with the profile model.
      const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
      assert.deepEqual(settings.availableModels, [MODELS[1], MODELS[0]]);
    },
    entry: (box) => ({
      driver: 'claudeAgent',
      displayName: 'Subconscious (Claude)',
      enabled: true,
      config: { binaryPath: box.claudeLauncher },
    }),
    installedFiles: () => [],
    userFiles: (box) => [box.claudeDir, box.claudeJson],
    planLines: () => ['uses your ~/.claude'],
    statusLines: ['uses your ~/.claude'],
  },

  opencode: {
    launcher: (box) => box.opencodeLauncher,
    binary: (box) => box.opencodeBin,
    t3Env: (box, extra) => box.openCodeT3Env(extra),
    version: '2.3.0',
    versionOutput: (version) => `opencode v${version}\n`,
    versionArgs: [['--version'], ['-v']],
    tooOld: '2.0.17',
    minimum: '2.0.18',
    // T3 Code 0.1.11's helper argv (OpenCodeRuntime.ts:601), with port 0 so
    // the fake picks a free port.
    configured: ['serve', '--hostname=127.0.0.1', '--port=0'],
    stdout: () => LISTENING,
    passthrough: [['--help'], ['-h'], ['serve', '--help'], ['serve', '-h']],
    passthroughEnv: { OPENCODE_CONFIG: '/x.json' },
    notConfigured(record) {
      assert.equal(record.env.SUBCONSCIOUS_API_KEY, undefined);
    },
    refused: [
      ['serve', '--service'],
      ['serve', '--hostname=127.0.0.1', '--port=0', '--service'],
      ['serve', '--stdio'],
      ['upgrade'],
      ['upgrade', '--method', 'curl'],
      [],
      ['models'],
      ['run', 'hello'],
      ['serve', '--mdns'],
      ['serve', '--port'],
      ['serve', '--port', '--service'],
      ['serve', '--hostname=127.0.0.1', 'extra'],
      ['serve', '--help', '--service'],
      ['--version', '--help'],
      ['--standalone'],
    ],
    keyCarriers: ['SUBCONSCIOUS_API_KEY'],
    unset: [
      'API_KEY',
      'OPENCODE_API_KEY',
      'SUBC_OPENCODE_API_KEY',
      'GATEWAY_URL',
      'MODEL',
      'SUBCONSCIOUS_MODELS',
      'OPENCODE_CONTEXT_LIMIT',
    ],
    async hostile(box) {
      // A config file that defines a provider that reads the key.
      const extra = path.join(box.root, 'evil opencode.json');
      await fs.writeFile(
        extra,
        JSON.stringify({
          provider: {
            evil: { options: { apiKey: '{env:SUBCONSCIOUS_API_KEY}' } },
          },
        }),
      );
      return {
        SUBC_OPENCODE_API_KEY: 'sk-evil-subc-opencode',
        OPENCODE_API_KEY: 'sk-evil-opencode',
        OPENCODE_CONFIG: extra,
        OPENCODE_CONFIG_DIR: path.join(box.root, 'evil-config-dir'),
        OPENCODE_CONTEXT_LIMIT: '7',
        OPENCODE_OUTPUT_LIMIT: '8',
      };
    },
    steered({ env, config }, gateway) {
      assert.equal(env.SUBCONSCIOUS_GATEWAY_URL, gateway.url);
      for (const name of [
        'OPENCODE_API_KEY',
        'SUBC_OPENCODE_API_KEY',
        'OPENCODE_CONFIG',
        'OPENCODE_CONFIG_DIR',
        'OPENCODE_CONTEXT_LIMIT',
        'OPENCODE_OUTPUT_LIMIT',
      ])
        assert.equal(env[name], undefined, name);
      const provider = config.provider.subconscious;
      assert.equal(provider.options.baseURL, `${gateway.url}/v1`);
      assert.deepEqual(Object.keys(provider.models), MODELS);
      assert.equal(provider.models[MODELS[0]].limit.context, 5000000);
      assert.equal(provider.models[MODELS[0]].limit.output, 65536);
    },
    model: (record) => record.config.model.replace(/^subconscious\//, ''),
    profileExtra: 'OPENCODE_CONTEXT_LIMIT=200000\n',
    profileApplied({ config }) {
      assert.equal(
        config.provider.subconscious.models[MODELS[1]].limit.context,
        200000,
      );
    },
    entry: (box) => ({
      driver: 'opencode',
      displayName: 'Subconscious (OpenCode)',
      enabled: true,
      config: { binaryPath: box.opencodeLauncher },
    }),
    installedFiles: () => [],
    userFiles: (box) => [
      box.opencodeConfigDir,
      box.opencodeDataDir,
      box.opencodeStateDir,
      path.join(box.home, '.cache', 'opencode'),
    ],
    planLines: () => [
      'OpenCode uses your ~/.config/opencode',
      'read again when the helper starts',
      OPENCODE_FRESHNESS,
    ],
    statusLines: ['OpenCode uses your ~/.config/opencode', OPENCODE_FRESHNESS],
  },
};

const PROVIDERS = T3_PROVIDERS.map((provider) => ({
  provider,
  ...FIXTURES[provider.id],
}));

let gateway;
let hung;
const boxes = [];
const installed = {};

/** A sandbox with all three CLIs. */
async function box(options = {}) {
  const sandbox = await t3Sandbox({
    gateway,
    withClaude: true,
    withOpenCode: true,
    ...options,
  });
  boxes.push(sandbox);
  return sandbox;
}

async function installedBox(fixture, options = {}) {
  const sandbox = await box(options);
  const result = await subc(sandbox, [
    't3',
    'install',
    '--provider',
    fixture.provider.id,
  ]);
  assert.equal(result.code, 0, result.stderr);
  return sandbox;
}

/** The env name of a fake agent option, such as FAKE_CODEX_LOG. */
const fake = (fixture, name) =>
  `FAKE_${fixture.provider.binaryName.toUpperCase()}_${name}`;

function launch(fixture, sandbox, args, { log, env = {}, cwd } = {}) {
  return run(fixture.launcher(sandbox), args, {
    env: fixture.t3Env(sandbox, { [fake(fixture, 'LOG')]: log, ...env }),
    cwd,
  });
}

let logs = 0;
const logFile = (sandbox) => path.join(sandbox.root, `launch-${++logs}.log`);
const profileFile = (sandbox) =>
  path.join(sandbox.subc, 'profiles', 'default.env');
const profile = (url, key = GOOD_KEY, extra = '') =>
  `GATEWAY_URL=${url}\nAPI_KEY=${key}\nMODEL=UNSET\n${extra}`;
const readSettings = async (sandbox) =>
  JSON.parse(await fs.readFile(sandbox.settingsPath, 'utf8'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const oneLine = (text) => text.replace(/\s+/g, ' ');

/** Every name in `env` whose value holds the key, sorted. */
const keyHolders = (env) =>
  Object.entries(env)
    .filter(([, value]) => String(value).includes(GOOD_KEY))
    .map(([name]) => name)
    .sort();

/** Each path as a snapshot, its text, or null when it is missing. */
async function contentsOf(paths) {
  const result = {};
  for (const file of paths) {
    const stat = await fs.lstat(file).catch(() => null);
    if (!stat) result[file] = null;
    else if (stat.isDirectory()) result[file] = await snapshot(file);
    else result[file] = await fs.readFile(file, 'utf8');
  }
  return result;
}

function assertStdout(fixture, result, record) {
  const expected = fixture.stdout(record);
  if (expected instanceof RegExp) assert.match(result.stdout, expected);
  else assert.equal(result.stdout, expected);
}

/** True when `part` appears in `whole` in order, with gaps allowed. */
function inOrder(part, whole) {
  let index = 0;
  for (const word of whole) if (word === part[index]) index++;
  return index === part.length;
}

/** Every launcher path in `sandbox` except this provider's. */
const otherLaunchers = (fixture, sandbox) =>
  PROVIDERS.filter((other) => other !== fixture).map((other) =>
    other.launcher(sandbox),
  );

before(async () => {
  if (skip) return;
  gateway = await fakeGateway();
  hung = await fakeGateway();
  hung.delayMs = 60_000;
  for (const fixture of PROVIDERS)
    installed[fixture.provider.id] = await installedBox(fixture);
});

after(async () => {
  for (const sandbox of boxes) await sandbox.cleanup();
  await gateway?.close();
  await hung?.close();
});

for (const fixture of PROVIDERS) {
  const { provider } = fixture;
  const { id, instanceId, displayName, label, launcherName, binaryName } =
    provider;
  const name = (text) => `[${id}] ${text}`;

  test(name('install --dry-run checks everything and writes nothing'), {
    skip,
  }, async () => {
    const sandbox = await box();
    const before = await snapshot(sandbox.home);
    const requests = gateway.requests.length;
    const result = await subc(sandbox, [
      't3',
      'install',
      '--provider',
      id,
      '--dry-run',
    ]);
    assert.equal(result.code, 0, result.stderr);
    const out = oneLine(result.stdout);
    assert.ok(out.includes(`Plan: ${displayName} in T3 Code`), out);
    assert.ok(out.includes(`${fixture.binary(sandbox)} (${fixture.version})`));
    for (const line of fixture.planLines(sandbox))
      assert.ok(out.includes(line), line);
    assert.match(out, /Dry run: nothing was changed/);
    assert.deepEqual(await snapshot(sandbox.home), before);
    assert.ok(gateway.requests.length > requests, 'the live catalog was read');
  });

  test(name('install adds only its own entry and keeps every other setting'), {
    skip,
  }, async () => {
    const builtIns = {
      claudeAgent: { driver: 'claudeAgent', enabled: true },
      codex: { driver: 'codex', enabled: true },
      opencode: {
        driver: 'opencode',
        enabled: true,
        config: { enabled: true, binaryPath: 'opencode' },
      },
    };
    const sandbox = await box({
      settings: `${JSON.stringify(
        {
          projectSettingsFolded: true,
          providerInstances: builtIns,
          futureTopLevelSetting: { keep: [1, 2, 3] },
        },
        null,
        2,
      )}\n`,
    });
    const userBefore = await contentsOf(fixture.userFiles(sandbox));
    const result = await subc(sandbox, ['t3', 'install', '--provider', id]);
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes(`${displayName} is ready in T3 Code`));
    const text = await fs.readFile(sandbox.settingsPath, 'utf8');
    const settings = JSON.parse(text);
    assert.match(text, /^\{\n {2}"projectSettingsFolded"/, 'the indent');
    assert.deepEqual(Object.keys(settings), [
      'projectSettingsFolded',
      'providerInstances',
      'futureTopLevelSetting',
    ]);
    assert.deepEqual(settings.futureTopLevelSetting, { keep: [1, 2, 3] });
    assert.deepEqual(settings.providerInstances, {
      ...builtIns,
      [instanceId]: fixture.entry(sandbox),
    });
    assert.deepEqual(
      Object.keys(settings.providerInstances).at(-1),
      instanceId,
    );
    assert.equal((await fs.stat(sandbox.settingsPath)).mode & 0o777, 0o644);

    const launcherPath = fixture.launcher(sandbox);
    assert.equal((await fs.stat(launcherPath)).mode & 0o777, 0o755);
    for (const other of otherLaunchers(fixture, sandbox))
      await assert.rejects(fs.lstat(other), other);
    const launcher = await fs.readFile(launcherPath, 'utf8');
    assert.ok(launcher.startsWith(`${LAUNCHER_SHEBANG}\n`));
    assert.ok(
      launcher.includes(`\nsubc_${binaryName}='${fixture.binary(sandbox)}'\n`),
      launcher,
    );
    assert.ok(
      launcher.includes(`${provider.binaryFlag} "$subc_${binaryName}"`),
    );
    for (const where of [launcher, text, result.stdout, result.stderr])
      assert.ok(!where.includes(GOOD_KEY), 'no key');
    // The version check ran in a throwaway home.
    assert.deepEqual(await contentsOf(fixture.userFiles(sandbox)), userBefore);
  });

  test(name('a second install changes nothing'), { skip }, async () => {
    const sandbox = await installedBox(fixture);
    const files = [
      sandbox.settingsPath,
      fixture.launcher(sandbox),
      ...fixture.installedFiles(sandbox),
    ];
    const mtimes = () =>
      Promise.all(files.map(async (file) => (await fs.stat(file)).mtimeMs));
    const backupDir = path.join(sandbox.subc, 't3', 'backups');
    const before = await mtimes();
    const backups = await fs.readdir(backupDir);
    const result = await subc(sandbox, ['t3', 'install', '--provider', id]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /already set up/);
    assert.deepEqual(await mtimes(), before);
    assert.deepEqual(await fs.readdir(backupDir), backups);
  });

  test(name('uninstall removes only its own entry and launcher'), {
    skip,
  }, async () => {
    const sandbox = await box();
    const all = await subc(sandbox, ['t3', 'install']);
    assert.equal(all.code, 0, all.stderr);
    const settings = await readSettings(sandbox);
    const userBefore = await contentsOf(fixture.userFiles(sandbox));
    const requests = gateway.requests.length;
    const result = await subc(sandbox, ['t3', 'uninstall', '--provider', id]);
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes(`Removed ${instanceId}`), result.stdout);
    assert.equal(gateway.requests.length, requests, 'no network request');
    await assert.rejects(fs.lstat(fixture.launcher(sandbox)));
    for (const other of otherLaunchers(fixture, sandbox))
      await fs.access(other);
    const left = await readSettings(sandbox);
    const { [instanceId]: removed, ...others } = settings.providerInstances;
    assert.ok(removed);
    assert.deepEqual(left.providerInstances, others);
    assert.deepEqual(left.futureTopLevelSetting, { keep: [1, 2, 3] });
    assert.deepEqual(await contentsOf(fixture.userFiles(sandbox)), userBefore);

    const again = await subc(sandbox, ['t3', 'uninstall', '--provider', id]);
    assert.equal(again.code, 0, again.stderr);
    const status = await subc(sandbox, ['t3', 'status', '--provider', id]);
    assert.ok(status.stdout.includes(`${instanceId}: not installed`));
    assert.ok(status.stdout.includes(`${launcherName}: missing`));
  });

  test(name('an entry that subc did not write blocks install'), {
    skip,
  }, async () => {
    const sandbox = await box({
      settings: `${JSON.stringify({
        providerInstances: {
          [instanceId]: {
            driver: provider.driver,
            enabled: true,
            config: { binaryPath: `/usr/local/bin/${binaryName}` },
          },
        },
      })}\n`,
    });
    const settings = await fs.readFile(sandbox.settingsPath, 'utf8');
    const result = await subc(sandbox, ['t3', 'install', '--provider', id]);
    assert.equal(result.code, 1);
    assert.ok(
      result.stderr.includes(`${instanceId} that subc did not create`),
      result.stderr,
    );
    assert.equal(await fs.readFile(sandbox.settingsPath, 'utf8'), settings);
    await assert.rejects(fs.access(fixture.launcher(sandbox)));
    const status = await subc(sandbox, ['t3', 'status']);
    assert.equal(status.code, 1, status.stdout);
    assert.ok(status.stdout.includes(`${instanceId}: conflict`));
    assert.match(status.stdout, /an entry that subc did not write/);
    // Uninstall leaves the foreign entry alone.
    const removed = await subc(sandbox, ['t3', 'uninstall', '--provider', id]);
    assert.equal(removed.code, 0, removed.stderr);
    assert.equal(await fs.readFile(sandbox.settingsPath, 'utf8'), settings);
  });

  test(name('status reports drift, and install repairs it'), {
    skip,
  }, async () => {
    const sandbox = await installedBox(fixture);
    const settings = await readSettings(sandbox);
    const entry = settings.providerInstances[instanceId];
    entry.displayName = 'Renamed';
    // Each cleared field changes how T3 Code starts the agent.
    for (const field of provider.clearedFields)
      entry.config[field] = 'set in T3 Code';
    // Fields that subc does not manage stay as the user set them.
    entry.config.customModels = [{ slug: 'mine' }];
    entry.accentColor = '#123456';
    await fs.writeFile(sandbox.settingsPath, JSON.stringify(settings));
    const status = await subc(sandbox, ['t3', 'status']);
    assert.equal(status.code, 1, status.stdout);
    const drift = new RegExp(
      `${instanceId}: installed, changed in T3 \\(([^)]*)\\); run subc t3 install --provider ${id}`,
    ).exec(status.stdout);
    assert.ok(drift, status.stdout);
    assert.deepEqual(
      drift[1].split(', ').sort(),
      ['displayName', ...provider.clearedFields].sort(),
    );
    assert.ok(
      status.stdout.includes(`Broken: ${displayName}: drift in displayName`),
    );
    assert.ok(
      status.stdout.includes(
        `To repair it, run: subc t3 install --provider ${id}\n`,
      ),
    );
    assert.ok(!status.stdout.includes(GOOD_KEY));

    const result = await subc(sandbox, ['t3', 'install', '--provider', id]);
    assert.equal(result.code, 0, result.stderr);
    const expected = fixture.entry(sandbox);
    assert.deepEqual(
      (await readSettings(sandbox)).providerInstances[instanceId],
      {
        ...expected,
        config: { ...expected.config, customModels: [{ slug: 'mine' }] },
        accentColor: '#123456',
      },
    );
    const fixed = await subc(sandbox, ['t3', 'status']);
    assert.equal(fixed.code, 0, fixed.stdout);
    assert.ok(fixed.stdout.includes(`${instanceId}: installed\n`));
  });

  test(name('status flags a missing, foreign, or orphaned launcher'), {
    skip,
  }, async () => {
    const sandbox = await installedBox(fixture);
    const launcherPath = fixture.launcher(sandbox);
    const broken = async (reason) => {
      const result = await subc(sandbox, ['t3', 'status']);
      assert.equal(result.code, 1, result.stdout);
      assert.ok(
        result.stdout.includes(`Broken: ${displayName}: ${reason}`),
        result.stdout,
      );
      return result;
    };
    await fs.rm(launcherPath);
    const missing = await broken('launcher missing');
    // The repair names this provider alone.
    assert.ok(
      missing.stdout.includes(
        `To repair it, run: subc t3 install --provider ${id}\n`,
      ),
    );
    // Install writes the missing launcher again.
    const repaired = await subc(sandbox, ['t3', 'install', '--provider', id]);
    assert.equal(repaired.code, 0, repaired.stderr);
    const current = await subc(sandbox, ['t3', 'status', '--provider', id]);
    assert.equal(current.code, 0, current.stdout);
    assert.ok(current.stdout.includes(`${launcherName}: current`));
    await fs.writeFile(launcherPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    await broken('launcher foreign');

    const orphan = await installedBox(fixture);
    const settings = await readSettings(orphan);
    delete settings.providerInstances[instanceId];
    await fs.writeFile(orphan.settingsPath, JSON.stringify(settings));
    const result = await subc(orphan, ['t3', 'status']);
    assert.equal(result.code, 1, result.stdout);
    assert.match(result.stdout, /a launcher with no entry in T3 Code/);
  });

  test(name(
    'status reports a stale or broken launcher, and install rewrites it',
  ), {
    skip,
  }, async () => {
    const sandbox = await installedBox(fixture);
    const launcherPath = fixture.launcher(sandbox);
    const current = await fs.readFile(launcherPath, 'utf8');
    const status = () => subc(sandbox, ['t3', 'status', '--provider', id]);
    // A launcher that another subc version wrote is stale.
    await fs.writeFile(
      launcherPath,
      current.replace(/\(subconscious-cli [^)]+\)/, '(subconscious-cli 0.0.1)'),
    );
    assert.match((await status()).stdout, /stale \(written by subc 0\.0\.1/);
    // The 8.2.0 launcher format, from this subc version.
    await fs.writeFile(
      launcherPath,
      current
        .replace(`${LAUNCHER_SHEBANG}\n`, '#!/usr/bin/env bash\n')
        .replace('unset BASH_ENV ENV\n', ''),
    );
    assert.match(
      (await status()).stdout,
      /stale \(written in an older format\); run subc t3 install/,
    );
    const result = await subc(sandbox, ['t3', 'install', '--provider', id]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(await fs.readFile(launcherPath, 'utf8'), current);
    assert.ok((await status()).stdout.includes(`${launcherName}: current`));

    // A pinned binary that is gone makes the launcher broken.
    const binary = fixture.binary(sandbox);
    await fs.rename(binary, `${binary}.moved`);
    try {
      const gone = await status();
      assert.equal(gone.code, 1, gone.stdout);
      assert.ok(gone.stdout.includes(`broken: pinned ${binaryName} missing`));
      const started = await launch(fixture, sandbox, fixture.configured);
      assert.equal(started.code, 69);
      assert.match(started.stderr, /Run subc t3 install again/);
    } finally {
      await fs.rename(`${binary}.moved`, binary);
    }
  });

  test(name(
    '--provider installs only that provider, and the others keep working',
  ), {
    skip,
  }, async () => {
    const sandbox = await box();
    const others = PROVIDERS.filter((other) => other !== fixture);
    const first = await subc(sandbox, [
      't3',
      'install',
      ...others.flatMap((other) => ['--provider', other.provider.id]),
    ]);
    assert.equal(first.code, 0, first.stderr);
    const before = (await readSettings(sandbox)).providerInstances;
    assert.equal(before[instanceId], undefined);
    const result = await subc(sandbox, [
      't3',
      'install',
      `--provider=${id}`,
      '--provider',
      id,
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes(`Installing: ${displayName} in T3 Code`));
    for (const other of others)
      assert.ok(!result.stdout.includes(other.provider.displayName));
    const after = (await readSettings(sandbox)).providerInstances;
    assert.deepEqual(Object.keys(after), [...Object.keys(before), instanceId]);
    for (const key of Object.keys(before))
      assert.deepEqual(after[key], before[key], key);

    // Each launcher still starts its own agent, with only its own carriers
    // holding the key.
    for (const each of PROVIDERS) {
      const log = logFile(sandbox);
      const launched = await launch(each, sandbox, each.configured, { log });
      assert.equal(launched.code, 0, `${each.provider.id}: ${launched.stderr}`);
      const [record] = await readRecords(log);
      assert.deepEqual(keyHolders(record.env), each.keyCarriers);
    }
  });

  test(name('a CLI older than the minimum is refused by install and status'), {
    skip,
  }, async () => {
    const sandbox = await box();
    const before = await snapshot(sandbox.home);
    const old = { [fake(fixture, 'VERSION')]: fixture.tooOld };
    const refused = await subc(
      sandbox,
      ['t3', 'install', '--provider', id],
      old,
    );
    assert.equal(refused.code, 1);
    assert.ok(
      oneLine(refused.stderr).includes(
        `${label} ${fixture.tooOld} is older than ${fixture.minimum}, the oldest version this provider supports`,
      ),
      refused.stderr,
    );
    assert.deepEqual(await snapshot(sandbox.home), before);
    const oldest = await subc(
      sandbox,
      ['t3', 'install', '--provider', id, '--dry-run'],
      { [fake(fixture, 'VERSION')]: fixture.minimum },
    );
    assert.equal(oldest.code, 0, oldest.stderr);

    const pinned = await installedBox(fixture);
    const status = await subc(pinned, ['t3', 'status', '--provider', id], old);
    assert.equal(status.code, 1, status.stdout);
    assert.ok(
      status.stdout.includes(
        `(${fixture.tooOld}) is older than ${fixture.minimum}`,
      ),
    );
    assert.match(status.stdout, /a CLI version that install refuses/);
  });

  test(name('without --provider, a missing or old CLI is skipped'), {
    skip,
  }, async () => {
    const sandbox = await box();
    const old = { [fake(fixture, 'VERSION')]: fixture.tooOld };
    const result = await subc(sandbox, ['t3', 'install'], old);
    assert.equal(result.code, 0, result.stderr);
    assert.ok(
      oneLine(result.stdout).includes(
        `${displayName}: ${label} ${fixture.tooOld} is older than ${fixture.minimum}`,
      ),
      result.stdout,
    );
    for (const other of PROVIDERS.filter((each) => each !== fixture))
      assert.ok(
        result.stdout.includes(`${other.provider.displayName} is ready`),
      );
    assert.equal(
      (await readSettings(sandbox)).providerInstances[instanceId],
      undefined,
    );
    await assert.rejects(fs.lstat(fixture.launcher(sandbox)));

    // --provider stays strict: one refused provider stops the whole install.
    const other = PROVIDERS.find((each) => each !== fixture).provider.id;
    const before = await snapshot(sandbox.home);
    const named = await subc(
      sandbox,
      ['t3', 'install', '--provider', other, '--provider', id],
      old,
    );
    assert.equal(named.code, 1);
    assert.ok(
      named.stderr.includes(`${displayName}: ${label} ${fixture.tooOld}`),
    );
    assert.match(named.stderr, /Nothing was changed\./);
    assert.deepEqual(await snapshot(sandbox.home), before);

    // A missing CLI is skipped the same way.
    const bare = await box();
    await fs.rm(fixture.binary(bare));
    const missing = `${label} CLI is not installed`;
    const dry = await subc(bare, ['t3', 'install', '--dry-run']);
    assert.equal(dry.code, 0, dry.stderr);
    assert.ok(oneLine(dry.stdout).includes(`${displayName}: ${missing}`));
    const strict = await subc(bare, ['t3', 'install', '--provider', id]);
    assert.equal(strict.code, 1);
    assert.ok(strict.stderr.includes(missing), strict.stderr);
  });

  test(name('status lists the provider offline, with no key'), {
    skip,
  }, async () => {
    const sandbox = await installedBox(fixture);
    await fs.writeFile(
      profileFile(sandbox),
      'GATEWAY_URL=http://127.0.0.1:9\nMODEL=not a model!\n',
    );
    const userBefore = await contentsOf(fixture.userFiles(sandbox));
    const requests = gateway.requests.length;
    const status = await subc(sandbox, ['t3', 'status']);
    assert.equal(status.code, 0, status.stdout);
    const out = oneLine(status.stdout);
    assert.ok(out.includes(displayName));
    assert.ok(out.includes(`${instanceId}: installed`));
    assert.ok(out.includes(`${launcherName}: current`));
    assert.ok(out.includes(`${fixture.binary(sandbox)} (${fixture.version})`));
    for (const line of fixture.statusLines) assert.ok(out.includes(line), line);
    for (const other of PROVIDERS.filter((each) => each !== fixture))
      assert.ok(out.includes(`${other.provider.instanceId}: not installed`));
    assert.equal(gateway.requests.length, requests, 'no network request');
    assert.deepEqual(await contentsOf(fixture.userFiles(sandbox)), userBefore);
  });

  test(name("status reports T3 Code's last check of the provider"), {
    skip,
  }, async () => {
    const sandbox = await installedBox(fixture);
    const status = () => subc(sandbox, ['t3', 'status', '--provider', id]);
    const cache = (options) =>
      writeT3ModelCache(sandbox, {
        instanceId,
        builtIns: [],
        reported: MODELS,
        ...options,
      });
    // No cache yet: T3 Code has not checked the provider. That is not broken.
    const fresh = await status();
    assert.equal(fresh.code, 0, fresh.stdout);
    assert.match(fresh.stdout, /T3 check\s+none recorded yet/);

    await cache({ checkedAt: '2026-11-23T19:40:00.000Z' });
    const ready = await status();
    assert.equal(ready.code, 0, ready.stdout);
    assert.match(
      ready.stdout,
      /T3 check\s+ready, checked 2026-11-23T19:40:00\.000Z/,
    );

    // A warning with a signed-in account is not about the key.
    await cache({
      status: 'warning',
      message: 'The CLI is older than T3 Code recommends.',
    });
    const warned = await status();
    assert.equal(warned.code, 0, warned.stdout);
    assert.match(warned.stdout, /T3 check\s+warning, checked .*older than/);
    assert.doesNotMatch(warned.stdout, /run subc login/);

    // T3 Code reports a rejected key as an error, or as a warning without
    // a signed-in account.
    for (const [state, message] of [
      ['error', `${launcherName}: Model discovery returned HTTP 401.`],
      ['warning', 'The CLI failed while checking account status.'],
    ]) {
      await cache({ status: state, auth: { status: 'unknown' }, message });
      const failed = await status();
      assert.equal(failed.code, 1, failed.stdout);
      assert.ok(
        oneLine(failed.stdout).includes(`${state}, checked `) &&
          failed.stdout.includes(message),
        failed.stdout,
      );
      assert.match(failed.stdout, /run subc login/);
      assert.match(failed.stdout, /restart T3 Code/);
      assert.ok(
        failed.stdout.includes(
          `Broken: ${displayName}: T3 Code reports a failed check.`,
        ),
      );
      // Install cannot fix a rejected key, so status does not suggest it.
      assert.doesNotMatch(failed.stdout, /To repair it, run/);
    }
  });

  test(name(
    'a launch prints only the agent output, as the process T3 Code started',
  ), {
    skip,
  }, async () => {
    const sandbox = installed[id];
    const userBefore = await contentsOf(fixture.userFiles(sandbox));
    const log = logFile(sandbox);
    const result = await launch(fixture, sandbox, fixture.configured, { log });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, '');
    const [record] = await readRecords(log);
    assertStdout(fixture, result, record);
    assert.equal(record.pid, result.pid);
    assert.ok(inOrder(fixture.configured, record.args), record.args.join(' '));
    assert.equal(record.env.HOME, sandbox.home);
    assert.deepEqual(await contentsOf(fixture.userFiles(sandbox)), userBefore);
  });

  test(name('only the allowed names carry the key'), { skip }, async () => {
    const sandbox = await installedBox(fixture);
    // Profile lines can hold more copies of the key, under any name.
    await fs.appendFile(
      profileFile(sandbox),
      PROFILE_COPIES.map((key) => `${key}=${GOOD_KEY}\n`).join(''),
    );
    const log = logFile(sandbox);
    const result = await launch(fixture, sandbox, fixture.configured, { log });
    assert.equal(result.code, 0, result.stderr);
    const [record] = await readRecords(log);
    assert.deepEqual(keyHolders(record.env), [...fixture.keyCarriers].sort());
    for (const key of fixture.unset)
      assert.equal(record.env[key], undefined, key);
    assert.ok(
      Object.keys(record.env).every(
        (key) => !key.startsWith('SUBC_') || fixture.subcNames?.includes(key),
      ),
      'no SUBC_* name reaches the agent',
    );
    assert.ok(
      !JSON.stringify([record.args, record.config ?? null]).includes(GOOD_KEY),
      'no key in argv or config',
    );
    assert.ok(!result.stdout.includes(GOOD_KEY), 'no key in stdout');
    assert.ok(!result.stderr.includes(GOOD_KEY), 'no key in stderr');
    const launcher = await fs.readFile(fixture.launcher(sandbox), 'utf8');
    assert.ok(!launcher.includes(GOOD_KEY), 'no key in the launcher');
    const settings = await fs.readFile(sandbox.settingsPath, 'utf8');
    assert.ok(!settings.includes(GOOD_KEY), 'no key in T3 Code settings');
  });

  test(name('a hostile T3 Code env cannot steer the launch'), {
    skip,
  }, async () => {
    const sandbox = installed[id];
    const log = logFile(sandbox);
    const requests = gateway.requests.length;
    const result = await launch(fixture, sandbox, fixture.configured, {
      log,
      env: {
        SUBCONSCIOUS_API_KEY: 'sk-inherited-evil',
        SUBCONSCIOUS_BASE_URL: 'http://127.0.0.1:9/evil',
        SUBCONSCIOUS_GATEWAY_URL: 'http://127.0.0.1:9/evil',
        SUBCONSCIOUS_MODELS: 'evil/pinned-model',
        SUBCONSCIOUS_MODEL: 'evil/model',
        SUBC_CONFIG_DIR: path.join(sandbox.root, 'evil-config'),
        SUBC_MODEL_METADATA: '[]',
        API_KEY: 'sk-evil-api-key',
        GATEWAY_URL: 'http://127.0.0.1:9/evil-gateway',
        MODEL: 'evil/model',
        ...(await fixture.hostile(sandbox)),
      },
    });
    assert.equal(result.code, 0, result.stderr);
    const [record] = await readRecords(log);
    assert.equal(record.env.SUBCONSCIOUS_API_KEY ?? GOOD_KEY, GOOD_KEY);
    assert.equal(fixture.model(record), MODELS[0]);
    fixture.steered(record, gateway);
    const values = `${Object.values(record.env).join('\n')}\n${JSON.stringify(record.config ?? null)}`;
    assert.ok(!values.includes('evil'), 'no hostile value reached the agent');
    const launches = gateway.requests.slice(requests);
    assert.ok(launches.length > 0);
    assert.ok(
      launches.every(
        (request) => request.authorization === `Bearer ${GOOD_KEY}`,
      ),
      'only the profile key reached the gateway',
    );
  });

  test(name('a printing BASH_ENV or an exported shell function never runs'), {
    skip,
  }, async () => {
    const sandbox = installed[id];
    const startup = path.join(sandbox.root, `startup ${id}.sh`);
    await fs.writeFile(startup, 'echo "hello from BASH_ENV"\n');
    const marker = path.join(sandbox.root, `${id}-function-ran`);
    const env = {
      BASH_ENV: startup,
      ENV: startup,
      ...exportedFunctions(marker),
    };
    const log = logFile(sandbox);
    const result = await launch(fixture, sandbox, fixture.configured, {
      log,
      env,
    });
    assert.equal(result.code, 0, result.stderr);
    const [record] = await readRecords(log);
    assertStdout(fixture, result, record);
    assert.equal(record.env.BASH_ENV, undefined);
    assert.equal(record.env.ENV, undefined);
    const version = await launch(fixture, sandbox, ['--version'], { env });
    assert.equal(version.code, 0, version.stderr);
    assert.equal(version.stdout, fixture.versionOutput(fixture.version));
    await assert.rejects(fs.lstat(marker), { code: 'ENOENT' });
  });

  test(name('a BASH_ENV line in the default profile never reaches the agent'), {
    skip,
  }, async () => {
    const sandbox = await installedBox(fixture);
    const startup = path.join(sandbox.root, 'profile startup.sh');
    await fs.writeFile(startup, 'echo "hello from the profile BASH_ENV"\n');
    await fs.writeFile(
      profileFile(sandbox),
      profile(gateway.url, GOOD_KEY, `BASH_ENV=${startup}\nENV=${startup}\n`),
      { mode: 0o600 },
    );
    const log = logFile(sandbox);
    const result = await launch(fixture, sandbox, fixture.configured, { log });
    assert.equal(result.code, 0, result.stderr);
    const [record] = await readRecords(log);
    assertStdout(fixture, result, record);
    assert.equal(record.env.BASH_ENV, undefined);
    assert.equal(record.env.ENV, undefined);
  });

  test(name(
    'passthrough commands run the real CLI offline, without the profile',
  ), {
    skip,
  }, async () => {
    const sandbox = await installedBox(fixture);
    const requests = gateway.requests.length;
    const before = await snapshot(sandbox.subc);
    for (const args of fixture.versionArgs) {
      const result = await launch(fixture, sandbox, args);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, fixture.versionOutput(fixture.version));
    }
    const extra = { SUBCONSCIOUS_MODEL: 'x', ...fixture.passthroughEnv };
    for (const args of fixture.passthrough) {
      const log = logFile(sandbox);
      const result = await launch(fixture, sandbox, args, { log, env: extra });
      assert.equal(result.code, 0, `${args.join(' ')}: ${result.stderr}`);
      const [record] = await readRecords(log);
      assert.deepEqual(record.args, args);
      // T3 Code's env reaches the CLI as it was: no Subconscious launch.
      const expected = fixture.t3Env(sandbox, {
        [fake(fixture, 'LOG')]: log,
        ...extra,
      });
      for (const [key, value] of Object.entries(expected))
        if (key !== 'PATH') assert.equal(record.env[key], value, key);
      fixture.notConfigured(record);
    }
    assert.equal(gateway.requests.length, requests, 'no network request');
    assert.deepEqual(await snapshot(sandbox.subc), before, 'no file written');

    // A passthrough never reads the profile, so a broken one cannot stop it.
    await fs.writeFile(profileFile(sandbox), 'MODEL=not a model!\n');
    const result = await launch(fixture, sandbox, ['--version']);
    assert.equal(result.code, 0, result.stderr);
  });

  test(name('other commands are refused before the agent runs'), {
    skip,
  }, async () => {
    const sandbox = installed[id];
    const requests = gateway.requests.length;
    const refusal = new RegExp(
      `^${launcherName}: \`${binaryName} .*\` is not available through the Subconscious provider\\. Run ${binaryName} directly for it\\.\\n$`,
    );
    const adapter = fileURLToPath(
      new URL(`../bin/${provider.adapterFile}`, import.meta.url),
    );
    for (const args of fixture.refused) {
      const log = logFile(sandbox);
      const result = await launch(fixture, sandbox, args, { log });
      // The launcher reads the plan through a process substitution, so it
      // exits 1 for any adapter failure.
      assert.equal(result.code, 1, args.join(' '));
      assert.equal(result.stdout, '');
      assert.match(result.stderr, refusal);
      assert.deepEqual(await readRecords(log), []);
      // The adapter itself exits 64 (EX_USAGE).
      const direct = await run(
        process.execPath,
        [
          adapter,
          provider.binaryFlag,
          fixture.binary(sandbox),
          '--config-dir',
          sandbox.subc,
          '--',
          ...args,
        ],
        { env: fixture.t3Env(sandbox, { [fake(fixture, 'LOG')]: log }) },
      );
      assert.equal(direct.code, 64, args.join(' '));
      assert.equal(direct.stdout, '');
    }
    assert.equal(gateway.requests.length, requests, 'no network request');
  });

  test(name('a rejected key, no key, or no catalog stops the launch'), {
    skip,
  }, async () => {
    const sandbox = await installedBox(fixture);
    const log = logFile(sandbox);
    const stopped = async (text, pattern) => {
      await fs.writeFile(profileFile(sandbox), text);
      const started = Date.now();
      const result = await launch(fixture, sandbox, fixture.configured, {
        log,
      });
      assert.equal(result.code, 1, result.stderr);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, pattern);
      assert.ok(!result.stderr.includes('sk-rejected-key'));
      assert.ok(!result.stderr.includes(GOOD_KEY));
      return Date.now() - started;
    };
    await stopped(
      profile(gateway.url, 'sk-rejected-key'),
      /did not return the model catalog for this key/,
    );
    // No packaged or public fallback.
    await stopped(
      profile('http://127.0.0.1:9'),
      /Could not read the model catalog/,
    );
    await stopped(`GATEWAY_URL=${gateway.url}\n`, /no saved API key/);
    // A gateway that never answers stops the launch at the 4 s deadline,
    // well inside T3 Code's start limit.
    const ms = await stopped(
      profile(hung.url),
      /Could not read the model catalog from http:\/\/127\.0\.0\.1:\d+ within 4 s\./,
    );
    assert.ok(ms < 5000, `${ms} ms`);
    assert.deepEqual(await readRecords(log), []);
  });

  test(name('each launch reads the default profile again'), {
    skip,
  }, async () => {
    const sandbox = await installedBox(fixture);
    const log = logFile(sandbox);
    const first = await launch(fixture, sandbox, fixture.configured, { log });
    assert.equal(first.code, 0, first.stderr);
    await fs.writeFile(
      profileFile(sandbox),
      `GATEWAY_URL=${gateway.url}\nAPI_KEY=${GOOD_KEY}\nMODEL=${MODELS[1]}\n${fixture.profileExtra}`,
    );
    const second = await launch(fixture, sandbox, fixture.configured, { log });
    assert.equal(second.code, 0, second.stderr);
    const [before, after] = await readRecords(log);
    assert.equal(fixture.model(before), MODELS[0]);
    assert.equal(fixture.model(after), MODELS[1]);
    fixture.profileApplied(after);
  });

  test(name('killing the launcher 200 times leaves no process behind'), {
    skip,
    timeout: 240_000,
  }, async () => {
    const sandbox = await installedBox(fixture);
    const cycle = async (i) => {
      const child = spawn(fixture.launcher(sandbox), fixture.configured, {
        env: fixture.t3Env(sandbox, { [fake(fixture, 'SLEEP')]: '60000' }),
        stdio: ['pipe', 'ignore', 'ignore'],
      });
      // Most kills land while Node computes the plan; every fourth lands
      // after the exec, when the process T3 Code started is the agent.
      const delay = i % 4 === 0 ? 700 + (i % 7) * 50 : (i * 7) % 90;
      await sleep(delay);
      const exited = new Promise((resolve) => child.on('exit', resolve));
      child.kill('SIGKILL');
      await exited;
    };
    for (let start = 0; start < 200; start += 20)
      await Promise.all(
        Array.from({ length: 20 }, (_, offset) => cycle(start + offset)),
      );
    const left = () =>
      execFileSync('ps', ['-Ao', 'pid=,command='], { encoding: 'utf8' })
        .split('\n')
        .filter((row) => row.includes(sandbox.root) && !row.includes('ps -Ao'));
    // A watchdog notices a killed helper within 2 s.
    let rows = left();
    for (let waited = 0; rows.length && waited < 10_000; waited += 100) {
      await sleep(100);
      rows = left();
    }
    assert.deepEqual(rows, []);
    await fixture.afterKills?.(sandbox);
  });
}
