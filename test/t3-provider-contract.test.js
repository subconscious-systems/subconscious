/**
 * The checks that every `subc t3` provider must pass, run once per provider:
 * the install round trip, the key in the env name the agent reads, the
 * passthrough and refused commands, and the failed launches. Each provider
 * supplies a fixture. Shared code that does not depend on the provider is
 * tested once, in t3.test.js and t3-settings.test.js.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { LAUNCHER_SHEBANG } from '../bin/t3-launch.js';
import { T3_PROVIDERS } from '../bin/t3-providers.js';
import {
  fakeGateway,
  GOOD_KEY,
  readRecords,
  run,
  subc,
  t3Sandbox,
} from './helpers/t3-sandbox.js';

const skip = process.platform === 'win32';

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
    carrier: 'SUBCONSCIOUS_API_KEY',
    // Codex's OpenAI credential stays empty, so a launch switched back to
    // OpenAI has no key to send.
    unset: ['CODEX_API_KEY'],
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
    refused: [[], ['auth', 'login'], ['mcp', 'add', 'x', '--', 'cmd', '-p']],
    carrier: 'ANTHROPIC_AUTH_TOKEN',
    unset: [],
    entry: (box) => ({
      driver: 'claudeAgent',
      displayName: 'Subconscious (Claude)',
      enabled: true,
      config: { binaryPath: box.claudeLauncher },
    }),
  },

  opencode: {
    launcher: (box) => box.opencodeLauncher,
    binary: (box) => box.opencodeBin,
    t3Env: (box, extra) => box.openCodeT3Env(extra),
    versionOutput: 'opencode v2.3.0\n',
    configured: ['serve', '--hostname=127.0.0.1', '--port=0'],
    stdout: () => /^server listening on http:\/\/127\.0\.0\.1:\d+\n$/,
    passthrough: [['--help']],
    notConfigured: (record) =>
      assert.equal(record.env.SUBCONSCIOUS_API_KEY, undefined),
    refused: [['upgrade'], []],
    carrier: 'SUBCONSCIOUS_API_KEY',
    // OpenCode sends OPENCODE_API_KEY to opencode.ai, so neither key setting
    // reaches it, even when the profile holds one.
    unset: ['OPENCODE_API_KEY', 'SUBC_OPENCODE_API_KEY'],
    entry: (box) => ({
      driver: 'opencode',
      displayName: 'Subconscious (OpenCode)',
      enabled: true,
      config: { binaryPath: box.opencodeLauncher },
    }),
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

    const requests = gateway.requests.length;
    const removed = await subc(sandbox, ['t3', 'uninstall', '--provider', id]);
    assert.equal(removed.code, 0, removed.stderr);
    assert.equal(gateway.requests.length, requests, 'no network request');
    assert.deepEqual(await readSettings(sandbox), JSON.parse(before));
    await assert.rejects(fs.lstat(launcherPath));
    for (const other of others) await fs.access(other.launcher(sandbox));
  });

  test(name('the key reaches the process T3 Code started in its carrier'), {
    skip,
  }, async () => {
    const sandbox = await installedBox(fixture);
    await fs.appendFile(
      profileFile(sandbox),
      `OPENCODE_API_KEY=${GOOD_KEY}\nSUBC_OPENCODE_API_KEY=${GOOD_KEY}\n`,
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
    assert.equal(record.env[fixture.carrier], GOOD_KEY);
    for (const key of fixture.unset)
      assert.equal(record.env[key], undefined, key);
    assert.ok(
      !JSON.stringify([record.args, record.config ?? null]).includes(GOOD_KEY),
      'no key in argv or config',
    );
  });

  test(name('a BASH_ENV that prints does not reach stdout'), {
    skip,
  }, async () => {
    const sandbox = installed[id];
    const startup = path.join(sandbox.root, 'startup.sh');
    await fs.writeFile(startup, 'echo "hello from BASH_ENV"\n');
    const log = logFile(sandbox);
    const result = await launch(fixture, sandbox, fixture.configured, {
      log,
      env: { BASH_ENV: startup, ENV: startup },
    });
    assert.equal(result.code, 0, result.stderr);
    const [record] = await readRecords(log);
    assertStdout(fixture, result, record);
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
    // On macOS, the keyless profile made subc look in the Keychain: the fake
    // one. Other platforms have no Keychain lookup.
    if (process.platform === 'darwin')
      assert.match(
        await fs.readFile(sandbox.keychainCalls, 'utf8'),
        /^find-generic-password /m,
      );
  });
}

// The adapters exit 64 (EX_USAGE) for a refused command; the launcher
// reports any adapter failure as 1.
