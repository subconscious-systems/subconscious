import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import test from 'node:test';

const guard = new URL('../scripts/require-publish-script.js', import.meta.url);

test('direct npm publishing is blocked outside publish_package.sh', () => {
  const direct = spawnSync(process.execPath, [guard.pathname], {
    encoding: 'utf8',
    env: { ...process.env, SUBCONSCIOUS_PUBLISH_PACKAGE_SH: '' },
  });
  assert.notEqual(direct.status, 0);
  assert.match(direct.stderr, /publish_package\.sh/);

  const scripted = spawnSync(process.execPath, [guard.pathname], {
    encoding: 'utf8',
    env: { ...process.env, SUBCONSCIOUS_PUBLISH_PACKAGE_SH: '1' },
  });
  assert.equal(scripted.status, 0, scripted.stderr);
});

test('the CLI package and release helper enforce the guarded publish path', async () => {
  const pkg = JSON.parse(
    await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.equal(pkg.scripts.prepublishOnly, 'node scripts/require-publish-script.js');

  const releaseScript = await fs.readFile(
    new URL('../../publish_package.sh', import.meta.url),
    'utf8',
  );
  assert.match(
    releaseScript,
    /SUBCONSCIOUS_PUBLISH_PACKAGE_SH=1 npm publish "\.\/\$PKG_DIR" --access public/,
  );
});
