/**
 * The checks that every `subc t3` provider must pass, run once per provider:
 * the install round trip, and where the key and T3 Code's env may reach the
 * agent. Each provider supplies a fixture. Shared code that does not depend
 * on the provider is tested once, in t3.test.js and t3-settings.test.js.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
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
} from './helpers/t3-sandbox.js';

const skip = process.platform === 'win32';
// Names under which a profile line can hold another copy of the key.
const PROFILE_COPIES = [
  'EXTRA_COPY',
  'OPENCODE_API_KEY',
  'SUBC_OPENCODE_API_KEY',
];
// Profile lines that hold other secrets, such as an old OpenCode key or
// another agent's key. A tool shell that ran opencode would send the first
// to opencode.ai.
const PROFILE_SECRETS = {
  OPENCODE_API_KEY: 'sk-old-opencode-key',
  PI_API_KEY: 'sk-other-pi-key',
  GITHUB_TOKEN: 'ghp-other-token',
};

/** What each provider brings to the shared checks. */
const FIXTURES = {
  codex: {
    launcher: (box) => box.launcher,
    binary: (box) => path.join(box.bin, 'codex'),
    t3Env: (box, extra) => box.t3Env(extra),
    versionOutput: 'codex-cli 0.167.2\n',
    configured: ['app-server'],
    stdout: (record) =>
      `${JSON.stringify({ fake: 'codex', args: record.args })}\n`,
    // A leading -c does not hide the command.
    passthrough: [
      ['--help'],
      ['-c', 'features.plugins=false', 'mcp', 'list', '--json'],
      ['app-server', 'generate-json-schema', '--out', '/tmp/x'],
    ],
    notConfigured: (record) => assert.equal(record.catalogPath, undefined),
    refused: [
      [],
      ['login'],
      ['app-server', 'daemon', 'start'],
      ['-c', 'x=1', 'features', 'enable', 'apps'],
    ],
    keyCarriers: ['SUBCONSCIOUS_API_KEY'],
    // Codex's OpenAI credential stays empty, so a launch switched back to
    // OpenAI has no key to send.
    unset: ['API_KEY', 'CODEX_API_KEY', 'SUBC_CONFIG_DIR'],
    // run.sh hands the model metadata to Codex.
    subcNames: ['SUBC_MODEL_METADATA'],
    hostile: async () => ({
      CODEX_API_KEY: 'sk-codex-evil',
      CODEX_EXTERNAL_TOOLS: 'true',
      CODEX_REASONING_EFFORT: 'low',
    }),
    steered(record, gateway) {
      assert.equal(record.env.SUBCONSCIOUS_GATEWAY_URL, gateway.url);
      assert.ok(record.args.includes('features.apps=false'));
      assert.ok(!record.args.includes('model_reasoning_effort=low'));
    },
    model: (record) =>
      record.args.find((arg) => arg.startsWith('model='))?.slice(6),
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
    userFiles: (box) => [box.codexDir],
  },

  claude: {
    launcher: (box) => box.claudeLauncher,
    // The ~/.local/bin/claude link, not its versioned file.
    binary: (box) => box.claudeBin,
    t3Env: (box, extra) => box.claudeT3Env(extra),
    versionOutput: '2.1.326 (Claude Code)\n',
    configured: [
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
    ],
    stdout: () =>
      `${JSON.stringify({ type: 'system', subtype: 'init', fake: 'claude' })}\n`,
    passthrough: [['--help'], ['update']],
    notConfigured: (record) =>
      assert.equal(record.env.ANTHROPIC_AUTH_TOKEN, undefined),
    refused: [
      [],
      ['auth', 'login'],
      ['mcp', 'add', 'x', '--', 'cmd', '-p'],
      ['auth', 'login', '--print'],
      ['plugin', 'install', 'x', '-p'],
    ],
    keyCarriers: ['ANTHROPIC_AUTH_TOKEN'],
    unset: ['ANTHROPIC_API_KEY', 'API_KEY', 'CLAUDE_CODE_API_KEY'],
    hostile: async () => ({
      ANTHROPIC_API_KEY: 'sk-ant-evil',
      ANTHROPIC_AUTH_TOKEN: 'sk-ant-evil-token',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:9/evil',
      ANTHROPIC_MODEL: 'claude-opus-5-5',
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-evil',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_USE_GATEWAY: '1',
      CLAUDE_CODE_USE_MANTLE: '1',
      CLAUDE_CODE_SKIP_MANTLE_AUTH: '1',
      CLAUDE_CODE_API_BASE_URL: 'http://127.0.0.1:9/evil-api',
      CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
      CLAUDE_GATEWAY_URL: 'http://127.0.0.1:9/evil-claude',
      COMPACT_WINDOW: '123456',
    }),
    steered({ env }, gateway) {
      assert.equal(env.ANTHROPIC_BASE_URL, gateway.url);
      for (const name of [
        'CLAUDE_CODE_OAUTH_TOKEN',
        'CLAUDE_CODE_USE_BEDROCK',
        'CLAUDE_CODE_USE_GATEWAY',
        'CLAUDE_CODE_USE_MANTLE',
        'CLAUDE_CODE_SKIP_MANTLE_AUTH',
        'CLAUDE_CODE_API_BASE_URL',
        'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST',
      ])
        assert.equal(env[name], undefined, name);
      assert.equal(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '1000000');
    },
    model: (record) => record.env.ANTHROPIC_MODEL,
    entry: (box) => ({
      driver: 'claudeAgent',
      displayName: 'Subconscious (Claude)',
      enabled: true,
      config: { binaryPath: box.claudeLauncher },
    }),
    userFiles: (box) => [box.claudeDir, box.claudeJson],
  },

  opencode: {
    launcher: (box) => box.opencodeLauncher,
    binary: (box) => box.opencodeBin,
    t3Env: (box, extra) => box.openCodeT3Env(extra),
    versionOutput: 'opencode v2.3.0\n',
    configured: ['serve', '--hostname=127.0.0.1', '--port=0'],
    stdout: () => /^server listening on http:\/\/127\.0\.0\.1:\d+\n$/,
    passthrough: [['--help'], ['serve', '--help']],
    notConfigured: (record) =>
      assert.equal(record.env.SUBCONSCIOUS_API_KEY, undefined),
    refused: [['serve', '--service'], ['serve', '--stdio'], ['upgrade'], []],
    keyCarriers: ['SUBCONSCIOUS_API_KEY'],
    unset: ['API_KEY', 'OPENCODE_API_KEY', 'SUBC_OPENCODE_API_KEY', 'MODEL'],
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
        OPENCODE_CONFIG_CONTENT: JSON.stringify({ provider: { evil: {} } }),
        OPENCODE_CONTEXT_LIMIT: '7',
      };
    },
    steered({ env, config }, gateway) {
      for (const name of ['OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR'])
        assert.equal(env[name], undefined, name);
      const provider = config.provider.subconscious;
      assert.equal(provider.options.baseURL, `${gateway.url}/v1`);
      assert.deepEqual(Object.keys(provider.models), MODELS);
      assert.equal(provider.models[MODELS[0]].limit.context, 5000000);
    },
    model: (record) => record.config.model.replace(/^subconscious\//, ''),
    entry: (box) => ({
      driver: 'opencode',
      displayName: 'Subconscious (OpenCode)',
      enabled: true,
      config: { binaryPath: box.opencodeLauncher },
    }),
    userFiles: (box) => [box.opencodeConfigDir, box.opencodeDataDir],
  },
};

