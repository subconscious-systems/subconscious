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

function runInstaller(root, binDir, overrides = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [installPath.pathname, 'install'], {
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
        SC_CODE_VERSION: 'v0.1.1',
        SC_INSTALL_DIR: path.join(root, 'install'),
        SC_TEST_GH_CALLS_FILE: path.join(root, 'gh-calls'),
        ...overrides,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function makeFakeInstallerTools(root) {
  const binDir = path.join(root, 'bin');
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(
    path.join(binDir, 'uname'),
    `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  -s) printf '%s\\n' "$SC_TEST_UNAME_S" ;;
  -m) printf '%s\\n' "$SC_TEST_UNAME_M" ;;
  *) exit 2 ;;
esac
`,
    { mode: 0o755 },
  );
  await fs.writeFile(
    path.join(binDir, 'gh'),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >>"$SC_TEST_GH_CALLS_FILE"
if [[ "$1" == release && "$2" == view ]]; then
  exit 0
fi
[[ "$1" == release && "$2" == download ]] || exit 2
shift 2
dir=''
patterns=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) dir="$2"; shift 2 ;;
    --pattern) patterns+=("$2"); shift 2 ;;
    *) shift ;;
  esac
done
mkdir -p "$dir"
for pattern in "\${patterns[@]}"; do
  : >"$dir/$pattern"
done
`,
    { mode: 0o755 },
  );
  await fs.writeFile(
    path.join(binDir, 'sha256sum'),
    '#!/usr/bin/env bash\nexit 0\n',
    { mode: 0o755 },
  );
  await fs.writeFile(
    path.join(binDir, 'tar'),
    `#!/usr/bin/env bash
set -euo pipefail
dest=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    -C) dest="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf '#!/usr/bin/env bash\\n' >"$dest/sc"
chmod 0755 "$dest/sc"
`,
    { mode: 0o755 },
  );
  return binDir;
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

test('Subconscious Code installer selects the matching release target', async (t) => {
  const cases = [
    ['Darwin', 'arm64', 'aarch64-apple-darwin'],
    ['Darwin', 'x86_64', 'x86_64-apple-darwin'],
    ['Linux', 'aarch64', 'aarch64-unknown-linux-musl'],
    ['Linux', 'arm64', 'aarch64-unknown-linux-musl'],
    ['Linux', 'x86_64', 'x86_64-unknown-linux-musl'],
    ['Linux', 'amd64', 'x86_64-unknown-linux-musl'],
  ];

  for (const [platform, architecture, target] of cases) {
    await t.test(`${platform} ${architecture}`, async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-sc-install-test-'));
      try {
        const binDir = await makeFakeInstallerTools(root);
        const result = await runInstaller(root, binDir, {
          SC_TEST_UNAME_S: platform,
          SC_TEST_UNAME_M: architecture,
        });

        assert.equal(result.code, 0, result.stderr);
        assert.match(result.stdout, new RegExp(`for ${target}`));
        assert.match(result.stdout, /Installed Subconscious Code v0\.1\.1/);
        await fs.access(path.join(root, 'install', 'sc'));

        const ghCalls = await fs.readFile(path.join(root, 'gh-calls'), 'utf8');
        assert.match(ghCalls, new RegExp(`--pattern sc-${target}\\.tar\\.gz(?:\\s|$)`));
        assert.match(ghCalls, new RegExp(`--pattern sc-${target}\\.tar\\.gz\\.sha256(?:\\s|$)`));
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('Subconscious Code installer rejects unsupported platforms', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-sc-install-unsupported-'));
  try {
    const binDir = await makeFakeInstallerTools(root);
    const result = await runInstaller(root, binDir, {
      SC_TEST_UNAME_S: 'FreeBSD',
      SC_TEST_UNAME_M: 'x86_64',
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /unsupported platform or architecture: FreeBSD x86_64/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
