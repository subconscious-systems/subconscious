import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const runPath = new URL('../bin/runbook/subconscious-code/run.sh', import.meta.url);
const installPath = new URL('../bin/runbook/subconscious-code/install.sh', import.meta.url);

async function makeFakeSc(root) {
  const binDir = path.join(root, 'bin');
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(
    path.join(binDir, 'sc'),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" >"$SC_TEST_ARGS_FILE"
printf '%s\n' "$SC_BASE_URL" >"$SC_TEST_BASE_URL_FILE"
printf '%s\n' "$SC_DLR_URL" >"$SC_TEST_DLR_URL_FILE"
printf '%s\n' "$SC_DLR_ENABLED" >"$SC_TEST_DLR_ENABLED_FILE"
printf '%s\n' "$SC_API_KEY" >"$SC_TEST_API_KEY_FILE"
printf '%s\n' "$SC_MODEL" >"$SC_TEST_MODEL_FILE"
exit "\${SC_TEST_EXIT_CODE:-0}"
`,
    { mode: 0o755 },
  );
  return binDir;
}

function runSc(root, binDir, args = [], overrides = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [runPath.pathname, ...args], {
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
        GATEWAY_URL: 'https://gateway.example/',
        API_KEY: 'shared-key',
        SC_API_KEY: 'sc-specific-key',
        MODEL: 'subconscious/glm-5.3-marathon',
        SC_TEST_ARGS_FILE: path.join(root, 'args'),
        SC_TEST_BASE_URL_FILE: path.join(root, 'base-url'),
        SC_TEST_DLR_URL_FILE: path.join(root, 'dlr-url'),
        SC_TEST_DLR_ENABLED_FILE: path.join(root, 'dlr-enabled'),
        SC_TEST_API_KEY_FILE: path.join(root, 'api-key'),
        SC_TEST_MODEL_FILE: path.join(root, 'model'),
        ...overrides,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

test('Subconscious Code receives the selected profile and passthrough arguments', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-sc-test-'));
  try {
    const binDir = await makeFakeSc(root);
    const result = await runSc(root, binDir, ['-p', 'fix the tests']);
    assert.equal(result.code, 0, result.stderr);

    const args = (await fs.readFile(path.join(root, 'args'), 'utf8'))
      .split('\n')
      .filter(Boolean);
    assert.deepEqual(args, ['-p', 'fix the tests']);
    assert.equal(await fs.readFile(path.join(root, 'base-url'), 'utf8'), 'https://gateway.example/v1\n');
    assert.equal(await fs.readFile(path.join(root, 'dlr-url'), 'utf8'), 'https://gateway.example\n');
    assert.equal(await fs.readFile(path.join(root, 'dlr-enabled'), 'utf8'), 'true\n');
    assert.equal(await fs.readFile(path.join(root, 'api-key'), 'utf8'), 'sc-specific-key\n');
    assert.equal(
      await fs.readFile(path.join(root, 'model'), 'utf8'),
      'subconscious/glm-5.3-marathon\n',
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Subconscious Code launch mirrors its exit status', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-sc-exit-test-'));
  try {
    const binDir = await makeFakeSc(root);
    const result = await runSc(root, binDir, [], { SC_TEST_EXIT_CODE: '9' });
    assert.equal(result.code, 9);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('macOS installer passes rc-cli as Cargo\'s positional crate argument', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-sc-install-test-'));
  const binDir = path.join(root, 'bin');
  const argsFile = path.join(root, 'cargo-args');
  try {
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(
      path.join(binDir, 'uname'),
      '#!/usr/bin/env bash\nprintf \'Darwin\\n\'\n',
      { mode: 0o755 },
    );
    await fs.writeFile(
      path.join(binDir, 'cargo'),
      '#!/usr/bin/env bash\nprintf \'%s\\n\' "$@" >"$SC_TEST_CARGO_ARGS_FILE"\n',
      { mode: 0o755 },
    );

    const result = await new Promise((resolve, reject) => {
      const child = spawn('bash', [installPath.pathname, 'install'], {
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
          SC_CODE_VERSION: 'v0.1.0',
          SC_TEST_CARGO_ARGS_FILE: argsFile,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stderr }));
    });

    assert.equal(result.code, 0, result.stderr);
    const args = (await fs.readFile(argsFile, 'utf8')).trim().split('\n');
    assert.deepEqual(args, [
      'install',
      '--locked',
      '--git',
      'https://github.com/subconscious-systems/subconscious-code',
      '--bin',
      'sc',
      '--tag',
      'v0.1.0',
      'rc-cli',
    ]);
    assert.ok(!args.includes('--package'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
