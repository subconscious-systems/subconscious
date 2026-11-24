import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
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
const WATCHDOG = 'subc-t3-opencode-watchdog';
// The helper argv T3 Code 0.1.11 passes (OpenCodeRuntime.ts:601), with
// port 0 so the fake picks a free port.
const SERVE_ARGS = ['serve', '--hostname=127.0.0.1', '--port=0'];

let gateway;
let installed;
const boxes = [];

async function box(options = {}) {
  const sandbox = await t3Sandbox({ gateway, withOpenCode: true, ...options });
  boxes.push(sandbox);
  return sandbox;
}

const install = (sandbox, env) =>
  subc(sandbox, ['t3', 'install', '--provider', 'opencode'], env);

function launch(sandbox, args, { log, env = {} } = {}) {
  return run(sandbox.opencodeLauncher, args, {
    env: sandbox.openCodeT3Env({ FAKE_OPENCODE_LOG: log, ...env }),
  });
}

let logs = 0;
const logFile = (sandbox) => path.join(sandbox.root, `opencode-${++logs}.log`);
const readSettings = async (sandbox) =>
  JSON.parse(await fs.readFile(sandbox.settingsPath, 'utf8'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The live processes in the process group `pgid`. */
const groupOf = (pgid) =>
  execFileSync('ps', ['-Ao', 'pid=,pgid=,command='], { encoding: 'utf8' })
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((row) => row && Number(row[2]) === pgid)
    .map(([, pid, , command]) => ({ pid: Number(pid), command }))
    .filter(({ command }) => !command.startsWith('ps -Ao'));

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

const firstRecord = async (log) =>
  (await waitFor(async () => (await readRecords(log))[0], 10_000)) ?? null;

before(async () => {
  if (skip) return;
  gateway = await fakeGateway();
  installed = await box();
  const result = await install(installed);
  assert.equal(result.code, 0, result.stderr);
});

after(async () => {
  for (const sandbox of boxes) await sandbox.cleanup();
  await gateway?.close();
});

test('a serve launch gets only the Subconscious provider and keeps T3 Code names', {
  skip,
}, async () => {
  const sandbox = installed;
  const log = logFile(sandbox);
  // Known serve flags pass in = and space form.
  const args = [
    ...SERVE_ARGS,
    '--cors',
    'http://localhost:3000',
    '--print-logs',
  ];
  const result = await launch(sandbox, args, {
    log,
    env: { OPENCODE_SERVER_PASSWORD: 'v1-password-4567' },
  });
  assert.equal(result.code, 0, result.stderr);
  const [{ args: argv, config, env }] = await readRecords(log);
  assert.deepEqual(argv, args);
  // T3 Code's {} config is replaced by the launch config.
  assert.deepEqual(config.enabled_providers, ['subconscious']);
  assert.deepEqual(Object.keys(config.provider), ['subconscious']);
  const provider = config.provider.subconscious;
  assert.equal(provider.options.baseURL, `${gateway.url}/v1`);
  assert.equal(provider.options.apiKey, '{env:SUBCONSCIOUS_API_KEY}');
  assert.deepEqual(Object.keys(provider.models), MODELS);
  assert.equal(config.model, `subconscious/${MODELS[0]}`);
  assert.equal(env.SUBCONSCIOUS_API_KEY, GOOD_KEY);
  // T3 Code's own names reach the helper.
  assert.equal(env.T3CODE_HOME, sandbox.t3Home);
  assert.equal(env.OPENCODE_PASSWORD, 't3-helper-password-0123');
  assert.equal(env.OPENCODE_SERVER_PASSWORD, 'v1-password-4567');
});

test('after its parent is SIGKILLed, the keyless watchdog stops the helper group', {
  skip,
  timeout: 40_000,
}, async () => {
  const sandbox = installed;
  // A sleep on the launch PATH that records, as booleans, whether its env
  // holds the key or T3 Code's helper password. The watchdog runs it every
  // 2 s. The helper's own child runs sleep 600, which is not recorded.
  const sleepLog = path.join(sandbox.root, 'watchdog sleep.log');
  await fs.writeFile(
    path.join(sandbox.bin, 'sleep'),
    `#!/bin/sh
[ "$1" = 600 ] || case "$(/usr/bin/env)" in
  *${GOOD_KEY}*) echo key >> '${sleepLog}' ;;
  *t3-helper-password*) echo password >> '${sleepLog}' ;;
  *) echo clean >> '${sleepLog}' ;;
esac
for s in /bin/sleep /usr/bin/sleep; do [ -x "$s" ] && exec "$s" "$@"; done
exit 1
`,
    { mode: 0o755 },
  );
  const log = logFile(sandbox);
  // A Node process plays the T3 Code server. Like T3 Code, it spawns the
  // helper detached, so the helper leads its own process group. The helper
  // ignores SIGTERM and has a child of its own.
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
  const record = await firstRecord(log);
  assert.ok(record?.childPid, 'the helper started a child');
  const { pid } = record;
  const group = () => groupOf(pid);
  try {
    const watchdog = await waitFor(
      () => group().find(({ command }) => command.includes(WATCHDOG)),
      5000,
    );
    assert.ok(watchdog, JSON.stringify(group()));
    assert.ok(!watchdog.command.includes(GOOD_KEY));
    await sleep(2500);
    assert.ok(alive(pid), 'the helper runs while its parent lives');
    assert.deepEqual(
      [...new Set((await fs.readFile(sleepLog, 'utf8')).trim().split('\n'))],
      ['clean'],
    );
    const exited = new Promise((resolve) => server.on('exit', resolve));
    server.kill('SIGKILL');
    await exited;
    const started = Date.now();
    const stopped = await waitFor(() => group().length === 0, 15_000);
    assert.ok(stopped, 'the helper, its child, and the watchdog are gone');
    // 2 s poll, then 5 s from SIGTERM to SIGKILL.
    assert.ok(Date.now() - started >= 4500, 'SIGTERM came first');
  } finally {
    server.kill('SIGKILL');
    for (const entry of group()) process.kill(entry.pid, 'SIGKILL');
  }
});

test('without ps, the watchdog keeps a healthy helper and install refuses', {
  skip,
  timeout: 30_000,
}, async () => {
  // Every command in /usr/bin and /bin, except ps, linked into one folder.
  const noPs = path.join(installed.root, 'no ps bin');
  await fs.mkdir(noPs, { recursive: true });
  for (const source of ['/usr/bin', '/bin'])
    for (const name of await fs.readdir(source))
      if (name !== 'ps')
        await fs
          .symlink(path.join(source, name), path.join(noPs, name))
          .catch((error) => {
            if (error.code !== 'EEXIST') throw error;
          });
  const PATH = (sandbox) =>
    [sandbox.bin, path.join(sandbox.root, 'node bin'), noPs].join(
      path.delimiter,
    );
  const started = Date.now();
  const result = await launch(installed, SERVE_ARGS, {
    log: logFile(installed),
    env: { PATH: PATH(installed), FAKE_OPENCODE_SLEEP: '5000' },
  });
  // The fake exits 0 on SIGTERM too, so the time shows who stopped it.
  assert.equal(result.code, 0, result.stderr);
  assert.ok(Date.now() - started >= 4900, 'the helper ran its full 5 s');

  const fresh = await box();
  const before = await snapshot(fresh.home);
  const refused = await install(fresh, { PATH: PATH(fresh) });
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /ps -o ppid= -p \$\$" failed\. Install procps/);
  assert.deepEqual(await snapshot(fresh.home), before);
});

test('only serve asks for the watchdog', { skip }, async () => {
  const plan = async (args) => {
    const result = await run(
      process.execPath,
      [
        ADAPTER,
        '--opencode',
        installed.opencodeBin,
        '--config-dir',
        installed.subc,
        '--',
        ...args,
      ],
      { env: installed.openCodeT3Env() },
    );
    assert.equal(result.code, 0, result.stderr);
    return result.stdout.split('\0').filter((_, i) => i % 2 === 0);
  };
  for (const args of [['--version'], ['--help'], ['serve', '--help']])
    assert.ok(!(await plan(args)).includes('watch'), args.join(' '));
  assert.deepEqual((await plan(SERVE_ARGS)).slice(-3), ['watch', 'ok', '']);
});

test('an entry as T3 Code rewrites it is current, and a server URL is drift', {
  skip,
}, async () => {
  const sandbox = await box();
  assert.equal((await install(sandbox)).code, 0);
  // T3 Code 0.1.11 rewrites the file on start and removes config.enabled.
  const settings = await readSettings(sandbox);
  settings.providerInstances[OURS].config = {
    binaryPath: sandbox.opencodeLauncher,
  };
  await fs.writeFile(sandbox.settingsPath, JSON.stringify(settings, null, 2));
  const status = () =>
    subc(sandbox, ['t3', 'status', '--provider', 'opencode']);
  const current = await status();
  assert.equal(current.code, 0, current.stdout);
  assert.match(current.stdout, /subconscious-opencode: installed\n/);

  // With a Server URL, T3 Code skips the launcher.
  settings.providerInstances[OURS].config.serverUrl = 'http://127.0.0.1:4096';
  settings.providerInstances[OURS].config.serverPassword = { secretRef: 'x' };
  await fs.writeFile(sandbox.settingsPath, JSON.stringify(settings));
  assert.match(
    (await status()).stdout,
    /installed, changed in T3 \(serverUrl, serverPassword\); run subc t3 install/,
  );
  assert.equal((await install(sandbox)).code, 0);
  assert.deepEqual(
    (await readSettings(sandbox)).providerInstances[OURS].config,
    {
      binaryPath: sandbox.opencodeLauncher,
    },
  );
});
