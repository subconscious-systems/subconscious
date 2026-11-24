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

test('install puts the watchdog in the OpenCode launcher and writes no hide list', {
  skip,
}, async () => {
  const sandbox = installed;
  const settings = await readSettings(sandbox);
  assert.equal(settings.providerModelPreferences, undefined);
  const launcher = await fs.readFile(sandbox.opencodeLauncher, 'utf8');
  // The parent watchdog sits right before the exec.
  assert.match(
    launcher,
    /subc_parent=\$PPID\n[\s\S]*\nexec "\$\{subc_argv\[@\]\}"\n$/,
  );
});

test('a serve launch uses only the default profile and the live catalog', {
  skip,
}, async () => {
  const sandbox = installed;
  const log = logFile(sandbox, 'serve');
  const result = await launch(sandbox, SERVE_ARGS, { log });
  assert.equal(result.code, 0, result.stderr);
  const [record] = await readRecords(log);
  // T3 Code's args reach `opencode serve` unchanged and in order.
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

/**
 * A PATH like the sandbox one, but with no `ps`: every command in /usr/bin
 * and /bin is linked into one folder, except ps.
 */
async function pathWithoutPs(sandbox) {
  const dir = path.join(sandbox.root, 'no ps bin');
  await fs.mkdir(dir, { recursive: true });
  for (const source of ['/usr/bin', '/bin'])
    for (const name of await fs.readdir(source)) {
      if (name === 'ps') continue;
      await fs
        .symlink(path.join(source, name), path.join(dir, name))
        .catch((error) => {
          if (error.code !== 'EEXIST') throw error;
        });
    }
  return [sandbox.bin, path.join(sandbox.root, 'node bin'), dir].join(
    path.delimiter,
  );
}

test('without ps, the watchdog keeps a healthy helper and install refuses', {
  skip,
  timeout: 30_000,
}, async () => {
  const sandbox = installed;
  const PATH = await pathWithoutPs(sandbox);
  const log = logFile(sandbox, 'no-ps');
  const started = Date.now();
  const result = await launch(sandbox, SERVE_ARGS, {
    log,
    env: { PATH, FAKE_OPENCODE_SLEEP: '5000' },
  });
  // The fake exits 0 on SIGTERM too, so the time shows who stopped it.
  assert.equal(result.code, 0, result.stderr);
  assert.ok(
    Date.now() - started >= 4900,
    'the helper ran its full 5 s while its parent lived',
  );

  const fresh = await box();
  const before = await snapshot(fresh.home);
  const refused = await subc(
    fresh,
    ['t3', 'install', '--provider', 'opencode'],
    {
      PATH: await pathWithoutPs(fresh),
    },
  );
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /ps -o ppid= -p \$\$" failed\. Install procps/);
  assert.deepEqual(await snapshot(fresh.home), before);
});

test('the watchdog sends SIGKILL to a helper group that ignores SIGTERM', {
  skip,
  timeout: 40_000,
}, async () => {
  const sandbox = installed;
  const log = logFile(sandbox, 'watchdog-kill');
  // A Node process plays the T3 Code server. Like T3 Code, it spawns the
  // helper detached, so the helper leads its own process group.
  const server = spawn(
    process.execPath,
    [
      '-e',
      `require('child_process').spawn(process.argv[1], process.argv.slice(2), { detached: true, stdio: 'ignore' }); setInterval(() => {}, 1000);`,
      sandbox.opencodeLauncher,
      ...SERVE_ARGS,
    ],
    {
      env: sandbox.openCodeT3Env({
        FAKE_OPENCODE_LOG: log,
        FAKE_OPENCODE_SLEEP: '60000',
        FAKE_OPENCODE_IGNORE_TERM: '1',
        FAKE_OPENCODE_CHILD: '1',
      }),
      stdio: 'ignore',
    },
  );
  const records = await waitFor(async () => {
    const found = await readRecords(log);
    return found.length ? found : null;
  }, 10_000);
  assert.ok(records, 'the helper started');
  const { pid, childPid } = records[0];
  assert.ok(childPid, 'the helper started a child');
  const group = () => processes().filter((entry) => entry.pgid === pid);
  assert.ok(group().some((entry) => entry.pid === childPid));
  await sleep(2500);
  assert.ok(alive(pid), 'the helper runs while its parent lives');
  const exited = new Promise((resolve) => server.on('exit', resolve));
  server.kill('SIGKILL');
  await exited;
  const started = Date.now();
  const stopped = await waitFor(() => group().length === 0, 15_000);
  for (const entry of group()) process.kill(entry.pid, 'SIGKILL');
  assert.ok(stopped, 'the helper, its child, and the watchdog are gone');
  // 2 s poll, then 5 s from SIGTERM to SIGKILL.
  assert.ok(Date.now() - started >= 4500, 'SIGTERM came first');
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

test('an entry without config.enabled, as T3 Code writes it, is current', {
  skip,
}, async () => {
  const sandbox = await installedBox();
  // T3 Code 0.1.11 rewrites the file on start and removes config.enabled,
  // even when an older subc wrote it.
  const settings = await readSettings(sandbox);
  settings.providerInstances[OURS].config = {
    binaryPath: sandbox.opencodeLauncher,
  };
  settings.idleCompaction = { enabled: true };
  await fs.writeFile(sandbox.settingsPath, JSON.stringify(settings, null, 2));
  const status = await subc(sandbox, [
    't3',
    'status',
    '--provider',
    'opencode',
  ]);
  assert.equal(status.code, 0, status.stdout);
  assert.match(status.stdout, /subconscious-opencode: installed\n/);
  assert.doesNotMatch(status.stdout, /drift|Broken/);
  const before = await fs.readFile(sandbox.settingsPath, 'utf8');
  const again = await subc(sandbox, [
    't3',
    'install',
    '--provider',
    'opencode',
  ]);
  assert.equal(again.code, 0, again.stderr);
  assert.match(again.stdout, /already current/);
  assert.equal(await fs.readFile(sandbox.settingsPath, 'utf8'), before);
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
      binaryPath: sandbox.opencodeLauncher,
      customModels: [{ slug: 'subconscious/mine' }],
    },
    accentColor: '#123456',
    environment: [{ name: 'FOO', value: 'bar' }],
  });
  const fixed = await subc(sandbox, ['t3', 'status', '--provider', 'opencode']);
  assert.match(fixed.stdout, /subconscious-opencode: installed\n/);
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

test('install fails and changes nothing when it refuses every CLI it finds', {
  skip,
}, async () => {
  const sandbox = await box();
  await fs.rm(path.join(sandbox.bin, 'codex'));
  const before = await snapshot(sandbox.home);
  const none = await subc(sandbox, ['t3', 'install'], {
    FAKE_OPENCODE_VERSION: '1.14.30',
  });
  assert.equal(none.code, 1);
  assert.match(none.stderr, /OpenCode 1\.14\.30 is older than 2\.0\.18/);
  assert.deepEqual(await snapshot(sandbox.home), before);
});

test('the OpenCode descriptor keeps T3 Code helper names and removes steering names', () => {
  assert.equal(OPENCODE_PROVIDER.instanceId, OURS);
  assert.equal(OPENCODE_PROVIDER.driver, 'opencode');
  assert.equal(OPENCODE_PROVIDER.watchdog, true);
  assert.equal(OPENCODE_PROVIDER.homeDir, null);
  assert.deepEqual(
    OPENCODE_PROVIDER.managedConfig({ launcherPath: '/x/launcher' }),
    { binaryPath: '/x/launcher' },
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
