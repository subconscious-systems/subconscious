import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { agentById } from '../bin/agent-data.js';
import {
  configArgs,
  resolveAgentEnv,
  resolveInputs,
} from '../bin/agent-launch.js';
import { restartWithCallerEnv } from '../bin/t3-launch.js';
import { CODEX_PROVIDER } from '../bin/t3-providers.js';
import {
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
const ROOT = fileURLToPath(new URL('..', import.meta.url));

let gateway;
let installed;
const boxes = [];

async function box(options = {}) {
  const sandbox = await t3Sandbox({ gateway, ...options });
  boxes.push(sandbox);
  return sandbox;
}

async function installedBox(options = {}) {
  const sandbox = await box(options);
  const result = await subc(sandbox, ['t3', 'install']);
  assert.equal(result.code, 0, result.stderr);
  return sandbox;
}

function launch(sandbox, args, { log, env = {}, input } = {}) {
  return run(sandbox.launcher, args, {
    env: sandbox.t3Env({ FAKE_CODEX_LOG: log, ...env }),
    input,
  });
}

const logFile = (sandbox, name) => path.join(sandbox.root, `${name}.log`);
const mtime = async (file) => (await fs.stat(file)).mtimeMs;

before(async () => {
  if (skip) return;
  gateway = await fakeGateway();
  installed = await installedBox();
});

after(async () => {
  for (const sandbox of boxes) await sandbox.cleanup();
  await gateway?.close();
});

test('a second install changes nothing', { skip }, async () => {
  const sandbox = await installedBox();
  const files = [sandbox.settingsPath, sandbox.launcher];
  const before = await Promise.all(files.map(mtime));
  const backups = await fs.readdir(path.join(sandbox.subc, 't3', 'backups'));
  const result = await subc(sandbox, ['t3', 'install']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /already set up/);
  assert.deepEqual(await Promise.all(files.map(mtime)), before);
  assert.deepEqual(
    await fs.readdir(path.join(sandbox.subc, 't3', 'backups')),
    backups,
  );
});

test('an app-server launch uses only the default profile and the live catalog', {
  skip,
}, async () => {
  const sandbox = installed;
  const log = logFile(sandbox, 'app-server');
  const result = await launch(sandbox, ['app-server'], { log });
  assert.equal(result.code, 0, result.stderr);
  const [record] = await readRecords(log);
  // Stdout is the app-server protocol, so it carries Codex's output alone.
  assert.equal(
    result.stdout,
    `${JSON.stringify({ fake: 'codex', args: record.args })}\n`,
  );
  assert.equal(record.args.at(-1), 'app-server');

  // The same -c list an ordinary subc codex launch passes, with the catalog
  // in the integration's own file instead of a temp file.
  const agent = agentById('codex');
  const ordinary = configArgs(
    agent,
    resolveAgentEnv(
      agent,
      resolveInputs(agent, {
        GATEWAY_URL: gateway.url,
        API_KEY: GOOD_KEY,
        MODEL: MODELS[0],
      }),
    ),
  ).map((arg) =>
    arg === 'model_catalog_json={tempFile}'
      ? `model_catalog_json=${path.join(sandbox.catalogDir, 'model-catalog.json')}`
      : arg,
  );
  assert.deepEqual(record.args.slice(0, -1), ordinary);
  assert.ok(record.args.includes('features.apps=false'));
  assert.ok(record.args.includes('features.plugins=false'));
  assert.ok(record.args.includes('apps._default.enabled=false'));

  assert.equal(record.env.CODEX_HOME, sandbox.codexHome);
  assert.deepEqual(
    record.catalog.models.map((model) => model.slug),
    MODELS,
  );
});

test('exec keeps every T3 argument in order and passes stdin', {
  skip,
}, async () => {
  const sandbox = installed;
  const log = logFile(sandbox, 'exec');
  const t3Args = [
    'exec',
    '--config',
    'features.plugins=false',
    '--config',
    'features.apps=false',
    '--ephemeral',
    '--skip-git-repo-check',
    '-s',
    'read-only',
    '--model',
    MODELS[1],
    '--config',
    'model_reasoning_effort="low"',
    '--output-schema',
    '/tmp/schema with space.json',
    '--',
    '--not-a-flag',
    '-',
  ];
  const result = await launch(sandbox, t3Args, {
    log,
    env: { FAKE_CODEX_READ_STDIN: '1' },
    input: 'Write a title for this thread.',
  });
  assert.equal(result.code, 0, result.stderr);
  const [record] = await readRecords(log);
  assert.deepEqual(record.args.slice(-t3Args.length), t3Args);
  assert.equal(
    record.args[record.args.length - t3Args.length - 1].startsWith(
      'model_providers.',
    ),
    true,
  );
  assert.equal(record.stdin, 'Write a title for this thread.');
});

test('install refuses a key the gateway rejects and changes nothing', {
  skip,
}, async () => {
  const sandbox = await box({ apiKey: 'sk-rejected-key' });
  const settings = await fs.readFile(sandbox.settingsPath, 'utf8');
  const before = await snapshot(sandbox.home);
  const result = await subc(sandbox, ['t3', 'install']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /did not return the model catalog for this key/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes('sk-rejected-key'));
  assert.equal(await fs.readFile(sandbox.settingsPath, 'utf8'), settings);
  assert.deepEqual(await snapshot(sandbox.home), before);
});

test('each launch reads the default profile again', { skip }, async () => {
  const sandbox = await installedBox();
  await fs.writeFile(
    path.join(sandbox.subc, 'profiles', 'default.env'),
    `GATEWAY_URL=${gateway.url}\nAPI_KEY=${GOOD_KEY}\nMODEL=${MODELS[1]}\nCODEX_REASONING_EFFORT=low\n`,
  );
  const log = logFile(sandbox, 'dynamic');
  const result = await launch(sandbox, ['app-server'], { log });
  assert.equal(result.code, 0, result.stderr);
  const [record] = await readRecords(log);
  assert.ok(record.args.includes(`model=${MODELS[1]}`));
  assert.ok(record.args.includes('model_reasoning_effort=low'));
  assert.equal(record.catalog.models[0].slug, MODELS[1]);
});

test('repeated probes keep one catalog file and write nothing to ~/.codex', {
  skip,
}, async () => {
  const sandbox = await installedBox();
  // Codex itself may add files (such as tmp/); subc must add none.
  const subcFiles = async () =>
    (await fs.readdir(sandbox.codexHome)).filter(
      (name) => name.startsWith('subconscious') || name === 'hooks.json',
    );
  let catalogMtime;
  for (let i = 0; i < 6; i++) {
    const result = await launch(
      sandbox,
      i % 2 ? ['exec', '--ephemeral', '-'] : ['app-server'],
    );
    assert.equal(result.code, 0, result.stderr);
    await launch(sandbox, ['--version']);
    const catalog = path.join(sandbox.catalogDir, 'model-catalog.json');
    if (i === 0) catalogMtime = await mtime(catalog);
    assert.equal(await mtime(catalog), catalogMtime, 'unchanged catalog');
  }
  assert.deepEqual(await fs.readdir(sandbox.catalogDir), [
    'model-catalog.json',
  ]);
  const catalogStat = await fs.stat(
    path.join(sandbox.catalogDir, 'model-catalog.json'),
  );
  assert.equal(catalogStat.mode & 0o777, 0o600);
  assert.equal((await fs.stat(sandbox.catalogDir)).mode & 0o777, 0o700);
  assert.deepEqual(await subcFiles(), []);
  // An ordinary launch leaves a codex-model-catalog.XXXXXX.json in TMPDIR.
  assert.deepEqual(
    (await fs.readdir(sandbox.tmp)).filter((name) => name.includes('catalog')),
    [],
    'no temp catalogs',
  );
});

test('status and uninstall work offline, without a key or valid settings', {
  skip,
}, async () => {
  const sandbox = await installedBox();
  await fs.writeFile(
    path.join(sandbox.subc, 'profiles', 'default.env'),
    'GATEWAY_URL=http://127.0.0.1:9\nCODEX_REASONING_EFFORT=bogus\nMODEL=not a model!\n',
  );
  const requests = gateway.requests.length;
  const status = await subc(sandbox, ['t3', 'status']);
  assert.equal(status.code, 0, status.stderr);
  assert.match(status.stdout, /subconscious-codex: installed/);
  assert.match(status.stdout, /subc-t3-codex: current/);
  assert.match(status.stdout, /Old hooks\s+none/);

  const result = await subc(sandbox, ['t3', 'uninstall']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(gateway.requests.length, requests, 'no network request');
  const settings = JSON.parse(await fs.readFile(sandbox.settingsPath, 'utf8'));
  assert.deepEqual(Object.keys(settings.providerInstances), ['claudeAgent']);
  assert.deepEqual(settings.futureTopLevelSetting, { keep: [1, 2, 3] });
  await assert.rejects(fs.access(sandbox.launcher));
  await assert.rejects(fs.access(sandbox.catalogDir));
  assert.deepEqual(await fs.readdir(sandbox.codexDir), ['config.toml']);
  assert.equal(
    await fs.readFile(path.join(sandbox.codexDir, 'config.toml'), 'utf8'),
    'model = "gpt-user"\n[mcp_servers.user]\ncommand = "user-mcp"\n',
  );

  const again = await subc(sandbox, ['t3', 'uninstall']);
  assert.equal(again.code, 0, again.stderr);
  const after = await subc(sandbox, ['t3', 'status']);
  assert.match(after.stdout, /subconscious-codex: not installed/);
  assert.match(after.stdout, /subc-t3-codex: missing/);
});

test('uninstall says the provider stays when settings cannot change', {
  skip,
}, async () => {
  const sandbox = await installedBox();
  await fs.writeFile(
    path.join(sandbox.t3Home, 'userdata', 'server-runtime.json'),
    JSON.stringify({ managedPolicy: { locked: true } }),
  );
  const result = await subc(sandbox, ['t3', 'uninstall']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /managed policy/);
  assert.match(
    result.stderr,
    /T3 Code still lists Subconscious \(Codex\), and it fails to start/,
  );
});

test('a hooks.json that is not valid JSON does not stop install', {
  skip,
}, async () => {
  const sandbox = await box();
  await fs.mkdir(sandbox.codexHome, { recursive: true });
  const hooksJson = path.join(sandbox.codexHome, 'hooks.json');
  await fs.writeFile(hooksJson, '{ not json subconscious-hook.sh');
  const result = await subc(sandbox, ['t3', 'install']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /not valid JSON; leaving it unchanged/);
  assert.match(result.stdout, /provider works without removing them/);
  assert.equal(
    await fs.readFile(hooksJson, 'utf8'),
    '{ not json subconscious-hook.sh',
  );
  const settings = JSON.parse(await fs.readFile(sandbox.settingsPath, 'utf8'));
  assert.ok(settings.providerInstances['subconscious-codex']);
});

test('a failed settings write says what stayed installed', {
  skip,
}, async () => {
  const sandbox = await box();
  const userdata = path.dirname(sandbox.settingsPath);
  await fs.chmod(userdata, 0o500);
  try {
    const result = await subc(sandbox, ['t3', 'install']);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /T3 Code settings were not updated/);
    assert.match(result.stderr, /subc t3 uninstall/);
    const status = await subc(sandbox, ['t3', 'status']);
    assert.match(status.stdout, /subconscious-codex: not installed/);
    assert.match(status.stdout, /Old hooks\s+none/);
  } finally {
    await fs.chmod(userdata, 0o700);
  }
  const retry = await subc(sandbox, ['t3', 'install']);
  assert.equal(retry.code, 0, retry.stderr);
});

test('a managed policy or a foreign provider stops install before any write', {
  skip,
}, async () => {
  const policy = await box();
  await fs.writeFile(
    path.join(policy.t3Home, 'userdata', 'server-runtime.json'),
    '{"managedPolicy":{"organization":"acme"}}',
  );
  const before = await snapshot(policy.home);
  const result = await subc(policy, ['t3', 'install']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /managed policy/);
  assert.deepEqual(await snapshot(policy.home), before);

  const foreign = await box({
    settings:
      '{"providerInstances":{"subconscious-codex":{"driver":"codex"}}}\n',
  });
  const refused = await subc(foreign, ['t3', 'install']);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /did not create/);
  const status = await subc(foreign, ['t3', 'status']);
  assert.match(status.stdout, /conflict/);
});

