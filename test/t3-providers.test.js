import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';
import { LAUNCHER_SHEBANG, launcherScript } from '../bin/t3-launch.js';
import { encodePlan, SHELL_STARTUP_ENV } from '../bin/t3-plan.js';
import { CODEX_PROVIDER } from '../bin/t3-providers.js';

const FIXTURE_INPUTS = {
  node: '/opt/node 22/bin/node',
  adapter: "/opt/it's subc/bin/t3-codex.js",
  binary: '/usr/local/bin/codex',
  configDir: '/home/dev/.subconscious',
  version: '8.2.0',
};

test('the Codex launcher is the 78f67a8 launcher plus the BASH_ENV fix', async () => {
  // Written by launcherScript at 78f67a8 (subc 8.2.0) for FIXTURE_INPUTS.
  const fixture = await fs.readFile(
    new URL('./fixtures/t3-codex-launcher-78f67a8.sh', import.meta.url),
    'utf8',
  );
  const expected = fixture
    .replace('#!/usr/bin/env bash\n', `${LAUNCHER_SHEBANG}\n`)
    .replace('\nset -u\n', '\nunset BASH_ENV ENV\nset -u\n');
  assert.equal(expected.split('\n').length, fixture.split('\n').length + 1);
  assert.equal(launcherScript(FIXTURE_INPUTS), expected);
  assert.equal(
    launcherScript({ ...FIXTURE_INPUTS, provider: CODEX_PROVIDER }),
    expected,
  );
});

test('the launcher refuses descriptor names that are not safe shell words', () => {
  for (const change of [
    { binaryName: 'codex; rm -rf' },
    { launcherName: "subc-t3-'x" },
    { binaryFlag: '--codex $(id)' },
  ])
    assert.throws(
      () =>
        launcherScript({
          ...FIXTURE_INPUTS,
          provider: { ...CODEX_PROVIDER, ...change },
        }),
      /unsafe launcher names/,
    );
});

function decode(text) {
  const fields = text.split('\0');
  const records = [];
  for (let i = 0; i + 1 < fields.length; i += 2)
    records.push([fields[i], fields[i + 1]]);
  return records;
}

test('a plan unsets the names in plan.unset even when the env lacks them', () => {
  const original = { PATH: '/bin', DROPPED: '1', KEPT: 'a' };
  const plan = { argv: ['bash', 'run.sh'], env: { PATH: '/bin', KEPT: 'b' } };
  assert.deepEqual(decode(encodePlan(plan, original)), [
    ['unset', 'DROPPED'],
    ['env', 'KEPT=b'],
    ['arg', 'bash'],
    ['arg', 'run.sh'],
    ['ok', ''],
  ]);
  assert.deepEqual(
    decode(
      encodePlan(
        { ...plan, unset: [...SHELL_STARTUP_ENV, 'DROPPED', 'KEPT'] },
        original,
      ),
    ),
    [
      ['unset', 'DROPPED'],
      ['unset', 'BASH_ENV'],
      ['unset', 'ENV'],
      ['env', 'KEPT=b'],
      ['arg', 'bash'],
      ['arg', 'run.sh'],
      ['ok', ''],
    ],
  );
});
