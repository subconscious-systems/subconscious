import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { detectInstallTarget } from '../bin/update-check.js';

const SCRIPT = fileURLToPath(new URL('../scripts/install.sh', import.meta.url));
const skip = process.platform === 'win32';

/** A file:// registry that serves fake subconscious-cli releases. */
async function fakeRegistry(root) {
  const registry = path.join(root, 'registry');
  const versions = path.join(registry, 'subconscious-cli');
  await fs.mkdir(versions, { recursive: true });
  const publish = async (
    version,
    { tags = [], integrity, failAfterSwap = false } = {},
  ) => {
    const src = path.join(root, `src-${version}`);
    await fs.mkdir(path.join(src, 'package/bin/native'), { recursive: true });
    await fs.writeFile(
      path.join(src, 'package/package.json'),
      JSON.stringify({ name: 'subconscious-cli', version }),
    );
    await fs.writeFile(
      path.join(src, 'package/bin/cli.js'),
      `#!/usr/bin/env node\n${failAfterSwap ? "if (!__filename.includes('/extract/')) process.exit(3);\n" : ''}console.log(${JSON.stringify(version)});\n`,
    );
    await fs.writeFile(path.join(src, 'package/bin/native/subc-tui'), 'x', {
      mode: 0o644,
    });
    const tarball = path.join(registry, `subconscious-cli-${version}.tgz`);
    execFileSync('tar', ['-czf', tarball, '-C', src, 'package']);
    const digest = createHash('sha512')
      .update(readFileSync(tarball))
      .digest('base64');
    const meta = JSON.stringify({
      name: 'subconscious-cli',
      version,
      engines: { node: '>=18' },
      dist: {
        tarball: pathToFileURL(tarball).href,
        integrity: integrity ?? `sha512-${digest}`,
      },
    });
    for (const name of [version, ...tags])
      await fs.writeFile(path.join(versions, name), meta);
  };
  return { url: pathToFileURL(registry).href, publish };
}

function install(root, registry, extra = {}) {
  const home = path.join(root, 'home');
  return spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: {
      HOME: home,
      PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
      SHELL: '/bin/zsh',
      SUBC_REGISTRY: registry,
      ...extra,
    },
  });
}

test('install.sh installs, upgrades, and records how it installed', {
  skip,
}, async () => {
  const root = realpathSync(
    await fs.mkdtemp(path.join(os.tmpdir(), 'subc-install-')),
  );
  const registry = await fakeRegistry(root);
  await registry.publish('1.0.0');
  await registry.publish('1.1.0', { tags: ['latest'] });
  const home = path.join(root, 'home');
  const pkg = path.join(home, '.local/share/subconscious-cli');
  const link = path.join(home, '.local/bin/subc');

  const first = install(root, registry.url, { SUBC_VERSION: '1.0.0' });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Installing subconscious-cli 1\.0\.0/);
  assert.match(first.stderr, /is not on your PATH.*\.zshrc/);
  assert.equal(execFileSync(link, { encoding: 'utf8' }).trim(), '1.0.0');
  const tui = await fs.stat(path.join(pkg, 'bin/native/subc-tui'));
  assert.ok(tui.mode & 0o100, 'native binaries stay executable');

  const second = install(root, registry.url);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /Updating subconscious-cli 1\.0\.0 -> 1\.1\.0/);
  assert.equal(execFileSync(link, { encoding: 'utf8' }).trim(), '1.1.0');
  assert.equal(existsSync(`${pkg}.old`), false);

  const target = detectInstallTarget(path.join(pkg, 'bin/update-check.js'));
  assert.equal(target.command, 'bash');
  assert.match(target.display, /^curl -fsSL https:\/\/raw\.githubusercontent/);
  assert.ok(target.display.includes(`SUBC_INSTALL_DIR=${pkg}`));
  assert.ok(target.display.includes(`SUBC_BIN_DIR=${path.dirname(link)}`));
  assert.match(target.args[1], /^set -o pipefail; /);
});

