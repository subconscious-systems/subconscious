import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';
import { LAUNCHER_SHEBANG, launcherScript } from '../bin/t3-launch.js';
import { CODEX_PROVIDER } from '../bin/t3-providers.js';

test('the Codex launcher is the 78f67a8 launcher with a bash -p shebang', async () => {
  // Written by launcherScript at 78f67a8 (subc 8.2.0) for these inputs.
  const fixture = await fs.readFile(
    new URL('./fixtures/t3-codex-launcher-78f67a8.sh', import.meta.url),
    'utf8',
  );
  const expected = fixture.replace(
    '#!/usr/bin/env bash\n',
    `${LAUNCHER_SHEBANG}\n`,
  );
  assert.notEqual(expected, fixture);
  const script = launcherScript({
    provider: CODEX_PROVIDER,
    node: '/opt/node 22/bin/node',
    adapter: "/opt/it's subc/bin/t3-codex.js",
    binary: '/usr/local/bin/codex',
    configDir: '/home/dev/.subconscious',
    version: '8.2.0',
  });
  assert.equal(script, expected);
});