test('only the default profile, and only macOS and Linux', {
  skip,
}, async () => {
  const sandbox = await box();
  const named = await subc(sandbox, ['-p', 'staging', 't3', 'install']);
  assert.equal(named.code, 1);
  assert.match(named.stderr, /default profile only/);
  const fromEnv = await subc(sandbox, ['t3', 'status'], {
    SUBC_PROFILE: 'staging',
  });
  assert.equal(fromEnv.code, 1);
  assert.match(fromEnv.stderr, /default profile only/);

  const { t3Command } = await import('../bin/t3.js');
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try {
    await assert.rejects(t3Command(['install']), /macOS and Linux only/);
  } finally {
    Object.defineProperty(process, 'platform', platform);
  }
});

test('status reports a launcher whose pinned files are gone', {
  skip,
}, async () => {
  const sandbox = await installedBox();
  await fs.rename(
    path.join(sandbox.bin, 'codex'),
    path.join(sandbox.bin, 'codex.moved'),
  );
  const status = await subc(sandbox, ['t3', 'status']);
  assert.match(status.stdout, /broken: pinned codex missing/);
  const result = await launch(sandbox, ['app-server']);
  assert.equal(result.code, 69);
  assert.match(result.stderr, /Run subc t3 install again/);
});

test('a failed SYSTEM_CA restart isolates the env again before the launch', async () => {
  const original = {
    PATH: '/usr/bin',
    SUBCONSCIOUS_API_KEY: 'sk-inherited-evil',
    SUBCONSCIOUS_BASE_URL: 'http://127.0.0.1:9/evil',
    CODEX_API_KEY: 'sk-codex-evil',
  };
  const configDir = path.join(ROOT, 'no-such-config');
  for (const ran of [true, false]) {
    const env = { PATH: '/usr/bin' };
    let seen;
    const restarted = await restartWithCallerEnv({
      env,
      original,
      configDir,
      provider: CODEX_PROVIDER,
      restart: async () => {
        seen = { ...env };
        return ran;
      },
    });
    assert.equal(restarted, ran);
    // The child gets the caller's env and isolates it itself.
    assert.deepEqual(seen, original);
    if (ran) continue;
    assert.deepEqual(env, { PATH: '/usr/bin', SUBC_CONFIG_DIR: configDir });
  }
});

