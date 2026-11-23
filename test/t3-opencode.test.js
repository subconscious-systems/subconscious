import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isolateLaunchEnv } from '../bin/t3-launch.js';
import { OPENCODE_PROVIDER } from '../bin/t3-providers.js';
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
const ADAPTER = fileURLToPath(
  new URL('../bin/t3-opencode.js', import.meta.url),
);
const OURS = 'subconscious-opencode';
const FRESHNESS =
  'A new key or model applies after the OpenCode helper restarts: restart T3 Code, or wait until its OpenCode threads have been idle for 30 minutes.';
// The helper argv T3 Code 0.1.11 passes (OpenCodeRuntime.ts:601), with
// port 0 so the fake picks a free port.
const SERVE_ARGS = ['serve', '--hostname=127.0.0.1', '--port=0'];
const PROFILE = (gatewayUrl, key = GOOD_KEY, extra = '') =>
  `GATEWAY_URL=${gatewayUrl}\nAPI_KEY=${key}\nMODEL=UNSET\n${extra}`;

let gateway;
let installed;
const boxes = [];

async function box(options = {}) {
  const sandbox = await t3Sandbox({ gateway, withOpenCode: true, ...options });
  boxes.push(sandbox);
  return sandbox;
}

async function installedBox(options = {}, args = ['--provider', 'opencode']) {
  const sandbox = await box(options);
  const result = await subc(sandbox, ['t3', 'install', ...args]);
  assert.equal(result.code, 0, result.stderr);
  return sandbox;
}

function launch(sandbox, args, { log, env = {}, timeoutMs } = {}) {
  return run(sandbox.opencodeLauncher, args, {
    env: sandbox.openCodeT3Env({ FAKE_OPENCODE_LOG: log, ...env }),
    timeoutMs,
  });
}

const logFile = (sandbox, name) => path.join(sandbox.root, `${name}.log`);
const profileFile = (sandbox) =>
  path.join(sandbox.subc, 'profiles', 'default.env');
