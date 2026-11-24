import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { CODEX_PROVIDER } from '../bin/t3-providers.js';
import {
  inspectT3,
  installT3Provider,
  removeT3Provider,
  settingsBlockers,
} from '../bin/t3-settings.js';

const T3_INSTANCE_ID = CODEX_PROVIDER.instanceId;

const skip = process.platform === 'win32';
const roots = [];
after(async () => {
  for (const root of roots) await fs.rm(root, { recursive: true, force: true });
});

const LAUNCHER = '/opt/subc home/bin/subc-t3-codex';
const CODEX_HOME = '/opt/subc home/t3/codex/default';

/** A T3 home with the given settings text, and where subc keeps backups. */
async function t3Home(settings, { mode = 0o644 } = {}) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'subc-t3-settings-')),
  );
  roots.push(root);
  const home = path.join(root, '.t3');
  await fs.mkdir(path.join(home, 'userdata'), { recursive: true });
  const file = path.join(home, 'userdata', 'settings.json');
  if (settings !== undefined) {
    const text =
      typeof settings === 'string'
        ? settings
        : `${JSON.stringify(settings, null, '\t')}\n`;
    await fs.writeFile(file, text, { mode });
    await fs.chmod(file, mode);
  }
  return {
    root,
    file,
    backupDir: path.join(root, 'backups'),
    target: {
      home,
      launcherPath: LAUNCHER,
      homePath: CODEX_HOME,
      provider: CODEX_PROVIDER,
    },
    read: async () => JSON.parse(await fs.readFile(file, 'utf8')),
  };
}

const ours = (extra = {}, config = {}) => ({
  driver: 'codex',
  displayName: 'Subconscious (Codex)',
  enabled: true,
  config: {
    setupMode: 'existing',
    binaryPath: LAUNCHER,
    homePath: CODEX_HOME,
    ...config,
  },
  ...extra,
});

const BASE = {
  projectSettingsFolded: true,
  someFutureSetting: { nested: ['kept'] },
  providerInstances: {
    claudeAgent_2: {
      driver: 'claudeAgent',
      displayName: 'Claudington',
      enabled: true,
      config: { autoCompactWindow: '300000' },
    },
  },
};