/** ~/.codex as an older subc left it, next to one hook of the user's. */
async function writeOldHooks(codexHome) {
  await fs.mkdir(codexHome, { recursive: true });
  const script = path.join(codexHome, 'subconscious-hook.sh');
  await fs.writeFile(script, '#!/usr/bin/env bash\n', { mode: 0o755 });
  await fs.writeFile(
    path.join(codexHome, 'subconscious-hooks.env'),
    `export SUBCONSCIOUS_API_KEY='${GOOD_KEY}'\n`,
    { mode: 0o600 },
  );
  await fs.mkdir(path.join(codexHome, 'subconscious-hook-logs'));
  const ours = { hooks: [{ type: 'command', command: script, timeout: 3 }] };
  const user = {
    hooks: [{ type: 'command', command: '/usr/local/bin/guard.sh' }],
  };
  await fs.writeFile(
    path.join(codexHome, 'hooks.json'),
    `${JSON.stringify(
      {
        hooks: {
          PreCompact: [ours],
          PostCompact: [ours],
          PreToolUse: [user],
        },
      },
      null,
      2,
    )}\n`,
  );
  return { PreToolUse: [user] };
}

test('status reports hooks an older subc left, and install removes them', {
  skip,
}, async () => {
  const sandbox = await installedBox();
  const user = await writeOldHooks(sandbox.codexHome);
  const before = await subc(sandbox, ['t3', 'status']);
  assert.equal(before.code, 0, before.stderr);
  assert.match(
    before.stdout,
    /Old hooks\s+left by an older subc; run subc t3 install --provider codex/,
  );

  const result = await subc(sandbox, ['t3', 'install']);
  assert.equal(result.code, 0, result.stderr);
  const document = JSON.parse(
    await fs.readFile(path.join(sandbox.codexHome, 'hooks.json'), 'utf8'),
  );
  assert.deepEqual(document, { hooks: user });
  assert.deepEqual((await fs.readdir(sandbox.codexHome)).sort(), [
    'config.toml',
    'hooks.json',
  ]);
  const after = await subc(sandbox, ['t3', 'status']);
  assert.match(after.stdout, /Old hooks\s+none/);
});