test('install.sh refuses a tarball that fails its integrity hash', {
  skip,
}, async () => {
  const root = realpathSync(
    await fs.mkdtemp(path.join(os.tmpdir(), 'subc-install-')),
  );
  const registry = await fakeRegistry(root);
  await registry.publish('1.0.0', { tags: ['latest'] });
  assert.equal(install(root, registry.url).status, 0);
  await registry.publish('2.0.0', {
    tags: ['latest'],
    integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
  });

  const result = install(root, registry.url);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /integrity hash\. Nothing was installed/);
  const link = path.join(root, 'home/.local/bin/subc');
  assert.equal(execFileSync(link, { encoding: 'utf8' }).trim(), '1.0.0');
});

test('install.sh explains a bad version, a missing release, and a taken link', {
  skip,
}, async () => {
  const root = realpathSync(
    await fs.mkdtemp(path.join(os.tmpdir(), 'subc-install-')),
  );
  const registry = await fakeRegistry(root);
  await registry.publish('1.0.0', { tags: ['latest'] });

  const bad = install(root, registry.url, { SUBC_VERSION: '../x' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /SUBC_VERSION must be a version/);

  const missing = install(root, registry.url, { SUBC_VERSION: '9.9.9' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Could not get subconscious-cli@9\.9\.9/);

  const relative = install(root, registry.url, { SUBC_BIN_DIR: 'bin' });
  assert.equal(relative.status, 1);
  assert.match(relative.stderr, /must be absolute paths/);

  const binDir = path.join(root, 'taken');
  await fs.mkdir(binDir);
  await fs.writeFile(path.join(binDir, 'subc'), 'not ours');
  const taken = install(root, registry.url, { SUBC_BIN_DIR: binDir });
  assert.equal(taken.status, 1);
  assert.match(taken.stderr, /exists and is not a link/);
});

test('install.sh refuses to replace a directory that is not a subc install', {
  skip,
}, async () => {
  const root = realpathSync(
    await fs.mkdtemp(path.join(os.tmpdir(), 'subc-install-')),
  );
  const registry = await fakeRegistry(root);
  await registry.publish('1.0.0', { tags: ['latest'] });
  const foreign = path.join(root, 'projects');
  await fs.mkdir(foreign);
  await fs.writeFile(path.join(foreign, 'notes.txt'), 'keep me');
  await fs.writeFile(
    path.join(foreign, 'package.json'),
    JSON.stringify({ name: 'something-else' }),
  );

  const result = install(root, registry.url, { SUBC_INSTALL_DIR: foreign });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /holds no subconscious-cli install/);
  assert.deepEqual((await fs.readdir(foreign)).sort(), [
    'notes.txt',
    'package.json',
  ]);
  assert.equal(existsSync(path.join(root, 'home/.local/bin/subc')), false);
});

test('install.sh restores the old install when the new one fails after the swap', {
  skip,
}, async () => {
  const root = realpathSync(
    await fs.mkdtemp(path.join(os.tmpdir(), 'subc-install-')),
  );
  const registry = await fakeRegistry(root);
  await registry.publish('1.0.0', { tags: ['latest'] });
  assert.equal(install(root, registry.url).status, 0);
  await registry.publish('2.0.0', { tags: ['latest'], failAfterSwap: true });

  const result = install(root, registry.url);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /previous install is back/);
  const link = path.join(root, 'home/.local/bin/subc');
  assert.equal(execFileSync(link, { encoding: 'utf8' }).trim(), '1.0.0');
  const share = await fs.readdir(path.join(root, 'home/.local/share'));
  assert.deepEqual(share, ['subconscious-cli']);
});

test('install.sh refuses a registry that is not https', { skip }, async () => {
  const root = realpathSync(
    await fs.mkdtemp(path.join(os.tmpdir(), 'subc-install-')),
  );
  const result = install(root, 'http://registry.npmjs.org');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be an https:\/\/ URL/);
});
