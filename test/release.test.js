import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const guard = fileURLToPath(new URL('../scripts/require-publish-script.js', import.meta.url));
const hooks = fileURLToPath(new URL('../scripts/install-git-hooks.js', import.meta.url));

test('direct npm publishing is blocked outside the Release Please workflow', () => {
  const direct = spawnSync(process.execPath, [guard], {
    encoding: 'utf8',
    env: { ...process.env, SUBCONSCIOUS_RELEASE_PLEASE: '' },
  });
  assert.notEqual(direct.status, 0);
  assert.match(direct.stderr, /Release Please/);

  const scripted = spawnSync(process.execPath, [guard], {
    encoding: 'utf8',
    env: { ...process.env, SUBCONSCIOUS_RELEASE_PLEASE: '1' },
  });
  assert.equal(scripted.status, 0, scripted.stderr);
});

test('the CLI package only publishes from the Release Please workflow', async () => {
  const pkg = JSON.parse(
    await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.equal(pkg.scripts.prepublishOnly, 'node scripts/require-publish-script.js');
  assert.equal(pkg.scripts.prepare, 'node scripts/install-git-hooks.js');

  const workflow = await fs.readFile(
    new URL('../.github/workflows/release-please.yaml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /SUBCONSCIOUS_RELEASE_PLEASE: "1"/);
  assert.match(workflow, /npm publish --access public/);
  assert.match(workflow, /id-token: write/);
  assert.doesNotMatch(workflow, /NPM_TOKEN/);
});

test('prepare skips hook install when simple-git-hooks is not installed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-prepare-'));
  const script = path.join(dir, 'install-git-hooks.mjs');
  await fs.copyFile(hooks, script);
  try {
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
