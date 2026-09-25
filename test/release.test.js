import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const guard = fileURLToPath(
  new URL('../scripts/require-publish-script.js', import.meta.url),
);
const hooks = fileURLToPath(
  new URL('../scripts/install-git-hooks.js', import.meta.url),
);

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
  assert.equal(
    pkg.scripts.prepublishOnly,
    'node scripts/require-publish-script.js',
  );
  assert.equal(pkg.scripts.prepare, 'node scripts/install-git-hooks.js');

  const workflow = await fs.readFile(
    new URL('../.github/workflows/release-please.yaml', import.meta.url),
    'utf8',
  );
  assert.equal(pkg.dependencies, undefined);

  assert.match(workflow, /SUBCONSCIOUS_RELEASE_PLEASE: "1"/);
  assert.match(workflow, /npm publish --access public/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /name: sbom-buildinfo/);
  assert.match(workflow, /go version -m/);
  assert.doesNotMatch(workflow, /NPM_TOKEN/);
});

test('supply-chain CI audits npm, Go, and uploads the SBOM', async () => {
  const workflow = await fs.readFile(
    new URL('../.github/workflows/cli-windows.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /name: supply-chain/);
  assert.match(workflow, /npm audit --omit=dev/);
  assert.match(workflow, /govulncheck@v1\.8\.0/);
  assert.match(workflow, /cyclonedx-gomod@v1\.12\.0/);
  assert.match(workflow, /name: sbom-go/);
  assert.match(workflow, /actions\/upload-artifact@/);
});

test('GitHub actions are pinned to commit SHAs', async () => {
  const workflowDir = fileURLToPath(
    new URL('../.github/workflows/', import.meta.url),
  );
  const files = (await fs.readdir(workflowDir)).filter(
    (name) => name.endsWith('.yml') || name.endsWith('.yaml'),
  );
  assert.ok(files.length > 0);
  for (const file of files) {
    const text = await fs.readFile(path.join(workflowDir, file), 'utf8');
    const uses = [...text.matchAll(/^\s*(?:-\s*)?uses:\s+(\S+)/gm)].map(
      (match) => match[1],
    );
    for (const ref of uses) {
      if (!ref.startsWith('actions/')) continue;
      assert.match(
        ref,
        /^actions\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/,
        `${file} pins ${ref} to a commit SHA`,
      );
    }
  }
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