test("uninstall removes hooks an older subc left, and keeps the user's", {
  skip,
}, async () => {
  const sandbox = await installedBox();
  const user = await writeOldHooks(sandbox.codexHome);
  const result = await subc(sandbox, ['t3', 'uninstall']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Removed the old Subconscious hooks/);
  const document = JSON.parse(
    await fs.readFile(path.join(sandbox.codexHome, 'hooks.json'), 'utf8'),
  );
  assert.deepEqual(document, { hooks: user });
});

test('status reports drift and an old launcher, and install repairs both', {
  skip,
}, async () => {
  const sandbox = await installedBox();
  const settings = JSON.parse(await fs.readFile(sandbox.settingsPath, 'utf8'));
  const entry = settings.providerInstances['subconscious-codex'];
  const expected = structuredClone(entry);
  entry.displayName = 'Renamed';
  entry.config.launchArgs = 'set in T3 Code';
  // A field that subc does not manage stays as the user set it.
  entry.accentColor = '#123456';
  await fs.writeFile(sandbox.settingsPath, JSON.stringify(settings));
  // A launcher an older subc wrote.
  const launcher = await fs.readFile(sandbox.launcher, 'utf8');
  await fs.writeFile(
    sandbox.launcher,
    launcher.replace(/\(subconscious-cli [^)]+\)/, '(subconscious-cli 0.0.1)'),
  );
  const status = await subc(sandbox, ['t3', 'status']);
  assert.equal(status.code, 0, status.stdout);
  assert.match(
    status.stdout,
    /subconscious-codex: installed, changed in T3 \(displayName, launchArgs\)/,
  );
  assert.match(status.stdout, /stale \(written by subc 0\.0\.1/);

  const result = await subc(sandbox, ['t3', 'install']);
  assert.equal(result.code, 0, result.stderr);
  const repaired = JSON.parse(await fs.readFile(sandbox.settingsPath, 'utf8'));
  assert.deepEqual(repaired.providerInstances['subconscious-codex'], {
    ...expected,
    accentColor: '#123456',
  });
  assert.equal(await fs.readFile(sandbox.launcher, 'utf8'), launcher);
});

