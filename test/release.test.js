import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const guard = fileURLToPath(new URL('../scripts/require-publish-script.js', import.meta.url));

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

  const workflow = await fs.readFile(
    new URL('../.github/workflows/release-please.yaml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /SUBCONSCIOUS_RELEASE_PLEASE: "1"/);
  assert.match(workflow, /npm publish --access public/);
  assert.match(workflow, /id-token: write/);
  assert.doesNotMatch(workflow, /NPM_TOKEN/);
});
