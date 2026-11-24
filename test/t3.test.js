import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
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

test('install --dry-run checks everything and writes nothing', {
  skip,
}, async () => {
  const sandbox = await box();
  const before = await snapshot(sandbox.home);
  const requests = gateway.requests.length;
  const result = await subc(sandbox, ['t3', 'install', '--dry-run']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Plan: Subconscious \(Codex\) in T3 Code/);
  assert.match(result.stdout, /Dry run: nothing was changed/);
  assert.deepEqual(await snapshot(sandbox.home), before);
  assert.ok(gateway.requests.length > requests, 'the live catalog was read');
});

test('install adds the provider and the launcher, and no hooks', {
  skip,
}, async () => {
  const sandbox = installed;
  const text = await fs.readFile(sandbox.settingsPath, 'utf8');
  const settings = JSON.parse(text);
  assert.match(text, /^\{\n\t"/);
  assert.deepEqual(settings.futureTopLevelSetting, { keep: [1, 2, 3] });
  assert.deepEqual(settings.providerInstances.claudeAgent, {
    driver: 'claudeAgent',
    enabled: true,
  });
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
  assert.equal((await fs.stat(sandbox.settingsPath)).mode & 0o777, 0o644);
  assert.equal((await fs.stat(sandbox.launcher)).mode & 0o777, 0o755);
  assert.equal(sandbox.codexHome, sandbox.codexDir, 'the shared Codex home');

  await assert.rejects(fs.access(sandbox.state), 'no state file');
  assert.ok(!(await fs.readFile(sandbox.launcher, 'utf8')).includes(GOOD_KEY));
  assert.ok(!text.includes(GOOD_KEY), 'no key in T3 settings');

  // subc writes nothing to ~/.codex, so no key is stored there.
  assert.deepEqual(await fs.readdir(sandbox.codexDir), ['config.toml']);
  assert.equal(
    await fs.readFile(path.join(sandbox.codexDir, 'config.toml'), 'utf8'),
    'model = "gpt-user"\n[mcp_servers.user]\ncommand = "user-mcp"\n',
  );
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

  const { env } = record;
  assert.equal(env.SUBCONSCIOUS_API_KEY, GOOD_KEY);
  // The provider reads SUBCONSCIOUS_API_KEY. Codex's OpenAI credential
  // stays empty, so a launch switched back to OpenAI has no key to send.
  assert.equal(env.CODEX_API_KEY, undefined);
  assert.equal(env.SUBCONSCIOUS_GATEWAY_URL, gateway.url);
  assert.equal(env.SUBCONSCIOUS_MODELS, MODELS.join('\n'));
  assert.equal(env.SUBCONSCIOUS_CODEX_LAUNCH, undefined);
  assert.equal(env.CODEX_HOME, sandbox.codexHome);
  assert.equal(env.SUBCONSCIOUS_BASE_URL, undefined);
  assert.equal(env.SUBCONSCIOUS_MODEL, undefined);
  assert.equal(env.SUBC_CONFIG_DIR, undefined);
  assert.equal(env.SUBC_CODEX_PROTOCOL_LAUNCH, undefined);
  assert.equal(env.SUBC_CODEX_CATALOG_FILE, undefined);
  assert.deepEqual(
    record.catalog.models.map((model) => model.slug),
    MODELS,
  );
  assert.ok(!record.args.join(' ').includes(GOOD_KEY));
  assert.ok(!result.stderr.includes(GOOD_KEY));
  assert.ok(
    gateway.requests.every(
      (request) =>
        request.authorization === null ||
        request.authorization === `Bearer ${GOOD_KEY}` ||
        request.authorization === 'Bearer sk-rejected-key',
    ),
    'no inherited key reached the gateway',
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

test('capability probes run the real Codex unchanged, offline', {
  skip,
}, async () => {
  const sandbox = installed;
  const probes = [
    ['--version'],
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
  ];
  const requests = gateway.requests.length;
  // Codex itself creates CODEX_HOME/tmp on every start. That is the
  // provider's own home, so it is not a write by subc.
  await fs.mkdir(path.join(sandbox.codexHome, 'tmp'), { recursive: true });
  const before = await snapshot(sandbox.subc);
  for (const args of probes) {
    const log = logFile(sandbox, `probe-${args.join('-').replace(/\W/g, '')}`);
    const result = await launch(sandbox, args, { log });
    assert.equal(result.code, 0, `${args.join(' ')}: ${result.stderr}`);
    if (args[0] === '--version') {
      assert.equal(result.stdout, 'codex-cli 0.167.2\n');
      continue;
    }
    assert.equal(result.stdout, `${JSON.stringify({ fake: 'codex', args })}\n`);
    const [record] = await readRecords(log);
    assert.deepEqual(record.args, args);
    // T3's env reaches Codex as it was: no Subconscious key, no catalog.
    const expected = sandbox.t3Env({ FAKE_CODEX_LOG: log });
    for (const [name, value] of Object.entries(expected))
      if (name !== 'PATH') assert.equal(record.env[name], value, name);
    assert.equal(record.env.SUBCONSCIOUS_CODEX_LAUNCH, undefined);
    assert.equal(record.catalogPath, undefined);
  }
  assert.equal(gateway.requests.length, requests, 'no network request');
  assert.deepEqual(await snapshot(sandbox.subc), before, 'no file written');
});

test('other Codex commands are refused before Codex runs', {
  skip,
}, async () => {
  const sandbox = installed;
  for (const args of [
    [],
    ['login'],
    ['resume', '--last'],
    ['mcp', 'add', 'x', '--', 'cmd'],
    ['app-server', 'daemon', 'start'],
    ['-c', 'x=1', 'features', 'enable', 'apps'],
  ]) {
    const log = logFile(sandbox, 'refused');
    const result = await launch(sandbox, args, { log });
    assert.notEqual(result.code, 0, args.join(' '));
    assert.equal(result.stdout, '');
    assert.match(
      result.stderr,
      /not available through the Subconscious provider/,
    );
    assert.deepEqual(await readRecords(log), []);
  }
});

test('a rejected key stops the launch even when the public list answers', {
  skip,
}, async () => {
  const sandbox = await installedBox();
  const profile = path.join(sandbox.subc, 'profiles', 'default.env');
  await fs.writeFile(
    profile,
    `GATEWAY_URL=${gateway.url}\nAPI_KEY=sk-rejected-key\nMODEL=UNSET\n`,
  );
  const log = logFile(sandbox, 'rejected');
  const result = await launch(sandbox, ['app-server'], { log });
  assert.notEqual(result.code, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /did not return the model catalog for this key/);
  assert.ok(!result.stderr.includes('sk-rejected-key'));
  assert.deepEqual(await readRecords(log), []);

  // An unreachable gateway is refused too: no packaged fallback.
  await fs.writeFile(
    profile,
    `GATEWAY_URL=http://127.0.0.1:9\nAPI_KEY=${GOOD_KEY}\nMODEL=UNSET\n`,
  );
  const offline = await launch(sandbox, ['exec', '-'], { log });
  assert.notEqual(offline.code, 0);
  assert.match(offline.stderr, /Could not read the model catalog/);
  assert.ok(!offline.stderr.includes(GOOD_KEY));
  assert.deepEqual(await readRecords(log), []);
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

test('install ignores inherited keys and gateways', { skip }, async () => {
  const sandbox = await box({ apiKey: '' });
  const result = await subc(sandbox, ['t3', 'install', '--dry-run'], {
    SUBCONSCIOUS_API_KEY: GOOD_KEY,
    CODEX_API_KEY: GOOD_KEY,
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /no saved API key/);
});

test("T3 Code's environment cannot tune Codex past the profile", {
  skip,
}, async () => {
  const sandbox = installed;
  const log = logFile(sandbox, 't3-tuning');
  const result = await launch(sandbox, ['app-server'], {
    log,
    env: {
      CODEX_API_KEY: 'sk-openai-from-t3',
      CODEX_EXTERNAL_TOOLS: 'true',
      CODEX_REASONING_EFFORT: 'low',
      CODEX_CONTEXT_WINDOW: '1234',
      MAX_CONCURRENT_SUBAGENTS: '99',
    },
  });
  assert.equal(result.code, 0, result.stderr);
  const [record] = await readRecords(log);
  assert.ok(record.args.includes('features.apps=false'));
  assert.ok(record.args.includes('features.plugins=false'));
  assert.ok(record.args.includes('apps._default.enabled=false'));
  assert.ok(!record.args.includes('model_reasoning_effort=low'));
  assert.ok(
    !record.args.includes('agents.max_concurrent_threads_per_session=99'),
  );
  assert.ok(
    record.catalog.models.every((model) => model.context_window !== 1234),
  );
  assert.equal(record.env.CODEX_API_KEY, undefined);
  assert.notEqual(record.env.CODEX_EXTERNAL_TOOLS, 'true');
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

function processesUnder(root) {
  return execFileSync('ps', ['-Ao', 'pid=,command='], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.includes(root) && !line.includes('ps -Ao'));
}

test('killing the launcher 200 times leaves no process behind', {
  skip,
  timeout: 240_000,
}, async () => {
  const sandbox = await installedBox();
  const cycle = async (i) => {
    const child = spawn(sandbox.launcher, ['app-server'], {
      env: sandbox.t3Env({ FAKE_CODEX_SLEEP: '60000' }),
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    // Most kills land while Node computes the plan; every fourth lands after
    // the exec, when the process T3 started is Codex.
    const delay = i % 4 === 0 ? 700 + (i % 7) * 50 : (i * 7) % 90;
    await new Promise((resolve) => setTimeout(resolve, delay));
    const exited = new Promise((resolve) => child.on('exit', resolve));
    child.kill('SIGKILL');
    await exited;
  };
  for (let start = 0; start < 200; start += 20)
    await Promise.all(
      Array.from({ length: 20 }, (_, offset) => cycle(start + offset)),
    );
  let left = processesUnder(sandbox.root);
  for (let waited = 0; left.length && waited < 10_000; waited += 100) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    left = processesUnder(sandbox.root);
  }
  assert.deepEqual(left, []);
  const entries = await fs.readdir(sandbox.catalogDir);
  assert.ok(
    entries.filter((name) => name !== 'model-catalog.json').length <= 20,
    `temp catalogs are bounded: ${entries.length}`,
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
  await assert.rejects(fs.access(sandbox.state));
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
  // A launcher an older subc wrote is reported as stale.
  const current = await fs.readFile(sandbox.launcher, 'utf8');
  await fs.writeFile(
    sandbox.launcher,
    current.replace(/\(subconscious-cli [^)]+\)/, '(subconscious-cli 0.0.1)'),
  );
  const skewed = await subc(sandbox, ['t3', 'status']);
  assert.match(skewed.stdout, /stale \(written by subc 0\.0\.1/);
  await fs.writeFile(sandbox.launcher, current);
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

test('install from a package path with spaces pins that adapter', {
  skip,
}, async () => {
  const sandbox = await box();
  const pkg = path.join(sandbox.root, 'package dir');
  await fs.cp(path.join(ROOT, 'bin'), path.join(pkg, 'bin'), {
    recursive: true,
  });
  await fs.copyFile(
    path.join(ROOT, 'package.json'),
    path.join(pkg, 'package.json'),
  );
  const result = await run(
    process.execPath,
    [path.join(pkg, 'bin', 'cli.js'), 't3', 'install'],
    { env: sandbox.env },
  );
  assert.equal(result.code, 0, result.stderr);
  const launcher = await fs.readFile(sandbox.launcher, 'utf8');
  assert.ok(
    launcher.includes(`subc_adapter='${path.join(pkg, 'bin', 't3-codex.js')}'`),
  );
  const log = logFile(sandbox, 'spaces');
  const started = await launch(sandbox, ['app-server'], { log });
  assert.equal(started.code, 0, started.stderr);
  const [record] = await readRecords(log);
  assert.equal(record.args.at(-1), 'app-server');
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