test('without --provider, an old or missing CLI is skipped; with it, install refuses', {
  skip,
}, async () => {
  const sandbox = await box({ withClaude: true });
  const old = { FAKE_CODEX_VERSION: '0.142.0' };
  const skipped = await subc(sandbox, ['t3', 'install'], old);
  assert.equal(skipped.code, 0, skipped.stderr);
  const out = skipped.stdout.replace(/\s+/g, ' ');
  assert.match(
    out,
    /Subconscious \(Codex\): Codex 0\.142\.0 is older than 0\.143\.0/,
  );
  assert.match(out, /Subconscious \(OpenCode\): OpenCode CLI is not installed/);
  assert.match(out, /Subconscious \(Claude\) is ready/);
  await assert.rejects(fs.access(sandbox.launcher));

  const before = await snapshot(sandbox.home);
  const named = await subc(
    sandbox,
    ['t3', 'install', '--provider', 'claude', '--provider', 'codex'],
    old,
  );
  assert.equal(named.code, 1);
  assert.match(named.stderr, /Nothing was changed\./);
  const missing = await subc(sandbox, [
    't3',
    'install',
    '--provider',
    'opencode',
  ]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /OpenCode CLI is not installed/);
  assert.deepEqual(await snapshot(sandbox.home), before);
  // With every CLI refused, install fails too.
  await fs.rm(sandbox.claudeBin);
  const none = await subc(sandbox, ['t3', 'install'], old);
  assert.equal(none.code, 1);
  assert.match(none.stderr, /Codex 0\.142\.0 is older/);
});

test('install refuses an unknown provider or option', { skip }, async () => {
  const provider = await subc(installed, [
    't3',
    'install',
    '--provider',
    'cursor',
  ]);
  assert.equal(provider.code, 1);
  assert.match(provider.stderr, /Unknown provider: cursor/);
  const option = await subc(installed, ['t3', 'install', '--dry-run']);
  assert.equal(option.code, 1);
  assert.match(
    option.stderr,
    /Unknown argument for subc t3 install: --dry-run/,
  );
  // No help still shows the removed option.
  const help = await subc(installed, ['help']);
  assert.doesNotMatch(help.stdout, /t3 install --dry-run/);
});