const readSettings = async (sandbox) =>
  JSON.parse(await fs.readFile(sandbox.settingsPath, 'utf8'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Every name in `env` whose value holds the key, sorted. */
function keyHolders(env, key = GOOD_KEY) {
  return Object.entries(env)
    .filter(([, value]) => String(value).includes(key))
    .map(([name]) => name)
    .sort();
}

async function missing(file) {
  try {
    await fs.lstat(file);
    return false;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
}

/** Each live process as pid, pgid, and command line. */
function processes() {
  return execFileSync('ps', ['-Ao', 'pid=,pgid=,command='], {
    encoding: 'utf8',
  })
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter(Boolean)
    .map(([, pid, pgid, command]) => ({
      pid: Number(pid),
      pgid: Number(pgid),
      command,
    }))
    .filter(({ command }) => !command.startsWith('ps -Ao'));
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function waitFor(check, ms) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value || Date.now() >= deadline) return value;
    await sleep(50);
  }
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

test('install --dry-run --provider opencode checks everything and writes nothing', {
  skip,
}, async () => {
  const sandbox = await box();
  const before = await snapshot(sandbox.home);
  const requests = gateway.requests.length;
  const result = await subc(sandbox, [
    't3',
    'install',
    '--provider',
    'opencode',
    '--dry-run',
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Plan: Subconscious \(OpenCode\) in T3 Code/);
  assert.ok(
    result.stdout.includes(`${sandbox.opencodeBin} (2.3.0)`),
    result.stdout,
  );
  assert.match(result.stdout, /OpenCode uses your ~\/\.config\/opencode/);
  assert.match(result.stdout, /read again when the helper starts/);
  assert.ok(result.stdout.includes(FRESHNESS), result.stdout);
  assert.match(result.stdout, /Dry run: nothing was changed/);
  assert.deepEqual(await snapshot(sandbox.home), before);
  assert.ok(gateway.requests.length > requests, 'the live catalog was read');
});

test('install adds subconscious-opencode with an empty server URL and password', {
  skip,
}, async () => {
  const sandbox = await box();
  const result = await subc(sandbox, [
    't3',
    'install',
    '--provider',
    'opencode',
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Subconscious \(OpenCode\) is ready in T3 Code/);
  const text = await fs.readFile(sandbox.settingsPath, 'utf8');
  const settings = JSON.parse(text);
  assert.deepEqual(settings.futureTopLevelSetting, { keep: [1, 2, 3] });
  assert.deepEqual(Object.keys(settings.providerInstances), [
    'claudeAgent',
    OURS,
  ]);
  // Both enabled flags: T3 Code decodes a missing config.enabled as false.
  assert.deepEqual(settings.providerInstances[OURS], {
    driver: 'opencode',
    displayName: 'Subconscious (OpenCode)',
    enabled: true,
    config: { enabled: true, binaryPath: sandbox.opencodeLauncher },
  });
  assert.equal(settings.providerModelPreferences, undefined);
  assert.equal((await fs.stat(sandbox.opencodeLauncher)).mode & 0o777, 0o755);
  await assert.rejects(fs.access(sandbox.launcher), 'no Codex launcher');

  const launcher = await fs.readFile(sandbox.opencodeLauncher, 'utf8');
  assert.match(launcher, /^#!\/usr\/bin\/env -S bash -p\n/);
  assert.ok(
    launcher.includes(`\nsubc_opencode='${sandbox.opencodeBin}'\n`),
    launcher,
  );
  assert.match(launcher, /--opencode "\$subc_opencode"/);
  // The parent watchdog sits right before the exec.
  assert.match(
    launcher,
    /subc_parent=\$PPID\n[\s\S]*\nexec "\$\{subc_argv\[@\]\}"\n$/,
  );
  assert.ok(!launcher.includes(GOOD_KEY));
  assert.ok(!text.includes(GOOD_KEY));
  assert.ok(!`${result.stdout}${result.stderr}`.includes(GOOD_KEY));

  // The version check ran in a throwaway dir. The fake writes its log under
  // XDG_DATA_HOME, or ~/.local/share without it.
  assert.ok(await missing(sandbox.opencodeDataDir));
  assert.ok(await missing(sandbox.opencodeStateDir));
  assert.ok(await missing(sandbox.opencodeConfigDir));
  assert.ok(await missing(path.join(sandbox.home, '.cache', 'opencode')));
});

test("install keeps T3 Code's built-in opencode instance and every other setting", {
  skip,
}, async () => {
  const builtIn = {
    driver: 'opencode',
    enabled: true,
    config: { enabled: true, binaryPath: 'opencode' },
  };
  const sandbox = await box({
    settings: `${JSON.stringify(
      {
        projectSettingsFolded: true,
        providerInstances: { opencode: builtIn },
        futureTopLevelSetting: { keep: [1, 2, 3] },
      },
      null,
      2,
    )}\n`,
  });
  const result = await subc(sandbox, [
    't3',
    'install',
    '--provider',
    'opencode',
  ]);
  assert.equal(result.code, 0, result.stderr);
  const settings = await readSettings(sandbox);
  assert.deepEqual(Object.keys(settings), [
    'projectSettingsFolded',
    'providerInstances',
    'futureTopLevelSetting',
  ]);
  assert.deepEqual(settings.providerInstances.opencode, builtIn);
  assert.deepEqual(Object.keys(settings.providerInstances), ['opencode', OURS]);
  // The 2-space indent is kept.
  assert.match(
    await fs.readFile(sandbox.settingsPath, 'utf8'),
    /^\{\n {2}"projectSettingsFolded"/,
  );
});

test('install refuses OpenCode older than 2.0.18', { skip }, async () => {
  const sandbox = await box();
  const before = await snapshot(sandbox.home);
  for (const version of ['2.0.17', '1.19.6']) {
    const old = await subc(
      sandbox,
      ['t3', 'install', '--provider', 'opencode'],
      { FAKE_OPENCODE_VERSION: version },
    );
    assert.equal(old.code, 1, version);
    assert.ok(
      old.stderr.includes(
        `OpenCode ${version} is older than 2.0.18, the oldest version this provider supports`,
      ),
      old.stderr,
    );
  }
  assert.deepEqual(await snapshot(sandbox.home), before);
  const oldest = await subc(
    sandbox,
    ['t3', 'install', '--provider', 'opencode', '--dry-run'],
    { FAKE_OPENCODE_VERSION: '2.0.18' },
  );
  assert.equal(oldest.code, 0, oldest.stderr);
});

test('a serve launch uses only the default profile and the live catalog', {
  skip,
}, async () => {
  const sandbox = installed;
  const log = logFile(sandbox, 'serve');
  const result = await launch(sandbox, SERVE_ARGS, { log });
  assert.equal(result.code, 0, result.stderr);
  // T3 Code reads the helper's stdout for this line, and nothing comes
  // before it.
  assert.match(
    result.stdout,
    /^server listening on http:\/\/127\.0\.0\.1:\d+\n$/,
  );
  assert.equal(result.stderr, '');
  const [record] = await readRecords(log);
  // The process T3 Code started is the one that became `opencode serve`,
  // with T3 Code's args unchanged and in order.
  assert.equal(record.pid, result.pid);
  assert.deepEqual(record.args, SERVE_ARGS);

  const { config, env } = record;
  assert.deepEqual(config.enabled_providers, ['subconscious']);
  assert.deepEqual(Object.keys(config.provider), ['subconscious']);
  const provider = config.provider.subconscious;
  assert.equal(provider.options.baseURL, `${gateway.url}/v1`);
  assert.equal(provider.options.apiKey, '{env:SUBCONSCIOUS_API_KEY}');
  assert.deepEqual(Object.keys(provider.models), MODELS);
  assert.equal(config.model, `subconscious/${MODELS[0]}`);
  assert.equal(provider.models[MODELS[0]].limit.context, 5000000);
  assert.equal(env.SUBCONSCIOUS_API_KEY, GOOD_KEY);
  assert.equal(env.SUBCONSCIOUS_GATEWAY_URL, gateway.url);
  assert.equal(env.HOME, sandbox.home);
  // T3 Code's own names reach the helper.
  assert.equal(env.T3CODE_HOME, sandbox.t3Home);
});

test("T3 Code's OPENCODE_PASSWORD reaches the helper unchanged and its {} config is replaced", {
  skip,
}, async () => {
  const sandbox = installed;
  const log = logFile(sandbox, 'password');
  const result = await launch(sandbox, SERVE_ARGS, {
    log,
    env: { OPENCODE_SERVER_PASSWORD: 'v1-password-4567' },
  });
  assert.equal(result.code, 0, result.stderr);
  const [record] = await readRecords(log);
  assert.equal(record.env.OPENCODE_PASSWORD, 't3-helper-password-0123');
  assert.equal(record.env.OPENCODE_SERVER_PASSWORD, 'v1-password-4567');
  assert.notEqual(record.env.OPENCODE_CONFIG_CONTENT, '{}');
  assert.deepEqual(record.config.enabled_providers, ['subconscious']);
});

test('only SUBCONSCIOUS_API_KEY carries the key into the helper', {
  skip,
}, async () => {
  const sandbox = await installedBox();
  // Profile lines can hold more copies of the key under OpenCode names.
  await fs.appendFile(
    profileFile(sandbox),
    `OPENCODE_API_KEY=${GOOD_KEY}\nSUBC_OPENCODE_API_KEY=${GOOD_KEY}\nEXTRA_COPY=${GOOD_KEY}\n`,
  );
  const log = logFile(sandbox, 'key-copies');
  const result = await launch(sandbox, SERVE_ARGS, { log });
  assert.equal(result.code, 0, result.stderr);
  const [record] = await readRecords(log);
  assert.deepEqual(keyHolders(record.env), ['SUBCONSCIOUS_API_KEY']);
  for (const name of [
    'API_KEY',
    'OPENCODE_API_KEY',
    'SUBC_OPENCODE_API_KEY',
    'GATEWAY_URL',
    'MODEL',
    'SUBCONSCIOUS_MODELS',
    'OPENCODE_CONTEXT_LIMIT',
  ])
    assert.equal(record.env[name], undefined, name);
  assert.ok(
    Object.keys(record.env).every((name) => !name.startsWith('SUBC_')),
    'no SUBC_* name reaches OpenCode',
  );
  assert.ok(!record.args.join('\n').includes(GOOD_KEY), 'no key in argv');
  assert.ok(
    !JSON.stringify(record.config).includes(GOOD_KEY),
    'no key in the config',
  );
  assert.ok(!result.stderr.includes(GOOD_KEY), 'no key in stderr');
  assert.ok(!result.stdout.includes(GOOD_KEY), 'no key in stdout');
});

test('a hostile T3 Code env cannot steer the launch', { skip }, async () => {
  const sandbox = installed;
  const extra = path.join(sandbox.root, 'evil opencode.json');
  await fs.writeFile(
    extra,
    JSON.stringify({
      provider: { evil: { options: { apiKey: '{env:SUBCONSCIOUS_API_KEY}' } } },
    }),
  );
  // A BASH_ENV that prints would put text before the listening line.
  const bashEnv = path.join(sandbox.root, 'bash env.sh');
  await fs.writeFile(bashEnv, 'echo evil-bash-env\n');
  const log = logFile(sandbox, 'hostile');
  const requests = gateway.requests.length;
  const result = await launch(sandbox, SERVE_ARGS, {
    log,
    env: {
      SUBCONSCIOUS_API_KEY: 'sk-inherited-evil',
      SUBCONSCIOUS_BASE_URL: 'http://127.0.0.1:9/evil',
      SUBCONSCIOUS_GATEWAY_URL: 'http://127.0.0.1:9/evil',
      SUBCONSCIOUS_MODELS: 'evil/pinned-model',
      SUBCONSCIOUS_MODEL: 'evil/model',
      SUBC_CONFIG_DIR: path.join(sandbox.root, 'evil-config'),
      SUBC_MODEL_METADATA: '[]',
      SUBC_OPENCODE_API_KEY: 'sk-evil-subc-opencode',
      OPENCODE_API_KEY: 'sk-evil-opencode',
      OPENCODE_CONFIG: extra,
      OPENCODE_CONFIG_DIR: path.join(sandbox.root, 'evil-config-dir'),
      OPENCODE_CONTEXT_LIMIT: '7',
      OPENCODE_OUTPUT_LIMIT: '8',
      API_KEY: 'sk-evil-api-key',
      GATEWAY_URL: 'http://127.0.0.1:9/evil-gateway',
      MODEL: 'evil/model',
      BASH_ENV: bashEnv,
      ENV: bashEnv,
    },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.match(
    result.stdout,
    /^server listening on http:\/\/127\.0\.0\.1:\d+\n$/,
  );
  const [record] = await readRecords(log);
  const { env, config } = record;
  assert.equal(env.SUBCONSCIOUS_API_KEY, GOOD_KEY);
  assert.equal(env.SUBCONSCIOUS_GATEWAY_URL, gateway.url);
  for (const name of [
    'OPENCODE_API_KEY',
    'SUBC_OPENCODE_API_KEY',
    'OPENCODE_CONFIG',
    'OPENCODE_CONFIG_DIR',
    'OPENCODE_CONTEXT_LIMIT',
    'OPENCODE_OUTPUT_LIMIT',
    'API_KEY',
    'GATEWAY_URL',
    'MODEL',
    'SUBC_CONFIG_DIR',
    'BASH_ENV',
    'ENV',
  ])
    assert.equal(env[name], undefined, name);
  assert.equal(
    config.provider.subconscious.options.baseURL,
    `${gateway.url}/v1`,
  );
  assert.deepEqual(Object.keys(config.provider.subconscious.models), MODELS);
  assert.equal(
    config.provider.subconscious.models[MODELS[0]].limit.context,
    5000000,
  );
  assert.equal(
    config.provider.subconscious.models[MODELS[0]].limit.output,
    65536,
  );
  const values = `${Object.values(env).join('\n')}\n${JSON.stringify(config)}`;
  assert.ok(!values.includes('evil'), 'no hostile value reached OpenCode');
  const launches = gateway.requests.slice(requests);
  assert.ok(launches.length > 0);
  assert.ok(
    launches.every((request) => request.authorization === `Bearer ${GOOD_KEY}`),
    'only the profile key reached the gateway',
  );
});

test('the helper command line ends with T3 Code serve args, for the orphan reaper', {
  skip,
}, async () => {
  const sandbox = installed;
  const log = logFile(sandbox, 'reaper');
  const args = ['serve', '--hostname=127.0.0.1', '--port=0', '--print-logs'];
  const child = spawn(sandbox.opencodeLauncher, args, {
    env: sandbox.openCodeT3Env({
      FAKE_OPENCODE_LOG: log,
      FAKE_OPENCODE_SLEEP: '20000',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let stdout = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    stdout += chunk;
  });
  const exited = new Promise((resolve) => child.on('exit', resolve));
  try {
    assert.ok(
      await waitFor(() => stdout.includes('\n'), 10_000),
      'the helper started',
    );
    assert.match(stdout, /^server listening on /);
    const [record] = await readRecords(log);
    assert.equal(record.pid, child.pid);
    const command = execFileSync(
      'ps',
      ['-o', 'command=', '-p', `${child.pid}`],
      {
        encoding: 'utf8',
      },
    ).trim();
    assert.ok(command.endsWith(` ${args.join(' ')}`), command);
    assert.ok(command.includes('opencode serve '), command);
  } finally {
    process.kill(-child.pid, 'SIGTERM');
    await exited;
  }
});

test('--version and --help pass through offline without reading the profile', {
  skip,
}, async () => {
  const sandbox = installed;
  const requests = gateway.requests.length;
  const before = await snapshot(sandbox.subc);
  for (const args of [['--version'], ['-v']]) {
    const result = await launch(sandbox, args);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, 'opencode v2.3.0\n');
  }
  const hostile = { SUBCONSCIOUS_MODEL: 'x', OPENCODE_CONFIG: '/x.json' };
  for (const args of [
    ['--help'],
    ['-h'],
    ['serve', '--help'],
    ['serve', '-h'],
  ]) {
    const log = logFile(sandbox, `passthrough-${args.join('')}`);
    const result = await launch(sandbox, args, { log, env: hostile });
    assert.equal(result.code, 0, `${args.join(' ')}: ${result.stderr}`);
    const [record] = await readRecords(log);
    assert.deepEqual(record.args, args);
    // T3 Code's env reaches OpenCode as it was: no Subconscious launch.
    const expected = sandbox.openCodeT3Env({
      FAKE_OPENCODE_LOG: log,
      ...hostile,
    });
    for (const [name, value] of Object.entries(expected))
      if (name !== 'PATH') assert.equal(record.env[name], value, name);
    assert.equal(record.env.SUBCONSCIOUS_API_KEY, undefined);
  }
  assert.equal(gateway.requests.length, requests, 'no network request');
  assert.deepEqual(await snapshot(sandbox.subc), before, 'no file written');

  // A passthrough never reads the profile, so a broken one cannot stop it.
  await fs.writeFile(profileFile(sandbox), 'MODEL=not a model!\n');
  try {
    const result = await launch(sandbox, ['--version']);
    assert.equal(result.code, 0, result.stderr);
  } finally {
    await fs.writeFile(profileFile(sandbox), PROFILE(gateway.url));
  }
});

test('serve --service, serve --stdio, upgrade, and other commands are refused before OpenCode runs', {
  skip,
}, async () => {
  const sandbox = installed;
  const requests = gateway.requests.length;
  for (const args of [
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
  ]) {
    const log = logFile(sandbox, 'refused');
    const result = await launch(sandbox, args, { log });
    // The launcher reads the plan through a process substitution, so it
    // exits 1 for any adapter failure, as the other launchers do.
    assert.equal(result.code, 1, args.join(' '));
    assert.equal(result.stdout, '');
    assert.match(
      result.stderr,
      /^subc-t3-opencode: `opencode .*` is not available through the Subconscious provider\. Run opencode directly for it\.\n$/,
    );
    assert.deepEqual(await readRecords(log), []);
    // The adapter itself exits 64 (EX_USAGE).
    const adapter = await run(
      process.execPath,
      [
        ADAPTER,
        '--opencode',
        sandbox.opencodeBin,
        '--config-dir',
        sandbox.subc,
        '--',
        ...args,
      ],
      { env: sandbox.openCodeT3Env({ FAKE_OPENCODE_LOG: log }) },
    );
    assert.equal(adapter.code, 64, args.join(' '));
    assert.equal(adapter.stdout, '');
  }
  assert.equal(gateway.requests.length, requests, 'no network request');
});

test('serve accepts its known flags in = and space form', {
  skip,
}, async () => {
  const sandbox = installed;
  const log = logFile(sandbox, 'flags');
  const args = [
    'serve',
    '--hostname',
    '127.0.0.1',
    '--port',
    '0',
    '--cors',
    'http://localhost:3000',
    '--cors=http://localhost:3001',
    '--log-level=warn',
    '--print-logs',
  ];
  const result = await launch(sandbox, args, { log });
  assert.equal(result.code, 0, result.stderr);
  const [record] = await readRecords(log);
  assert.deepEqual(record.args, args);
});

test('a rejected key or a failed catalog stops the launch', {
  skip,
}, async () => {
  const sandbox = await installedBox();
  await fs.writeFile(
    profileFile(sandbox),
    PROFILE(gateway.url, 'sk-rejected-key'),
  );
  const log = logFile(sandbox, 'rejected');
  const rejected = await launch(sandbox, SERVE_ARGS, { log });
  assert.equal(rejected.code, 1);
  assert.equal(rejected.stdout, '');
  assert.match(
    rejected.stderr,
    /^subc-t3-opencode: .* did not return the model catalog for this key/,
  );
  assert.ok(!rejected.stderr.includes('sk-rejected-key'));

  await fs.writeFile(profileFile(sandbox), PROFILE('http://127.0.0.1:9'));
  const offline = await launch(sandbox, SERVE_ARGS, { log });
  assert.equal(offline.code, 1);
  assert.equal(offline.stdout, '');
  assert.match(offline.stderr, /Could not read the model catalog/);
  assert.ok(!offline.stderr.includes(GOOD_KEY));

  await fs.writeFile(profileFile(sandbox), `GATEWAY_URL=${gateway.url}\n`);
  const none = await launch(sandbox, SERVE_ARGS, { log });
  assert.equal(none.code, 1);
  assert.match(none.stderr, /no saved API key/);
  assert.deepEqual(await readRecords(log), []);
});

test('each serve launch reads the default profile again', {
  skip,
}, async () => {
  const sandbox = await installedBox();
  const log = logFile(sandbox, 'dynamic');
  const first = await launch(sandbox, SERVE_ARGS, { log });
  assert.equal(first.code, 0, first.stderr);
  await fs.writeFile(
    profileFile(sandbox),
    `GATEWAY_URL=${gateway.url}\nAPI_KEY=${GOOD_KEY}\nMODEL=${MODELS[1]}\nOPENCODE_CONTEXT_LIMIT=200000\n`,
  );
  const second = await launch(sandbox, SERVE_ARGS, { log });
  assert.equal(second.code, 0, second.stderr);
  const [before, after] = await readRecords(log);
  assert.equal(before.config.model, `subconscious/${MODELS[0]}`);
  assert.equal(after.config.model, `subconscious/${MODELS[1]}`);
  assert.equal(
    after.config.provider.subconscious.models[MODELS[1]].limit.context,
    200000,
  );
});

test('a serve launch finishes in under 5 s with a 3 s gateway delay', {
  skip,
  timeout: 60_000,
}, async () => {
  const slow = await fakeGateway();
  try {
    const sandbox = await box();
    await fs.writeFile(profileFile(sandbox), PROFILE(slow.url));
    const result = await subc(sandbox, [
      't3',
      'install',
      '--provider',
      'opencode',
    ]);
    assert.equal(result.code, 0, result.stderr);
    const log = logFile(sandbox, 'slow');
    // A slow catalog still starts the helper.
    slow.delayMs = 2000;
    let started = Date.now();
    const ok = await launch(sandbox, SERVE_ARGS, { log });
    assert.equal(ok.code, 0, ok.stderr);
    assert.ok(Date.now() - started < 5000, `${Date.now() - started} ms`);
    assert.equal((await readRecords(log)).length, 1);
    // At 3 s the catalog fetch hits its own 3 s limit. Either way the
    // launch ends well inside T3 Code's 30 s start limit, and it never
    // starts OpenCode without the catalog.
    slow.delayMs = 3000;
    started = Date.now();
    const edge = await launch(sandbox, SERVE_ARGS, { log });
    assert.ok(Date.now() - started < 5000, `${Date.now() - started} ms`);
    const records = await readRecords(log);
    if (edge.code === 0) assert.equal(records.length, 2);
    else {
      assert.equal(edge.code, 1);
      assert.match(edge.stderr, /Could not read the model catalog/);
      assert.equal(records.length, 1);
    }
    // A gateway that never answers stops the launch within the 4 s
    // catalog deadline, although the public list is asked for too.
    slow.delayMs = 60_000;
    started = Date.now();
    const hung = await launch(sandbox, SERVE_ARGS, { log });
    assert.ok(Date.now() - started < 5000, `${Date.now() - started} ms`);
    assert.equal(hung.code, 1);
    assert.equal(hung.stdout, '');
    assert.match(
      hung.stderr,
      /Could not read the model catalog from http:\/\/127\.0\.0\.1:\d+ within 4 s\./,
    );
    assert.equal((await readRecords(log)).length, records.length);
  } finally {
    await slow.close();
  }
});

test('the watchdog stops the helper within 10 s after its parent is SIGKILLed', {
  skip,
  timeout: 30_000,
}, async () => {
  const sandbox = installed;
  const log = logFile(sandbox, 'watchdog-parent');
  // The bash process plays the T3 Code server that started the helper.
  const server = spawn(
    'bash',
    [
      '-c',
      '"$0" serve --hostname=127.0.0.1 --port=0 & wait',
      sandbox.opencodeLauncher,
    ],
    {
      env: sandbox.openCodeT3Env({
        FAKE_OPENCODE_LOG: log,
        FAKE_OPENCODE_SLEEP: '60000',
      }),
      stdio: 'ignore',
      detached: true,
    },
  );
  const records = await waitFor(async () => {
    const found = await readRecords(log);
    return found.length ? found : null;
  }, 10_000);
  assert.ok(records, 'the helper started');
  const { pid } = records[0];
  await sleep(2500);
  assert.ok(alive(pid), 'the helper runs while its parent lives');
  const exited = new Promise((resolve) => server.on('exit', resolve));
  server.kill('SIGKILL');
  await exited;
  const started = Date.now();
  const stopped = await waitFor(() => !alive(pid), 10_000);
  if (!stopped) process.kill(pid, 'SIGKILL');
  assert.ok(stopped, 'the watchdog stopped the helper within 10 s');
  // The watchdog itself exits too, and nothing stays in the group.
  const empty = await waitFor(
    () => !processes().some((entry) => entry.pgid === server.pid),
    5000,
  );
  assert.ok(empty, 'no process is left in the helper group');
  assert.ok(Date.now() - started < 10_000);
});

test('the watchdog exits with the helper and leaves no process', {
  skip,
  timeout: 30_000,
}, async () => {
  const sandbox = installed;
  const log = logFile(sandbox, 'watchdog-helper');
  // T3 Code spawns the helper in its own process group.
  const child = spawn(sandbox.opencodeLauncher, SERVE_ARGS, {
    env: sandbox.openCodeT3Env({
      FAKE_OPENCODE_LOG: log,
      FAKE_OPENCODE_SLEEP: '60000',
    }),
    stdio: 'ignore',
    detached: true,
  });
  const exited = new Promise((resolve) => child.on('exit', resolve));
  assert.ok(
    await waitFor(async () => (await readRecords(log)).length > 0, 10_000),
  );
  const group = () => processes().filter((entry) => entry.pgid === child.pid);
  // The helper and the watchdog, with its sleep.
  assert.ok(group().length >= 2, JSON.stringify(group()));
  // T3 Code stops the helper alone, and this test process stays alive.
  process.kill(child.pid, 'SIGTERM');
  await exited;
  const empty = await waitFor(() => group().length === 0, 5000);
  assert.ok(empty, JSON.stringify(group()));
});

test('killing the launcher 200 times during the catalog fetch leaves no process behind', {
  skip,
  timeout: 240_000,
}, async () => {
  const sandbox = await installedBox();
  const cycle = async (i) => {
    const child = spawn(sandbox.opencodeLauncher, SERVE_ARGS, {
      env: sandbox.openCodeT3Env({ FAKE_OPENCODE_SLEEP: '60000' }),
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    // Most kills land while Node computes the plan; every fourth lands after
    // the exec, when the process T3 Code started is OpenCode.
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
    processes().filter((entry) => entry.command.includes(sandbox.root));
  // A watchdog notices a killed helper within 2 s.
  const empty = await waitFor(() => left().length === 0, 10_000);
  assert.ok(empty, JSON.stringify(left()));
});

test('an opencode entry that subc did not write blocks install', {
  skip,
}, async () => {
  const sandbox = await box({
    settings: `${JSON.stringify({
      providerInstances: {
        [OURS]: {
          driver: 'opencode',
          enabled: true,
          config: { binaryPath: '/usr/local/bin/opencode' },
        },
      },
    })}\n`,
  });
  const settings = await fs.readFile(sandbox.settingsPath, 'utf8');
  const result = await subc(sandbox, [
    't3',
    'install',
    '--provider',
    'opencode',
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /subconscious-opencode that subc did not create/);
  assert.equal(await fs.readFile(sandbox.settingsPath, 'utf8'), settings);
  await assert.rejects(fs.access(sandbox.opencodeLauncher));
  const status = await subc(sandbox, [
    't3',
    'status',
    '--provider',
    'opencode',
  ]);
  assert.match(status.stdout, /subconscious-opencode: conflict/);
  // Uninstall leaves the foreign entry alone.
  const removed = await subc(sandbox, [
    't3',
    'uninstall',
    '--provider',
    'opencode',
  ]);
  assert.equal(removed.code, 0, removed.stderr);
  assert.equal(await fs.readFile(sandbox.settingsPath, 'utf8'), settings);
});

test('a server URL or password set in T3 Code is drift, and install repairs it', {
  skip,
}, async () => {
  const sandbox = await installedBox();
  const settings = await readSettings(sandbox);
  const entry = settings.providerInstances[OURS];
  entry.config.serverUrl = 'http://127.0.0.1:4096';
  // T3 Code moves a typed password into its secret store and keeps a
  // reference here.
  entry.config.serverPassword = { secretRef: 'provider-config-x' };
  entry.config.enabled = false;
  entry.config.customModels = [{ slug: 'subconscious/mine' }];
  entry.accentColor = '#123456';
  entry.environment = [{ name: 'FOO', value: 'bar' }];
  await fs.writeFile(sandbox.settingsPath, JSON.stringify(settings));
  const status = await subc(sandbox, [
    't3',
    'status',
    '--provider',
    'opencode',
  ]);
  assert.match(
    status.stdout,
    /subconscious-opencode: installed, changed in T3 \(config\.enabled, serverUrl, serverPassword\); run subc t3 install/,
  );
  const result = await subc(sandbox, [
    't3',
    'install',
    '--provider',
    'opencode',
  ]);
  assert.equal(result.code, 0, result.stderr);
  const repaired = (await readSettings(sandbox)).providerInstances[OURS];
  assert.deepEqual(repaired, {
    driver: 'opencode',
    displayName: 'Subconscious (OpenCode)',
    enabled: true,
    config: {
      enabled: true,
      binaryPath: sandbox.opencodeLauncher,
      customModels: [{ slug: 'subconscious/mine' }],
    },
    accentColor: '#123456',
    environment: [{ name: 'FOO', value: 'bar' }],
  });
  const fixed = await subc(sandbox, ['t3', 'status', '--provider', 'opencode']);
  assert.match(fixed.stdout, /subconscious-opencode: installed\n/);
});

test('status lists the OpenCode provider offline, with no key', {
  skip,
}, async () => {
  const sandbox = await installedBox();
  await fs.writeFile(
    profileFile(sandbox),
    'GATEWAY_URL=http://127.0.0.1:9\nMODEL=not a model!\n',
  );
  const requests = gateway.requests.length;
  const status = await subc(sandbox, ['t3', 'status']);
  assert.equal(status.code, 0, status.stderr);
  assert.match(status.stdout, /subconscious-codex: not installed/);
  assert.match(status.stdout, /Subconscious \(OpenCode\)/);
  assert.match(status.stdout, /subconscious-opencode: installed/);
  assert.match(status.stdout, /subc-t3-opencode: current/);
  assert.ok(
    status.stdout.includes(`${sandbox.opencodeBin} (2.3.0)`),
    status.stdout,
  );
  assert.match(status.stdout, /OpenCode uses your ~\/\.config\/opencode/);
  assert.ok(
    status.stdout.includes(`Freshness     ${FRESHNESS}`),
    status.stdout,
  );
  assert.equal(gateway.requests.length, requests, 'no network request');
  // The version check in status writes nothing in the user's folders.
  assert.ok(await missing(sandbox.opencodeDataDir));
});

test('uninstall removes only subconscious-opencode and its launcher', {
  skip,
}, async () => {
  const sandbox = await installedBox({ withClaude: true }, []);
  // The user's own OpenCode folders, which uninstall never touches.
  await fs.mkdir(sandbox.opencodeConfigDir, { recursive: true });
  await fs.writeFile(
    path.join(sandbox.opencodeConfigDir, 'opencode.json'),
    '{"theme":"user"}\n',
  );
  await fs.mkdir(sandbox.opencodeDataDir, { recursive: true });
  await fs.writeFile(path.join(sandbox.opencodeDataDir, 'opencode.db'), 'db');
  const before = await snapshot(path.join(sandbox.home, '.config'));
  const dataBefore = await snapshot(sandbox.opencodeDataDir);
  const settings = await readSettings(sandbox);
  const result = await subc(sandbox, [
    't3',
    'uninstall',
    '--provider',
    'opencode',
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Removed subconscious-opencode/);
  await assert.rejects(fs.access(sandbox.opencodeLauncher));
  await fs.access(sandbox.launcher);
  await fs.access(sandbox.claudeLauncher);
  const left = await readSettings(sandbox);
  const { [OURS]: removed, ...others } = settings.providerInstances;
  assert.ok(removed);
  assert.deepEqual(left.providerInstances, others);
  assert.deepEqual(left.futureTopLevelSetting, { keep: [1, 2, 3] });
  assert.deepEqual(await snapshot(path.join(sandbox.home, '.config')), before);
  assert.deepEqual(await snapshot(sandbox.opencodeDataDir), dataBefore);
});

test('install with all three CLIs adds three entries, and a second install changes nothing', {
  skip,
}, async () => {
  const sandbox = await installedBox({ withClaude: true }, []);
  const text = await fs.readFile(sandbox.settingsPath, 'utf8');
  const settings = JSON.parse(text);
  assert.deepEqual(Object.keys(settings.providerInstances), [
    'claudeAgent',
    'subconscious-codex',
    'subconscious-claude',
    OURS,
  ]);
  for (const file of [
    sandbox.launcher,
    sandbox.claudeLauncher,
    sandbox.opencodeLauncher,
  ])
    await fs.access(file);
  const launchers = await Promise.all(
    [sandbox.launcher, sandbox.claudeLauncher, sandbox.opencodeLauncher].map(
      (file) => fs.readFile(file, 'utf8'),
    ),
  );
  // Only the OpenCode launcher has the watchdog.
  assert.deepEqual(
    launchers.map((launcher) => launcher.includes('subc_parent=$PPID')),
    [false, false, true],
  );
  const again = await subc(sandbox, ['t3', 'install']);
  assert.equal(again.code, 0, again.stderr);
  assert.equal(again.stdout.match(/already set up/g)?.length, 3);
  assert.equal(await fs.readFile(sandbox.settingsPath, 'utf8'), text);
});

test('--provider opencode installs only OpenCode, and Codex and Claude keep working', {
  skip,
}, async () => {
  const sandbox = await installedBox({ withClaude: true }, [
    '--provider',
    'codex',
    '--provider',
    'claude',
  ]);
  const before = (await readSettings(sandbox)).providerInstances;
  assert.equal(before[OURS], undefined);
  const result = await subc(sandbox, [
    't3',
    'install',
    '--provider',
    'opencode',
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(
    result.stdout,
    /Installing: Subconscious \(OpenCode\) in T3 Code/,
  );
  assert.doesNotMatch(
    result.stdout,
    /Subconscious \(Codex\)|Subconscious \(Claude\)/,
  );
  const after = (await readSettings(sandbox)).providerInstances;
  assert.deepEqual(Object.keys(after), [...Object.keys(before), OURS]);
  for (const id of Object.keys(before))
    assert.deepEqual(after[id], before[id], id);

  const codexLog = logFile(sandbox, 'mixed-codex');
  const codex = await run(sandbox.launcher, ['app-server'], {
    env: sandbox.t3Env({ FAKE_CODEX_LOG: codexLog }),
  });
  assert.equal(codex.code, 0, codex.stderr);
  const [codexRecord] = await readRecords(codexLog);
  assert.equal(codexRecord.env.SUBCONSCIOUS_API_KEY, GOOD_KEY);
  assert.equal(codexRecord.env.OPENCODE_CONFIG_CONTENT, undefined);

  const claudeLog = logFile(sandbox, 'mixed-claude');
  const claude = await run(
    sandbox.claudeLauncher,
    ['--output-format', 'stream-json', '--input-format', 'stream-json'],
    { env: sandbox.claudeT3Env({ FAKE_CLAUDE_LOG: claudeLog }) },
  );
  assert.equal(claude.code, 0, claude.stderr);
  const [claudeRecord] = await readRecords(claudeLog);
  assert.equal(claudeRecord.env.ANTHROPIC_AUTH_TOKEN, GOOD_KEY);

  const openCodeLog = logFile(sandbox, 'mixed-opencode');
  const openCode = await launch(sandbox, SERVE_ARGS, { log: openCodeLog });
  assert.equal(openCode.code, 0, openCode.stderr);
  assert.equal((await readRecords(openCodeLog)).length, 1);
});

test('install without --provider installs Codex and skips OpenCode 1.x', {
  skip,
}, async () => {
  const sandbox = await box();
  const result = await subc(sandbox, ['t3', 'install'], {
    FAKE_OPENCODE_VERSION: '1.14.30',
  });
  assert.equal(result.code, 0, result.stderr);
  assert.match(
    result.stdout,
    /Skipped.*Subconscious \(OpenCode\): OpenCode 1\.14\.30 is older than 2\.0\.18/,
  );
  assert.match(result.stdout, /Subconscious \(Codex\) is ready in T3 Code/);
  const settings = await readSettings(sandbox);
  assert.ok(settings.providerInstances['subconscious-codex']);
  assert.equal(settings.providerInstances[OURS], undefined);
  assert.ok(await missing(sandbox.opencodeLauncher));

  // With every found CLI refused, install fails and changes nothing.
  await fs.rm(path.join(sandbox.bin, 'codex'));
  const before = await snapshot(sandbox.home);
  const none = await subc(sandbox, ['t3', 'install'], {
    FAKE_OPENCODE_VERSION: '1.14.30',
  });
  assert.equal(none.code, 1);
  assert.match(none.stderr, /OpenCode 1\.14\.30 is older than 2\.0\.18/);
  assert.deepEqual(await snapshot(sandbox.home), before);
});

test('install without --provider skips OpenCode when its CLI is missing', {
  skip,
}, async () => {
  const sandbox = await box({ withOpenCode: false });
  const result = await subc(sandbox, ['t3', 'install', '--dry-run']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(
    result.stdout,
    /Skipped.*Subconscious \(OpenCode\): OpenCode CLI is not installed\. Install it with npm i -g opencode-ai/,
  );
  const named = await subc(sandbox, [
    't3',
    'install',
    '--provider',
    'opencode',
  ]);
  assert.equal(named.code, 1);
  assert.match(named.stderr, /OpenCode CLI is not installed/);
});

test('the OpenCode descriptor keeps T3 Code helper names and removes steering names', () => {
  assert.equal(OPENCODE_PROVIDER.instanceId, OURS);
  assert.equal(OPENCODE_PROVIDER.driver, 'opencode');
  assert.equal(OPENCODE_PROVIDER.watchdog, true);
  assert.equal(OPENCODE_PROVIDER.homeDir, null);
  assert.deepEqual(
    OPENCODE_PROVIDER.managedConfig({ launcherPath: '/x/launcher' }),
    { enabled: true, binaryPath: '/x/launcher' },
  );
  assert.deepEqual(OPENCODE_PROVIDER.clearedFields, [
    'serverUrl',
    'serverPassword',
  ]);
  const env = isolateLaunchEnv(
    {
      PATH: '/bin',
      HOME: '/home/dev',
      T3CODE_HOME: '/home/dev/.t3',
      OPENCODE_PASSWORD: 'pw',
      OPENCODE_SERVER_PASSWORD: 'pw1',
      OPENCODE_CONFIG_CONTENT: '{}',
      OPENCODE_CONFIG: '/evil.json',
      OPENCODE_CONFIG_DIR: '/evil',
      OPENCODE_API_KEY: 'sk-fake',
      SUBC_OPENCODE_API_KEY: 'sk-fake',
      OPENCODE_CONTEXT_LIMIT: '7',
      OPENCODE_OUTPUT_LIMIT: '8',
      SUBCONSCIOUS_API_KEY: 'sk-fake',
      SUBC_PROFILE: 'x',
      API_KEY: 'sk-fake',
      GATEWAY_URL: 'http://evil',
      MODEL: 'x',
    },
    '/nowhere',
    OPENCODE_PROVIDER,
  );
  assert.deepEqual(Object.keys(env).sort(), [
    'HOME',
    'OPENCODE_PASSWORD',
    'OPENCODE_SERVER_PASSWORD',
    'PATH',
    'SUBC_CONFIG_DIR',
    'T3CODE_HOME',
  ]);
});

const WATCHDOG = 'subc-t3-opencode-watchdog';

/** The live processes in the process group `pgid`. */
const groupOf = (pgid) => processes().filter((entry) => entry.pgid === pgid);

/**
 * A process's env as text, or null when this system does not show it:
 * /proc/<pid>/environ on Linux, and `ps -E` on macOS, which newer macOS
 * releases answer without the env.
 */
async function processEnv(pid) {
  if (process.platform === 'linux') {
    try {
      return await fs.readFile(`/proc/${pid}/environ`, 'latin1');
    } catch {
      return null;
    }
  }
  try {
    const text = execFileSync(
      'ps',
      ['-wwE', '-o', 'command=', '-p', `${pid}`],
      {
        encoding: 'utf8',
      },
    );
    return /\sPATH=/.test(text) ? text : null;
  } catch {
    return null;
  }
}

/** The plan records the adapter prints for `args`, as [kind, value] pairs. */
async function planRecords(sandbox, args) {
  const result = await run(
    process.execPath,
    [
      ADAPTER,
      '--opencode',
      sandbox.opencodeBin,
      '--config-dir',
      sandbox.subc,
      '--',
      ...args,
    ],
    { env: sandbox.openCodeT3Env() },
  );
  assert.equal(result.code, 0, result.stderr);
  const words = result.stdout.split('\0').slice(0, -1);
  const records = [];
  for (let i = 0; i < words.length; i += 2)
    records.push([words[i], words[i + 1]]);
  return records;
}

test('the watchdog and its children hold no key and no helper password', {
  skip,
  timeout: 30_000,
}, async () => {
  const sandbox = await installedBox();
  // A sleep on the launch PATH that records, as booleans, whether its env
  // holds the key or T3 Code's helper password. The watchdog runs it every
  // 2 s.
  const sleepLog = logFile(sandbox, 'watchdog-sleep');
  await fs.writeFile(
    path.join(sandbox.bin, 'sleep'),
    `#!/bin/sh
case "$(/usr/bin/env)" in
  *${GOOD_KEY}*) echo key >> '${sleepLog}' ;;
  *t3-helper-password*) echo password >> '${sleepLog}' ;;
  *) echo clean >> '${sleepLog}' ;;
esac
for s in /bin/sleep /usr/bin/sleep; do [ -x "$s" ] && exec "$s" "$@"; done
exit 1
`,
    { mode: 0o755 },
  );
  const log = logFile(sandbox, 'watchdog-env');
  const child = spawn(sandbox.opencodeLauncher, SERVE_ARGS, {
    env: sandbox.openCodeT3Env({
      FAKE_OPENCODE_LOG: log,
      FAKE_OPENCODE_SLEEP: '60000',
    }),
    stdio: 'ignore',
    detached: true,
  });
  const exited = new Promise((resolve) => child.on('exit', resolve));
  try {
    const [record] = await waitFor(async () => {
      const found = await readRecords(log);
      return found.length ? found : null;
    }, 10_000);
    // The helper itself holds the key, as the launch intends.
    assert.deepEqual(keyHolders(record.env), ['SUBCONSCIOUS_API_KEY']);
    const watchdog = await waitFor(
      () =>
        groupOf(child.pid).find(({ command }) => command.includes(WATCHDOG)),
      5000,
    );
    assert.ok(watchdog, JSON.stringify(groupOf(child.pid)));
    assert.ok(
      watchdog.command.endsWith(
        ` ${WATCHDOG} ${child.pid} ${process.pid} ${sandbox.subc}`,
      ),
      watchdog.command,
    );
    assert.ok(!watchdog.command.includes(GOOD_KEY));
    const env = await processEnv(watchdog.pid);
    if (env !== null) {
      assert.equal(env.includes(GOOD_KEY), false);
      assert.equal(env.includes('t3-helper-password'), false);
    }
    // Wait for the first poll's sleep to run.
    const polls = await waitFor(async () => {
      const text = await fs.readFile(sleepLog, 'utf8').catch(() => '');
      return text ? text.trim().split('\n') : null;
    }, 5000);
    assert.deepEqual([...new Set(polls)], ['clean']);
  } finally {
    process.kill(child.pid, 'SIGTERM');
    await exited;
  }
});

test('--version and --help start no watchdog, and serve does', {
  skip,
  timeout: 30_000,
}, async () => {
  const sandbox = installed;
  for (const args of [['--version'], ['--help'], ['serve', '--help']]) {
    const kinds = (await planRecords(sandbox, args)).map(([kind]) => kind);
    assert.ok(!kinds.includes('watch'), args.join(' '));
    const child = spawn(sandbox.opencodeLauncher, args, {
      env: sandbox.openCodeT3Env(),
      stdio: 'ignore',
      detached: true,
    });
    const code = await new Promise((resolve) => child.on('exit', resolve));
    assert.equal(code, 0, args.join(' '));
    // An old launcher kept a watchdog in the group for 2 s after the exit.
    const empty = await waitFor(() => groupOf(child.pid).length === 0, 500);
    assert.ok(
      empty,
      `${args.join(' ')}: ${JSON.stringify(groupOf(child.pid))}`,
    );
  }
  const serve = await planRecords(sandbox, SERVE_ARGS);
  assert.deepEqual(serve.slice(-2), [
    ['watch', ''],
    ['ok', ''],
  ]);
});

test('status lists the running helpers by PID and start time, and nothing else', {
  skip,
  timeout: 30_000,
}, async () => {
  const sandbox = await installedBox();
  const none = await subc(sandbox, ['t3', 'status', '--provider', 'opencode']);
  assert.equal(none.code, 0, none.stdout);
  assert.match(none.stdout, /Helpers\s+none running/);

  const log = logFile(sandbox, 'status-helper');
  const child = spawn(sandbox.opencodeLauncher, SERVE_ARGS, {
    env: sandbox.openCodeT3Env({
      FAKE_OPENCODE_LOG: log,
      FAKE_OPENCODE_SLEEP: '60000',
    }),
    stdio: 'ignore',
    detached: true,
  });
  const exited = new Promise((resolve) => child.on('exit', resolve));
  try {
    assert.ok(
      await waitFor(
        () =>
          groupOf(child.pid).some(({ command }) => command.includes(WATCHDOG)),
        10_000,
      ),
    );
    // Another subc config dir's helper is not this install's.
    const other = await box();
    const elsewhere = await subc(other, ['t3', 'status']);
    assert.match(elsewhere.stdout, /Helpers\s+none running/);

    const status = await subc(sandbox, [
      't3',
      'status',
      '--provider',
      'opencode',
    ]);
    assert.equal(status.code, 0, status.stdout);
    assert.match(
      status.stdout,
      new RegExp(`Helpers\\s+PID ${child.pid}, started \\S.*\\d{4}\\n`),
    );
    assert.equal(status.stdout.match(/, started /g)?.length, 1);
    const output = `${status.stdout}${status.stderr}`;
    assert.equal(output.includes(GOOD_KEY), false);
    assert.equal(output.includes('t3-helper-password'), false);
    assert.equal(output.includes('OPENCODE_CONFIG_CONTENT'), false);
  } finally {
    process.kill(child.pid, 'SIGTERM');
    await exited;
  }
  assert.ok(await waitFor(() => groupOf(child.pid).length === 0, 5000));
  const after = await subc(sandbox, ['t3', 'status', '--provider', 'opencode']);
  assert.match(after.stdout, /Helpers\s+none running/);
});