test('install adds one entry and keeps every other setting', {
  skip,
}, async () => {
  const box = await t3Home(BASE);
  const result = await installT3Provider(box.target, {
    backupDir: box.backupDir,
    settleMs: 150,
  });
  assert.equal(result.changed, true);
  const settings = await box.read();
  assert.deepEqual(settings.providerInstances[T3_INSTANCE_ID], ours());
  assert.deepEqual(
    settings.providerInstances.claudeAgent_2,
    BASE.providerInstances.claudeAgent_2,
  );
  assert.deepEqual(settings.someFutureSetting, BASE.someFutureSetting);
  assert.equal(settings.projectSettingsFolded, true);
  // T3 writes tabs; the file keeps them.
  assert.match(await fs.readFile(box.file, 'utf8'), /^\{\n\t"/);
  const backups = await fs.readdir(box.backupDir);
  assert.equal(backups.length, 1);
  const backup = path.join(box.backupDir, backups[0]);
  assert.deepEqual(JSON.parse(await fs.readFile(backup, 'utf8')), BASE);
  assert.equal((await fs.stat(backup)).mode & 0o777, 0o600);
});

test('install into a file without providerInstances creates the map', {
  skip,
}, async () => {
  const box = await t3Home({ projectSettingsFolded: true });
  await installT3Provider(box.target, {
    backupDir: box.backupDir,
    settleMs: 50,
  });
  assert.deepEqual(Object.keys((await box.read()).providerInstances), [
    T3_INSTANCE_ID,
  ]);
});

test('a second install writes nothing', { skip }, async () => {
  const box = await t3Home(BASE);
  await installT3Provider(box.target, {
    backupDir: box.backupDir,
    settleMs: 50,
  });
  const before = await fs.stat(box.file);
  const result = await installT3Provider(box.target, {
    backupDir: box.backupDir,
    settleMs: 50,
  });
  assert.equal(result.changed, false);
  assert.equal(result.backup, null);
  assert.equal((await fs.stat(box.file)).mtimeMs, before.mtimeMs);
  assert.equal((await fs.readdir(box.backupDir)).length, 1);
});

test('install repairs its own entry and keeps fields it does not manage', {
  skip,
}, async () => {
  const drifted = ours(
    { displayName: 'Renamed', enabled: false, accentColor: '#123456' },
    {
      homePath: '/Users/someone/.codex',
      shadowHomePath: '/Users/someone/.codex-t3/x',
      launchArgs: '-c model_provider=openai',
      customModels: [{ slug: 'kept/model' }],
    },
  );
  const box = await t3Home({
    ...BASE,
    providerInstances: { ...BASE.providerInstances, [T3_INSTANCE_ID]: drifted },
  });
  const report = await inspectT3(box.target);
  assert.equal(report.entry, 'owned');
  assert.deepEqual(report.drift.sort(), [
    'displayName',
    'enabled',
    'homePath',
    'launchArgs',
    'shadowHomePath',
  ]);
  await installT3Provider(box.target, {
    backupDir: box.backupDir,
    settleMs: 50,
  });
  const entry = (await box.read()).providerInstances[T3_INSTANCE_ID];
  assert.deepEqual(
    entry,
    ours(
      { accentColor: '#123456' },
      { customModels: [{ slug: 'kept/model' }] },
    ),
  );
  assert.deepEqual((await inspectT3(box.target)).drift, []);
});

test('a provider with the same id that subc did not write blocks install', {
  skip,
}, async () => {
  for (const foreign of [
    { driver: 'claudeAgent', enabled: true },
    { driver: 'codex', config: { binaryPath: '/usr/local/bin/codex' } },
    { driver: 'codex', config: 'not an object' },
  ]) {
    const settings = {
      ...BASE,
      providerInstances: { [T3_INSTANCE_ID]: foreign },
    };
    const box = await t3Home(settings);
    const original = await fs.readFile(box.file, 'utf8');
    const report = await inspectT3(box.target);
    assert.equal(report.entry, 'conflict');
    await assert.rejects(
      installT3Provider(box.target, { backupDir: box.backupDir, settleMs: 0 }),
      /did not create/,
    );
    // Uninstall leaves it alone and does not fail on it.
    assert.deepEqual(
      await removeT3Provider(box.target, { backupDir: box.backupDir }),
      { removed: false, backup: null },
    );
    assert.equal(await fs.readFile(box.file, 'utf8'), original);
  }
});

test('the launcher already used by another provider id blocks install', {
  skip,
}, async () => {
  const box = await t3Home({
    ...BASE,
    providerInstances: { 'my-subc': ours({ displayName: 'Mine' }) },
  });
  const report = await inspectT3(box.target);
  assert.deepEqual(report.duplicates, ['my-subc']);
  assert.match(settingsBlockers(report).join('\n'), /my-subc/);
  await assert.rejects(
    installT3Provider(box.target, { backupDir: box.backupDir, settleMs: 0 }),
    /my-subc/,
  );
});

test('a managed policy, or an unreadable runtime file, blocks every write', {
  skip,
}, async () => {
  for (const runtime of ['{"managedPolicy":{"organization":"acme"}}', '{bad']) {
    const box = await t3Home(BASE);
    await fs.writeFile(
      path.join(box.target.home, 'userdata', 'server-runtime.json'),
      runtime,
    );
    const original = await fs.readFile(box.file, 'utf8');
    await assert.rejects(
      installT3Provider(box.target, { backupDir: box.backupDir, settleMs: 0 }),
      /managed policy/,
    );
    await assert.rejects(
      removeT3Provider(box.target, { backupDir: box.backupDir }),
      /managed policy/,
    );
    assert.equal(await fs.readFile(box.file, 'utf8'), original);
  }
  const allowed = await t3Home(BASE);
  await fs.writeFile(
    path.join(allowed.target.home, 'userdata', 'server-runtime.json'),
    '{"managedPolicy":null,"serverVersion":"0.1.7"}',
  );
  const report = await inspectT3(allowed.target);
  assert.equal(report.policy, 'none');
  assert.equal(report.version, '0.1.7');
});

test('malformed, old-format, and missing settings are refused unchanged', {
  skip,
}, async () => {
  const cases = [
    ['{ not json', 'malformed'],
    ['[]\n', 'malformed'],
    ['{"providers":{"codex":{"enabled":true}}}\n', 'unsupported'],
    ['{"providerInstances":[]}\n', 'unsupported'],
  ];
  for (const [text, state] of cases) {
    const box = await t3Home(text);
    assert.equal((await inspectT3(box.target)).state, state, text);
    await assert.rejects(
      installT3Provider(box.target, { backupDir: box.backupDir, settleMs: 0 }),
    );
    assert.equal(await fs.readFile(box.file, 'utf8'), text);
  }
  const missing = await t3Home();
  assert.equal((await inspectT3(missing.target)).state, 'missing');
  await assert.rejects(
    installT3Provider(missing.target, { backupDir: missing.backupDir }),
    /Open T3 Code once/,
  );
});

test('the settings file keeps its mode', { skip }, async () => {
  const box = await t3Home(BASE, { mode: 0o640 });
  await installT3Provider(box.target, {
    backupDir: box.backupDir,
    settleMs: 0,
  });
  assert.equal((await fs.stat(box.file)).mode & 0o777, 0o640);
});

test('a symlinked settings file is refused', { skip }, async () => {
  const box = await t3Home();
  const real = path.join(box.root, 'settings.json');
  await fs.writeFile(real, `${JSON.stringify(BASE)}\n`);
  await fs.symlink(real, box.file);
  assert.equal((await inspectT3(box.target)).state, 'unsafe');
  await assert.rejects(
    installT3Provider(box.target, { backupDir: box.backupDir, settleMs: 0 }),
    /not a regular file/,
  );
  assert.equal(await fs.readFile(real, 'utf8'), `${JSON.stringify(BASE)}\n`);
});

test('an entry T3 drops during its reload is written again', {
  skip,
}, async () => {
  const box = await t3Home(BASE);
  // Play T3 rewriting the file from settings it held before subc's write.
  let dropped = false;
  const stale = `${JSON.stringify(BASE, null, '\t')}\n`;
  const watcher = (async () => {
    for (let i = 0; i < 200 && !dropped; i++) {
      const text = await fs.readFile(box.file, 'utf8');
      if (text.includes(T3_INSTANCE_ID)) {
        await fs.writeFile(`${box.file}.t3`, stale);
        await fs.rename(`${box.file}.t3`, box.file);
        dropped = true;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  })();
  await installT3Provider(box.target, {
    backupDir: box.backupDir,
    settleMs: 250,
  });
  await watcher;
  assert.ok(dropped, 'the simulated reload ran');
  assert.ok((await box.read()).providerInstances[T3_INSTANCE_ID]);
});

test('a write that lands before the compare is kept and retried', {
  skip,
}, async () => {
  const box = await t3Home({ ...BASE, counter: 0 });
  let last = 0;
  let stop = false;
  const writer = (async () => {
    while (!stop) {
      const settings = JSON.parse(await fs.readFile(box.file, 'utf8'));
      settings.counter = ++last;
      await fs.writeFile(`${box.file}.w`, JSON.stringify(settings));
      await fs.rename(`${box.file}.w`, box.file);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  })();
  setTimeout(() => {
    stop = true;
  }, 150);
  await installT3Provider(box.target, {
    backupDir: box.backupDir,
    settleMs: 300,
  });
  await writer;
  const settings = await box.read();
  assert.equal(settings.counter, last);
  assert.ok(settings.providerInstances[T3_INSTANCE_ID]);
});

test('uninstall removes only subc entry and keeps a backup', {
  skip,
}, async () => {
  const box = await t3Home({
    ...BASE,
    providerInstances: { ...BASE.providerInstances, [T3_INSTANCE_ID]: ours() },
  });
  const result = await removeT3Provider(box.target, {
    backupDir: box.backupDir,
  });
  assert.equal(result.removed, true);
  assert.ok(result.backup);
  const settings = await box.read();
  assert.deepEqual(settings.providerInstances, BASE.providerInstances);
  assert.deepEqual(settings.someFutureSetting, BASE.someFutureSetting);
  assert.deepEqual(
    await removeT3Provider(box.target, { backupDir: box.backupDir }),
    { removed: false, backup: null },
  );
  const none = await t3Home();
  assert.deepEqual(await removeT3Provider(none.target, {}), {
    removed: false,
    backup: null,
  });
});

test('backups are pruned to the last ten', { skip }, async () => {
  const box = await t3Home(BASE);
  for (let i = 0; i < 12; i++) {
    await installT3Provider(box.target, {
      backupDir: box.backupDir,
      settleMs: 0,
    });
    await removeT3Provider(box.target, { backupDir: box.backupDir });
  }
  assert.equal((await fs.readdir(box.backupDir)).length, 10);
});