const PROVIDERS = T3_PROVIDERS.map((provider) => ({
  provider,
  ...FIXTURES[provider.id],
}));

let gateway;
const boxes = [];
const installed = {};

/** A sandbox with all three CLIs. */
async function box() {
  const sandbox = await t3Sandbox({
    gateway,
    withClaude: true,
    withOpenCode: true,
  });
  boxes.push(sandbox);
  return sandbox;
}

async function installedBox(fixture) {
  const sandbox = await box();
  const { id } = fixture.provider;
  const result = await subc(sandbox, ['t3', 'install', '--provider', id]);
  assert.equal(result.code, 0, result.stderr);
  return sandbox;
}

/** The env name of a fake agent option, such as FAKE_CODEX_LOG. */
const fake = (fixture, name) =>
  `FAKE_${fixture.provider.binaryName.toUpperCase()}_${name}`;

function launch(fixture, sandbox, args, { log, env = {} } = {}) {
  return run(fixture.launcher(sandbox), args, {
    env: fixture.t3Env(sandbox, { [fake(fixture, 'LOG')]: log, ...env }),
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

before(async () => {
  if (skip) return;
  gateway = await fakeGateway();
  for (const fixture of PROVIDERS)
    installed[fixture.provider.id] = await installedBox(fixture);
});

after(async () => {
  for (const sandbox of boxes) await sandbox.cleanup();
  await gateway?.close();
});

for (const fixture of PROVIDERS) {
  const { provider } = fixture;
  const { id, instanceId, launcherName, binaryName } = provider;
  const name = (text) => `[${id}] ${text}`;

  test(name('install and uninstall touch only its own entry and launcher'), {
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
    const before = await fs.readFile(sandbox.settingsPath, 'utf8');
    const userBefore = await contentsOf(fixture.userFiles(sandbox));

    const result = await subc(sandbox, ['t3', 'install', '--provider', id]);
    assert.equal(result.code, 0, result.stderr);
    const text = await fs.readFile(sandbox.settingsPath, 'utf8');
    const settings = JSON.parse(text);
    const { [instanceId]: entry, ...rest } = settings.providerInstances;
    assert.deepEqual(entry, fixture.entry(sandbox));
    assert.equal(Object.keys(settings.providerInstances).at(-1), instanceId);
    assert.deepEqual(
      { ...settings, providerInstances: rest },
      JSON.parse(before),
    );
    assert.equal((await fs.stat(sandbox.settingsPath)).mode & 0o777, 0o644);

    const launcherPath = fixture.launcher(sandbox);
    assert.equal((await fs.stat(launcherPath)).mode & 0o777, 0o755);
    const launcher = await fs.readFile(launcherPath, 'utf8');
    assert.ok(launcher.startsWith(`${LAUNCHER_SHEBANG}\n`));
    assert.ok(
      launcher.includes(`\nsubc_${binaryName}='${fixture.binary(sandbox)}'\n`),
    );
    for (const where of [launcher, text, result.stdout, result.stderr])
      assert.ok(!where.includes(GOOD_KEY), 'no key');
    // The version check ran in a throwaway home.
    assert.deepEqual(await contentsOf(fixture.userFiles(sandbox)), userBefore);

    const requests = gateway.requests.length;
    const removed = await subc(sandbox, ['t3', 'uninstall', '--provider', id]);
    assert.equal(removed.code, 0, removed.stderr);
    assert.equal(gateway.requests.length, requests, 'no network request');
    assert.deepEqual(await readSettings(sandbox), JSON.parse(before));
    await assert.rejects(fs.lstat(launcherPath));
    for (const other of others) await fs.access(other.launcher(sandbox));
    assert.deepEqual(await contentsOf(fixture.userFiles(sandbox)), userBefore);
  });

  test(name(
    'only the allowed names carry the key, to the process T3 Code started',
  ), {
    skip,
  }, async () => {
    const sandbox = await installedBox(fixture);
    // Profile lines can hold more copies of the key, under any name. A
    // subc_* line names one of the launcher's own variables.
    await fs.appendFile(
      profileFile(sandbox),
      `${PROFILE_COPIES.map((key) => `${key}=${GOOD_KEY}\n`).join('')}subc_argv=/usr/bin/true\n`,
    );
    const log = logFile(sandbox);
    const result = await launch(fixture, sandbox, fixture.configured, { log });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, '');
    const [record] = await readRecords(log);
    // The launcher execs, so the agent is the process T3 Code started, and
    // stdout holds only what the agent printed.
    assert.equal(record.pid, result.pid);
    assertStdout(fixture, result, record);
    assert.equal(record.env.HOME, sandbox.home);
    assert.deepEqual(keyHolders(record.env), fixture.keyCarriers);
    for (const key of fixture.unset)
      assert.equal(record.env[key], undefined, key);
    assert.ok(
      Object.keys(record.env).every(
        (key) => !key.startsWith('SUBC_') || fixture.subcNames?.includes(key),
      ),
      'no SUBC_* name reaches the agent',
    );
    assert.equal(record.env.subc_argv, undefined);
    assert.ok(
      !JSON.stringify([record.args, record.config ?? null]).includes(GOOD_KEY),
      'no key in argv or config',
    );
    // Other secrets in the profile stay out of the agent env too.
    const extra = Object.entries(PROFILE_SECRETS).map(
      ([k, v]) => `${k}=${v}\n`,
    );
    await fs.writeFile(
      profileFile(sandbox),
      profile(gateway.url, GOOD_KEY, extra.join('')),
      { mode: 0o600 },
    );
    const second = logFile(sandbox);
    const again = await launch(fixture, sandbox, fixture.configured, {
      log: second,
    });
    assert.equal(again.code, 0, again.stderr);
    const [other] = await readRecords(second);
    for (const name of Object.keys(PROFILE_SECRETS))
      assert.equal(other.env[name], undefined, name);
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

  test(name(
    'BASH_ENV, ENV, and shell functions never run or reach the agent',
  ), {
    skip,
  }, async () => {
    const sandbox = await installedBox(fixture);
    const startup = path.join(sandbox.root, 'startup.sh');
    await fs.writeFile(startup, 'echo "hello from BASH_ENV"\n');
    const marker = path.join(sandbox.root, 'function-ran');
    const env = {
      BASH_ENV: startup,
      ENV: startup,
      ...exportedFunctions(marker),
    };
    // From T3 Code's env, and from the default profile.
    await fs.writeFile(
      profileFile(sandbox),
      profile(gateway.url, GOOD_KEY, `BASH_ENV=${startup}\nENV=${startup}\n`),
      { mode: 0o600 },
    );
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
    // The agent's tool shells would import an exported function.
    assert.deepEqual(
      Object.keys(record.env).filter((name) => name.startsWith('BASH_FUNC_')),
      [],
    );
    const version = await launch(fixture, sandbox, ['--version'], { env });
    assert.equal(version.stdout, fixture.versionOutput);
    await assert.rejects(fs.lstat(marker), { code: 'ENOENT' });
  });

  test(name(
    'passthrough runs the real CLI offline, and other commands are refused',
  ), {
    skip,
  }, async () => {
    const sandbox = await installedBox(fixture);
    // A passthrough never reads the profile, so a broken one cannot stop it.
    await fs.writeFile(profileFile(sandbox), 'MODEL=not a model!\n');
    const requests = gateway.requests.length;
    for (const args of fixture.passthrough) {
      const log = logFile(sandbox);
      const result = await launch(fixture, sandbox, args, { log });
      assert.equal(result.code, 0, `${args.join(' ')}: ${result.stderr}`);
      const [record] = await readRecords(log);
      assert.deepEqual(record.args, args);
      fixture.notConfigured(record);
    }
    const refusal = new RegExp(
      `^${launcherName}: \`${binaryName} .*\` is not available through the Subconscious provider\\. Run ${binaryName} directly for it\\.\\n$`,
    );
    for (const args of fixture.refused) {
      const log = logFile(sandbox);
      const result = await launch(fixture, sandbox, args, { log });
      assert.equal(result.code, 1, args.join(' '));
      assert.equal(result.stdout, '');
      assert.match(result.stderr, refusal);
      assert.deepEqual(await readRecords(log), []);
    }
    assert.equal(gateway.requests.length, requests, 'no network request');
  });

  test(name('a rejected key, no key, or no catalog stops the launch'), {
    skip,
  }, async () => {
    const sandbox = await installedBox(fixture);
    const log = logFile(sandbox);
    for (const [text, pattern] of [
      [
        profile(gateway.url, 'sk-rejected-key'),
        /did not return the model catalog for this key/,
      ],
      // No packaged or public fallback.
      [profile('http://127.0.0.1:9'), /Could not read the model catalog/],
      [`GATEWAY_URL=${gateway.url}\n`, /no saved API key/],
    ]) {
      await fs.writeFile(profileFile(sandbox), text);
      const result = await launch(fixture, sandbox, fixture.configured, {
        log,
      });
      assert.equal(result.code, 1, result.stderr);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, pattern);
      assert.ok(!result.stderr.includes('sk-rejected-key'));
    }
    assert.deepEqual(await readRecords(log), []);
    // The keyless profile made subc look in the Keychain: the fake one.
    assert.match(
      await fs.readFile(sandbox.keychainCalls, 'utf8'),
      /^find-generic-password /m,
    );
  });
}

// The adapters exit 64 (EX_USAGE) for a refused command; the launcher
// reports any adapter failure as 1.
