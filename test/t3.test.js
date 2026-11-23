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
import {
  LAUNCHER_SHEBANG,
  launcherScript,
  restartWithCallerEnv,
} from '../bin/t3-launch.js';
import { CODEX_PROVIDER } from '../bin/t3-providers.js';
import {
  exportedFunctions,
  fakeGateway,
  fakeT3Server,
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

test('install adds the provider, the launcher, and hooks in ~/.codex', {
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

  const hooks = JSON.parse(
    await fs.readFile(path.join(sandbox.codexHome, 'hooks.json'), 'utf8'),
  );
  for (const event of ['PreCompact', 'PostCompact']) {
    assert.equal(hooks.hooks[event].length, 1, event);
    assert.equal(
      hooks.hooks[event][0].hooks[0].command,
      path.join(sandbox.codexHome, 'subconscious-hook.sh'),
    );
  }
  const envFile = path.join(sandbox.codexHome, 'subconscious-hooks.env');
  assert.equal((await fs.stat(envFile)).mode & 0o777, 0o600);
  // subc keeps no state file; status reads the files themselves.
  await assert.rejects(fs.access(sandbox.state));
  assert.ok(!(await fs.readFile(sandbox.launcher, 'utf8')).includes(GOOD_KEY));
  assert.ok(!text.includes(GOOD_KEY), 'no key in T3 settings');

  // subc adds only its hook files to ~/.codex. The user's config is kept.
  assert.deepEqual((await fs.readdir(sandbox.codexDir)).sort(), [
    'config.toml',
    'hooks.json',
    'subconscious-hook.sh',
    'subconscious-hooks.env',
  ]);
  assert.equal(
    await fs.readFile(path.join(sandbox.codexDir, 'config.toml'), 'utf8'),
    'model = "gpt-user"\n[mcp_servers.user]\ncommand = "user-mcp"\n',
  );
});

test('a second install changes nothing', { skip }, async () => {
  const sandbox = await installedBox();
  const files = [
    sandbox.settingsPath,
    sandbox.launcher,
    path.join(sandbox.codexHome, 'hooks.json'),
    path.join(sandbox.codexHome, 'subconscious-hook.sh'),
    path.join(sandbox.codexHome, 'subconscious-hooks.env'),
  ];
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
  assert.equal(env.SUBCONSCIOUS_CODEX_LAUNCH, 'subc');
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

test('repeated probes keep one catalog file and never touch the hooks', {
  skip,
}, async () => {
  const sandbox = await installedBox();
  const hookFiles = [
    'hooks.json',
    'subconscious-hook.sh',
    'subconscious-hooks.env',
  ].map((name) => path.join(sandbox.codexHome, name));
  const hooksBefore = await Promise.all(hookFiles.map(mtime));
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
  assert.deepEqual(await Promise.all(hookFiles.map(mtime)), hooksBefore);
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
  assert.match(status.stdout, /2 entries, env file present \(mode 600\)/);

  const result = await subc(sandbox, ['t3', 'uninstall']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(gateway.requests.length, requests, 'no network request');
  const settings = JSON.parse(await fs.readFile(sandbox.settingsPath, 'utf8'));
  assert.deepEqual(Object.keys(settings.providerInstances), ['claudeAgent']);
  assert.deepEqual(settings.futureTopLevelSetting, { keep: [1, 2, 3] });
  await assert.rejects(fs.access(sandbox.launcher));
  await assert.rejects(fs.access(sandbox.state));
  await assert.rejects(fs.access(sandbox.catalogDir));
  // The hooks in ~/.codex also serve plain `subc codex`, so they stay.
  const hooks = JSON.parse(
    await fs.readFile(path.join(sandbox.codexHome, 'hooks.json'), 'utf8'),
  );
  assert.ok(JSON.stringify(hooks).includes('subconscious-hook.sh'));
  for (const name of ['subconscious-hook.sh', 'subconscious-hooks.env'])
    await fs.access(path.join(sandbox.codexHome, name));
  assert.equal(
    await fs.readFile(path.join(sandbox.codexDir, 'config.toml'), 'utf8'),
    'model = "gpt-user"\n[mcp_servers.user]\ncommand = "user-mcp"\n',
  );
  assert.match(result.stdout, /Kept the compaction hooks in .*subc codex/);

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

test('install stops before T3 settings when hook setup fails', {
  skip,
}, async () => {
  const sandbox = await box();
  await fs.mkdir(sandbox.codexHome, { recursive: true });
  await fs.writeFile(path.join(sandbox.codexHome, 'hooks.json'), '{ not json');
  const settings = await fs.readFile(sandbox.settingsPath, 'utf8');
  const result = await subc(sandbox, ['t3', 'install']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /T3 Code settings were not changed/);
  assert.match(
    result.stderr,
    /launcher .* stays; subc t3 uninstall removes it/,
  );
  assert.equal(await fs.readFile(sandbox.settingsPath, 'utf8'), settings);
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
    // The message names where each file really is, and does not promise
    // that uninstall removes the hooks.
    const stderr = result.stderr.replace(/\s+/g, ' ');
    assert.ok(stderr.includes(`The launcher ${sandbox.launcher} is in place`));
    assert.ok(
      stderr.includes(
        `compaction hooks are in ${sandbox.codexHome}, shared with subc codex`,
      ),
    );
    assert.match(stderr, /subc t3 uninstall removes only the launcher/);
    assert.doesNotMatch(stderr, /under .*\.subconscious/);
    assert.doesNotMatch(stderr, /uninstall to remove them/);
    const status = await subc(sandbox, ['t3', 'status']);
    assert.match(status.stdout, /subconscious-codex: not installed/);
    assert.match(status.stdout, /Hooks\s+2 entries, env file present/);
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

test('help explains the scope and limits', { skip }, async () => {
  const sandbox = await box();
  for (const args of [['t3', 'help'], ['help', 't3'], ['t3']]) {
    const result = await subc(sandbox, args);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Codex, Claude Code, or OpenCode/);
    assert.match(result.stdout, /default profile only/);
    assert.match(result.stdout, /uses your ~\/\.claude/);
    assert.match(result.stdout, /switch a running thread/);
    assert.match(result.stdout, /runs as the default profile's\s+model/);
    assert.match(result.stdout, /macOS and Linux/);
    assert.match(result.stdout, /same Codex home as subc codex/);
    assert.match(result.stdout, /\/hooks/);
    assert.match(result.stdout, /never edits your\s+config\.toml/);
  }
  const top = await subc(sandbox, ['help']);
  assert.match(top.stdout, /t3 .*T3 Code/);
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

test('status flags hook entries that run another path, and install fixes them', {
  skip,
}, async () => {
  const sandbox = await installedBox();
  const hooksJson = path.join(sandbox.codexHome, 'hooks.json');
  const hookScript = path.join(sandbox.codexHome, 'subconscious-hook.sh');
  const text = await fs.readFile(hooksJson, 'utf8');
  await fs.writeFile(
    hooksJson,
    text.split(hookScript).join('/old/home/.codex/subconscious-hook.sh'),
  );
  const stale = await subc(sandbox, ['t3', 'status']);
  assert.equal(stale.code, 1, stale.stderr);
  assert.match(stale.stdout, /2 entries, 2 run another path/);

  const result = await subc(sandbox, ['t3', 'install']);
  assert.equal(result.code, 0, result.stderr);
  const hooks = JSON.parse(await fs.readFile(hooksJson, 'utf8')).hooks;
  for (const event of ['PreCompact', 'PostCompact'])
    assert.equal(hooks[event][0].hooks[0].command, hookScript);
  const fixed = await subc(sandbox, ['t3', 'status']);
  assert.doesNotMatch(fixed.stdout, /run another path/);
});

test('a BASH_ENV that prints cannot reach stdout', { skip }, async () => {
  const sandbox = installed;
  const startup = path.join(sandbox.root, 'startup file.sh');
  await fs.writeFile(startup, 'echo "hello from BASH_ENV"\n');
  const env = { BASH_ENV: startup, ENV: startup };
  const log = logFile(sandbox, 'bash-env');
  const result = await launch(sandbox, ['app-server'], { log, env });
  assert.equal(result.code, 0, result.stderr);
  const [record] = await readRecords(log);
  assert.equal(
    result.stdout,
    `${JSON.stringify({ fake: 'codex', args: record.args })}\n`,
  );
  assert.equal(record.env.BASH_ENV, undefined);
  assert.equal(record.env.ENV, undefined);
  const version = await launch(sandbox, ['--version'], { env });
  assert.equal(version.code, 0, version.stderr);
  assert.equal(version.stdout, 'codex-cli 0.167.2\n');
});

test('the configured plan unsets BASH_ENV and ENV before run.sh', {
  skip,
}, async () => {
  const sandbox = installed;
  // The launcher already unsets both, so the adapter must unset them even
  // when its own env does not have them.
  const result = await run(
    process.execPath,
    [
      path.join(ROOT, 'bin', 't3-codex.js'),
      '--codex',
      path.join(sandbox.bin, 'codex'),
      '--config-dir',
      sandbox.subc,
      '--',
      'app-server',
    ],
    { env: sandbox.env },
  );
  assert.equal(result.code, 0, result.stderr);
  const fields = result.stdout.split('\0');
  const records = [];
  for (let i = 0; i + 1 < fields.length; i += 2)
    records.push([fields[i], fields[i + 1]]);
  const unset = records.filter(([kind]) => kind === 'unset').map(([, v]) => v);
  assert.ok(unset.includes('BASH_ENV'));
  assert.ok(unset.includes('ENV'));
  assert.ok(
    !records.some(
      ([kind, value]) => kind === 'env' && /^(BASH_)?ENV=/.test(value),
    ),
  );
  const args = records.filter(([kind]) => kind === 'arg').map(([, v]) => v);
  // Privileged bash, so run.sh imports no function from T3 Code's env.
  assert.deepEqual(args.slice(0, 2), ['bash', '-p']);
  assert.match(args[2], /runbook[/\\]codex[/\\]run\.sh$/);
});

test('an exported shell function in the env never runs, and stdout stays clean', {
  skip,
}, async () => {
  const sandbox = installed;
  const marker = path.join(sandbox.root, 'codex-function-ran');
  const log = logFile(sandbox, 'bash-func');
  const result = await launch(sandbox, ['app-server'], {
    log,
    env: exportedFunctions(marker),
  });
  assert.equal(result.code, 0, result.stderr);
  const [record] = await readRecords(log);
  assert.equal(
    result.stdout,
    `${JSON.stringify({ fake: 'codex', args: record.args })}\n`,
  );
  await assert.rejects(fs.lstat(marker), { code: 'ENOENT' });
});

test('status reads the hooks from disk after subc codex uninstall', {
  skip,
}, async () => {
  const sandbox = await installedBox();
  // A state file from subc 8.2.0 that says the hooks are installed. Nothing
  // reads it now.
  await fs.writeFile(
    sandbox.state,
    `${JSON.stringify({ schema: 1, hooks: 'installed' })}\n`,
  );
  const removed = await subc(sandbox, ['codex', 'uninstall']);
  assert.equal(removed.code, 0, removed.stderr);
  const status = await subc(sandbox, ['t3', 'status']);
  assert.equal(status.code, 1, status.stderr);
  assert.match(status.stdout, /subconscious-codex: installed/);
  assert.match(
    status.stdout,
    /Hooks\s+missing from .*hooks\.json, so T3 Code sessions run without them\. Run subc t3 install --provider codex to set them up again/,
  );
  assert.doesNotMatch(status.stdout, /set up by subc t3 install/);

  const restored = await subc(sandbox, ['t3', 'install']);
  assert.equal(restored.code, 0, restored.stderr);
  const after = await subc(sandbox, ['t3', 'status']);
  assert.match(
    after.stdout,
    /Hooks\s+2 entries, env file present \(mode 600\)/,
  );

  await fs.rm(path.join(sandbox.codexHome, 'subconscious-hooks.env'));
  const partial = await subc(sandbox, ['t3', 'status']);
  assert.match(
    partial.stdout,
    /2 entries, env file missing; run subc t3 install --provider codex to fix/,
  );
});

test('install, status, and uninstall report the old Codex home and keep it', {
  skip,
}, async () => {
  const sandbox = await installedBox();
  const old = sandbox.legacyCodexHome;
  const keyFile = path.join(old, 'subconscious-hooks.env');
  const thread = path.join(old, 'sessions', 'rollout-old.jsonl');
  await fs.mkdir(path.dirname(thread), { recursive: true });
  await fs.writeFile(keyFile, 'API_KEY=sk-old-home-fake\n', { mode: 0o600 });
  await fs.writeFile(thread, '{}\n');
  await fs.writeFile(sandbox.state, '{"schema":1}\n');
  for (const args of [
    ['t3', 'status'],
    ['t3', 'install', '--dry-run'],
    ['t3', 'uninstall'],
  ]) {
    const result = await subc(sandbox, args);
    assert.equal(result.code, 0, `${args.join(' ')}: ${result.stderr}`);
    const out = result.stdout.replace(/\s+/g, ' ');
    assert.ok(
      out.includes(
        `${old} is the separate Codex home from subc before 8.2.0. subc no longer uses it and does not delete it.`,
      ),
      args.join(' '),
    );
    assert.ok(
      out.includes(`It holds a key file. Remove it with: rm '${keyFile}'`),
      args.join(' '),
    );
    assert.match(out, /threads made before 8\.2\.0\. They are your data/);
    assert.ok(!out.includes('sk-old-home-fake'));
  }
  // The legacy state file is gone; the old home is kept.
  await assert.rejects(fs.access(sandbox.state));
  await fs.access(keyFile);
  await fs.access(thread);
  const after = await subc(sandbox, ['t3', 'status']);
  assert.match(after.stdout, /Old home/);
});

test('--provider selects a provider, and refuses one that is not available', {
  skip,
}, async () => {
  const sandbox = await box();
  const settings = await fs.readFile(sandbox.settingsPath, 'utf8');
  for (const [args, message] of [
    [
      ['t3', 'install', '--provider', 'opencode'],
      /OpenCode CLI is not installed/,
    ],
    [['t3', 'install', '--provider', 'cursor'], /Unknown provider: cursor/],
    [['t3', 'status', '--provider'], /--provider needs a name/],
    [['t3', 'status', '--dry-run'], /Unknown argument for subc t3 status/],
  ]) {
    const result = await subc(sandbox, args);
    assert.equal(result.code, 1, args.join(' '));
    assert.match(result.stderr, message);
  }
  assert.equal(await fs.readFile(sandbox.settingsPath, 'utf8'), settings);
  await assert.rejects(fs.access(sandbox.launcher));

  const dry = await subc(sandbox, [
    't3',
    'install',
    '--provider',
    'codex',
    '--dry-run',
  ]);
  assert.equal(dry.code, 0, dry.stderr);
  assert.match(dry.stdout, /Plan: Subconscious \(Codex\) in T3 Code/);
  const result = await subc(sandbox, [
    't3',
    'install',
    '--provider=codex',
    '--provider',
    'codex',
  ]);
  assert.equal(result.code, 0, result.stderr);
  const status = await subc(sandbox, ['t3', 'status', '--provider', 'codex']);
  assert.match(status.stdout, /subconscious-codex: installed/);
  const removed = await subc(sandbox, [
    't3',
    'uninstall',
    '--provider',
    'codex',
  ]);
  assert.equal(removed.code, 0, removed.stderr);
  await assert.rejects(fs.access(sandbox.launcher));

  const help = await subc(sandbox, ['t3', 'help']);
  assert.match(help.stdout, /--provider NAME/);
  assert.match(help.stdout, /Available: codex, claude, opencode\./);
  assert.doesNotMatch(help.stdout, /Not available yet/);
});

test('status reports a launcher in an older format, and install rewrites it', {
  skip,
}, async () => {
  const sandbox = await installedBox();
  const current = await fs.readFile(sandbox.launcher, 'utf8');
  // The 8.2.0 launcher, written by this subc version.
  await fs.writeFile(
    sandbox.launcher,
    current
      .replace(`${LAUNCHER_SHEBANG}\n`, '#!/usr/bin/env bash\n')
      .replace('unset BASH_ENV ENV\n', ''),
  );
  const old = await subc(sandbox, ['t3', 'status']);
  assert.match(
    old.stdout,
    /stale \(written in an older format\); run subc t3 install/,
  );
  const result = await subc(sandbox, ['t3', 'install']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(await fs.readFile(sandbox.launcher, 'utf8'), current);
  const fixed = await subc(sandbox, ['t3', 'status']);
  assert.match(fixed.stdout, /subc-t3-codex: current/);
});

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('a launcher with a watchdog stops the agent after T3 Code dies', {
  skip,
  timeout: 30_000,
}, async () => {
  const sandbox = installed;
  // OpenCode sets watchdog. This test renders it for Codex too, so the
  // watchdog also works for an agent that is not a server. The Codex
  // adapter never asks for the watchdog, so a wrapper adds the `watch`
  // record to its plan.
  const file = path.join(sandbox.root, 'watchdog launcher');
  const wrapper = path.join(sandbox.root, 'watch-adapter.cjs');
  await fs.writeFile(
    wrapper,
    `const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, [${JSON.stringify(path.join(ROOT, 'bin', 't3-codex.js'))}, ...process.argv.slice(2)], { stdio: ['ignore', 'pipe', 'inherit'] });
process.stdout.write(Buffer.concat([result.stdout, Buffer.from('watch\\0\\0')]));
process.exit(result.status ?? 1);
`,
  );
  await fs.writeFile(
    file,
    launcherScript({
      provider: { ...CODEX_PROVIDER, watchdog: true },
      node: process.execPath,
      adapter: wrapper,
      binary: path.join(sandbox.bin, 'codex'),
      configDir: sandbox.subc,
      version: 'test',
    }),
    { mode: 0o755 },
  );
  const log = logFile(sandbox, 'watchdog');
  // The bash process plays the T3 Code server that started the launcher.
  const server = spawn('bash', ['-c', '"$0" help exec & wait', file], {
    env: sandbox.t3Env({ FAKE_CODEX_LOG: log, FAKE_CODEX_SLEEP: '60000' }),
    stdio: 'ignore',
  });
  let records = [];
  for (let waited = 0; !records.length && waited < 10_000; waited += 50) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    records = await readRecords(log);
  }
  const { pid } = records[0];
  await new Promise((resolve) => setTimeout(resolve, 2500));
  assert.ok(alive(pid), 'the agent runs while its parent lives');
  const exited = new Promise((resolve) => server.on('exit', resolve));
  server.kill('SIGKILL');
  await exited;
  let waited = 0;
  for (; alive(pid) && waited < 10_000; waited += 100)
    await new Promise((resolve) => setTimeout(resolve, 100));
  if (alive(pid)) process.kill(pid, 'SIGKILL');
  assert.ok(waited < 10_000, 'the watchdog stopped the agent within 10 s');
});

test('status exits 0 when everything installed works, or nothing is installed', {
  skip,
}, async () => {
  const empty = await box();
  for (const args of [
    ['t3', 'status'],
    ['t3', 'status', '--provider', 'codex'],
    ['t3', 'status', '--provider', 'claude', '--provider', 'opencode'],
  ]) {
    const result = await subc(empty, args);
    assert.equal(result.code, 0, `${args.join(' ')}\n${result.stdout}`);
    assert.doesNotMatch(result.stdout, /Broken:/);
  }
  const healthy = await installedBox();
  const result = await subc(healthy, ['t3', 'status']);
  assert.equal(result.code, 0, result.stdout);
  assert.match(result.stdout, /subconscious-codex: installed/);
  assert.match(result.stdout, /subconscious-claude: not installed/);
  assert.doesNotMatch(result.stdout, /Broken:/);
});

test('status exits 1 for drift, a missing launcher, missing hooks, or a conflict', {
  skip,
}, async () => {
  const broken = async (sandbox, reason) => {
    const result = await subc(sandbox, ['t3', 'status']);
    assert.equal(result.code, 1, result.stdout);
    assert.match(result.stdout, /Broken: Subconscious \(Codex\): /);
    assert.match(result.stdout, reason);
    assert.ok(!result.stdout.includes(GOOD_KEY));
    return result;
  };

  const drift = await installedBox();
  const settings = JSON.parse(await fs.readFile(drift.settingsPath, 'utf8'));
  settings.providerInstances['subconscious-codex'].displayName = 'Renamed';
  await fs.writeFile(drift.settingsPath, JSON.stringify(settings));
  await broken(drift, /drift in displayName/);

  const launcher = await installedBox();
  await fs.rm(launcher.launcher);
  await broken(launcher, /launcher missing/);
  // A launcher that subc did not write is broken too.
  await fs.writeFile(launcher.launcher, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await broken(launcher, /launcher foreign/);

  const hooks = await installedBox();
  const removed = await subc(hooks, ['codex', 'uninstall']);
  assert.equal(removed.code, 0, removed.stderr);
  await broken(hooks, /missing or broken Codex hooks/);

  const conflict = await box({
    settings: `${JSON.stringify({
      providerInstances: {
        'subconscious-codex': {
          driver: 'codex',
          config: { binaryPath: '/usr/local/bin/codex' },
        },
      },
    })}\n`,
  });
  await broken(conflict, /an entry that subc did not write/);

  // An entry without its launcher is broken, and a launcher without its
  // entry is too.
  const orphan = await installedBox();
  const kept = JSON.parse(await fs.readFile(orphan.settingsPath, 'utf8'));
  delete kept.providerInstances['subconscious-codex'];
  await fs.writeFile(orphan.settingsPath, JSON.stringify(kept));
  await broken(orphan, /a launcher with no entry in T3 Code/);

  const fixed = await subc(drift, ['t3', 'install']);
  assert.equal(fixed.code, 0, fixed.stderr);
  assert.equal((await subc(drift, ['t3', 'status'])).code, 0);
});

test('status names the install command that repairs each broken provider', {
  skip,
}, async () => {
  const sandbox = await installedBox();
  await fs.rm(sandbox.launcher);
  const result = await subc(sandbox, ['t3', 'status']);
  assert.equal(result.code, 1, result.stdout);
  assert.match(
    result.stdout,
    /To repair it, run: subc t3 install --provider codex\n/,
  );
  assert.doesNotMatch(result.stdout, /--provider claude|--provider opencode/);
});

test("status shows T3 Code's failed check, says how to fix the key, and exits 1", {
  skip,
}, async () => {
  const sandbox = await installedBox();
  // No cache yet: T3 Code has not checked the provider. That is not broken.
  const fresh = await subc(sandbox, ['t3', 'status', '--provider', 'codex']);
  assert.equal(fresh.code, 0, fresh.stdout);
  assert.match(fresh.stdout, /T3 check\s+none recorded yet/);

  await writeT3ModelCache(sandbox, {
    instanceId: 'subconscious-codex',
    builtIns: [],
    reported: MODELS,
    checkedAt: '2026-11-23T19:40:00.000Z',
  });
  const ready = await subc(sandbox, ['t3', 'status', '--provider', 'codex']);
  assert.equal(ready.code, 0, ready.stdout);
  assert.match(
    ready.stdout,
    /T3 check\s+ready, checked 2026-11-23T19:40:00\.000Z/,
  );

  // The bad key case from the live test: T3 Code reports error, with the
  // adapter's 401 line as its message.
  await writeT3ModelCache(sandbox, {
    instanceId: 'subconscious-codex',
    builtIns: [],
    status: 'error',
    auth: { status: 'unknown' },
    message:
      'subc-t3-codex: Could not read the model catalog from http://127.0.0.1:1: Model discovery returned HTTP 401.',
  });
  const failed = await subc(sandbox, ['t3', 'status', '--provider', 'codex']);
  assert.equal(failed.code, 1, failed.stdout);
  assert.match(
    failed.stdout,
    /T3 check\s+error, checked .*Model discovery returned HTTP 401\./,
  );
  assert.match(failed.stdout, /run subc login/);
  assert.match(failed.stdout, /restart T3 Code/);
  assert.match(
    failed.stdout,
    /Broken: Subconscious \(Codex\): T3 Code reports a failed check\./,
  );
  // Install cannot fix a rejected key, so status does not suggest it.
  assert.doesNotMatch(failed.stdout, /To repair it, run/);
  assert.ok(!failed.stdout.includes(GOOD_KEY));
});

test('status notes that a T3 Code project can override text generation', {
  skip,
}, async () => {
  const sandbox = await box();
  const result = await subc(sandbox, ['t3', 'status']);
  assert.match(
    result.stdout,
    /A T3 Code project can override them in its own settings/,
  );
});

test('install waits for the T3 Code check only while a T3 Code server runs', {
  skip,
}, async () => {
  const { t3ServerRunning } = await import('../bin/t3-settings.js');
  const sandbox = await box();
  assert.equal(await t3ServerRunning(sandbox.t3Home), false);
  const stop = await fakeT3Server(sandbox);
  assert.equal(await t3ServerRunning(sandbox.t3Home), true);
  await stop();
  // A file that a crashed server left names a PID that has ended.
  const ended = await run(process.execPath, ['-e', '']);
  const runtime = path.join(sandbox.t3Home, 'userdata', 'server-runtime.json');
  await fs.writeFile(runtime, JSON.stringify({ version: 1, pid: ended.pid }));
  assert.equal(await t3ServerRunning(sandbox.t3Home), false);
  await fs.writeFile(runtime, JSON.stringify({ managedPolicy: null }));
  assert.equal(await t3ServerRunning(sandbox.t3Home), false);
});

test('status exits 1 when the pinned CLI is older than install accepts', {
  skip,
}, async () => {
  const sandbox = await installedBox();
  const codex = path.join(sandbox.bin, 'codex');
  const text = await fs.readFile(codex, 'utf8');
  await fs.writeFile(
    codex,
    text.replace('codex-cli 0.167.2', 'codex-cli 0.1.0'),
  );
  const result = await subc(sandbox, ['t3', 'status']);
  assert.equal(result.code, 1, result.stdout);
  assert.match(result.stdout, /\(0\.1\.0\) is older than /);
  assert.match(result.stdout, /a CLI version that install refuses/);
});

test("status says T3 Code's default text generation is not Subconscious", {
  skip,
}, async () => {
  const sandbox = await installedBox();
  const result = await subc(sandbox, ['t3', 'status']);
  assert.equal(result.code, 0, result.stdout);
  assert.match(
    result.stdout,
    /Text gen\s+\S*Thread titles and commit messages go to codex, T3 Code's default, not to Subconscious\./,
  );
  assert.match(
    result.stdout,
    /open Settings in T3 Code, then Text generation, and pick a Subconscious provider\. subc never changes this setting\./,
  );
});

test('status names the Subconscious provider that writes titles and commit messages', {
  skip,
}, async () => {
  const sandbox = await installedBox();
  const settings = JSON.parse(await fs.readFile(sandbox.settingsPath, 'utf8'));
  settings.textGenerationModelSelection = {
    instanceId: 'subconscious-codex',
    model: MODELS[0],
  };
  await fs.writeFile(sandbox.settingsPath, JSON.stringify(settings));
  const before = await fs.readFile(sandbox.settingsPath, 'utf8');
  const result = await subc(sandbox, ['t3', 'status']);
  assert.equal(result.code, 0, result.stdout);
  assert.match(
    result.stdout,
    /Thread titles and commit messages go to Subconscious: Subconscious \(Codex\) \(subconscious-codex\), model subconscious\/sandbox-a\./,
  );
  assert.doesNotMatch(result.stdout, /not to Subconscious/);
  assert.doesNotMatch(result.stdout, /pick a Subconscious provider/);

  // A separate commit message model that is not Subconscious gets its own
  // warning, and a hint for its own setting.
  settings.sourceControlWriterModelSelection = {
    instanceId: 'claudeAgent',
    model: 'claude-sonnet-5-5',
  };
  await fs.writeFile(sandbox.settingsPath, JSON.stringify(settings));
  const split = await subc(sandbox, ['t3', 'status']);
  assert.match(split.stdout, /Thread titles go to Subconscious: /);
  assert.match(
    split.stdout,
    /Commit messages go to claudeAgent, model claude-sonnet-5-5, not to Subconscious\./,
  );
  assert.match(split.stdout, /Settings, Commits & pull requests/);

  // An entry with subc's ID that subc did not write is not Subconscious.
  const foreign = JSON.parse(before);
  foreign.providerInstances['subconscious-codex'].config.binaryPath =
    '/usr/local/bin/codex';
  await fs.writeFile(sandbox.settingsPath, JSON.stringify(foreign));
  const spoofed = await subc(sandbox, ['t3', 'status']);
  assert.match(
    spoofed.stdout,
    /go to Subconscious \(Codex\) \(subconscious-codex\), model subconscious\/sandbox-a, not to Subconscious\./,
  );
});

test('help names all three providers, --provider, status exit codes, and no test knob', {
  skip,
}, async () => {
  const sandbox = await box();
  const help = await subc(sandbox, ['t3', 'help']);
  assert.equal(help.code, 0, help.stderr);
  for (const name of [
    'Subconscious (Codex)',
    'Subconscious (Claude)',
    'Subconscious (OpenCode)',
    'subc-t3-codex',
    'subc-t3-claude',
    'subc-t3-opencode',
    '--provider NAME',
    'Exit codes:',
    'providerModelPreferences["subconscious-claude"]',
    'text\n    generation setting',
    'env -S bash -p',
  ])
    assert.ok(help.stdout.includes(name), name);
  assert.doesNotMatch(help.stdout, /SUBC_T3_CACHE_WAIT_MS/);
  assert.doesNotMatch(help.stdout, /—/);
  for (const row of help.stdout.split('\n')) assert.ok(row.length <= 80, row);
  const top = await subc(sandbox, ['help']);
  assert.match(top.stdout, /t3 .*Codex, Claude Code, and OpenCode/);
});
