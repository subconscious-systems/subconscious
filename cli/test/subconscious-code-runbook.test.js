import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const exec = promisify(execFile);

const runPath = new URL('../bin/runbook/subconscious-code/run.sh', import.meta.url);
const installPath = new URL('../bin/runbook/subconscious-code/install.sh', import.meta.url);

async function makeFakeSc(root) {
  const binDir = path.join(root, 'bin');
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(
    path.join(binDir, 'marathon'),
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
        SC_TEST_ASSET: 'marathon-x86_64-unknown-linux-musl.tar.gz',
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
  [[ "\${SC_TEST_NO_GH:-}" != 1 ]] || exit 1
  printf '%s\\n' "$SC_TEST_ASSET" "$SC_TEST_ASSET.sha256"
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
  if [[ -n "\${SC_TEST_RELEASE_DIR:-}" ]]; then
    cp "$SC_TEST_RELEASE_DIR/$pattern" "$dir/$pattern"
  else
    : >"$dir/$pattern"
  fi
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
entry="\${!#}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    -C) dest="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf '#!/usr/bin/env bash\\n' >"$dest/$entry"
chmod 0755 "$dest/$entry"
`,
    { mode: 0o755 },
  );
  return binDir;
}

test('Marathon receives the selected profile and passthrough arguments', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-sc-test-'));
  try {
    const binDir = await makeFakeSc(root);
    await fs.writeFile(path.join(binDir, 'sc'), '#!/usr/bin/env bash\nexit 99\n', { mode: 0o755 });
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
          SC_TEST_ASSET: `marathon-${target}.tar.gz`,
        });

        assert.equal(result.code, 0, result.stderr);
        assert.match(result.stdout, new RegExp(`for ${target}`));
        assert.match(result.stdout, /Installed Marathon v0\.1\.1/);
        await fs.access(path.join(root, 'install', 'marathon'));

        const ghCalls = await fs.readFile(path.join(root, 'gh-calls'), 'utf8');
        assert.match(ghCalls, new RegExp(`--pattern marathon-${target}\\.tar\\.gz(?:\\s|$)`));
        assert.match(ghCalls, new RegExp(`--pattern marathon-${target}\\.tar\\.gz\\.sha256(?:\\s|$)`));
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

test('Unix installer verifies real archives, migrates legacy names, and preserves existing files on failure', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-marathon-archives-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const binDir = await makeFakeInstallerTools(root);
  // Exercise the host tar and SHA-256 tools, not the mapping-test stubs.
  await fs.rm(path.join(binDir, 'tar'));
  await fs.rm(path.join(binDir, 'sha256sum'));
  const releaseDir = path.join(root, 'release');
  const source = path.join(root, 'source');
  const installDir = path.join(root, 'install');
  await fs.mkdir(releaseDir);
  await fs.mkdir(source);
  await fs.mkdir(installDir);
  await fs.writeFile(path.join(installDir, 'sc'), 'leave existing sc untouched');
  const environment = {
    SC_TEST_UNAME_S: 'Linux', SC_TEST_UNAME_M: 'x86_64', SC_TEST_RELEASE_DIR: releaseDir,
  };
  for (const name of ['sc', 'marathon']) {
    const asset = `${name}-x86_64-unknown-linux-musl.tar.gz`;
    const fixture = `#!/usr/bin/env bash\nprintf 'installed ${name}\\n'\n`;
    await fs.writeFile(path.join(source, name), fixture, { mode: 0o755 });
    await exec('tar', ['-czf', path.join(releaseDir, asset), '-C', source, name]);
    const hash = createHash('sha256').update(await fs.readFile(path.join(releaseDir, asset))).digest('hex');
    await fs.writeFile(path.join(releaseDir, asset + '.sha256'), `${hash}  ${asset}\n`);
    const options = { ...environment, SC_TEST_ASSET: asset };
    const result = await runInstaller(root, binDir, options);
    assert.equal(result.code, 0, result.stderr);
    const destination = path.join(installDir, 'marathon');
    assert.equal(await fs.readFile(destination, 'utf8'), fixture);
    assert.equal((await exec(destination)).stdout, `installed ${name}\n`);
    assert.equal(await fs.readFile(path.join(installDir, 'sc'), 'utf8'), 'leave existing sc untouched');

    await fs.writeFile(path.join(releaseDir, asset + '.sha256'), `${'0'.repeat(64)}  ${asset}\n`);
    const failed = await runInstaller(root, binDir, options);
    assert.notEqual(failed.code, 0);
    assert.equal(await fs.readFile(destination, 'utf8'), fixture);

    // A correctly hashed archive with the wrong entry must not change the install.
    await fs.writeFile(path.join(source, 'wrong'), 'not the native executable');
    await exec('tar', ['-czf', path.join(releaseDir, asset), '-C', source, 'wrong']);
    const wrongHash = createHash('sha256').update(await fs.readFile(path.join(releaseDir, asset))).digest('hex');
    await fs.writeFile(path.join(releaseDir, asset + '.sha256'), `${wrongHash}  ${asset}\n`);
    const wrong = await runInstaller(root, binDir, options);
    assert.notEqual(wrong.code, 0);
    assert.equal(await fs.readFile(destination, 'utf8'), fixture);
    assert.deepEqual((await fs.readdir(installDir)).sort(), ['marathon', 'sc']);
  }
});

test('Unix curl installer falls back only for a missing archive, never for server or checksum failures', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-marathon-curl-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const binDir = await makeFakeInstallerTools(root);
  await fs.writeFile(path.join(binDir, 'curl'), `#!/usr/bin/env bash
set -euo pipefail
url=''; output=''; format=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    -w) format="$2"; shift 2 ;;
    https:*) url="$1"; shift ;;
    *) shift ;;
  esac
done
printf '%s\\n' "$url" >>"$SC_TEST_CURL_CALLS_FILE"
: >"$output"
if [[ "$url" == *.sha256 && "\${SC_TEST_BAD_CHECKSUM:-}" == 1 ]]; then exit 22; fi
if [[ -n "$format" ]]; then printf '%s' "$SC_TEST_HTTP_STATUS"; fi
`, { mode: 0o755 });
  const environment = {
    SC_TEST_UNAME_S: 'Darwin', SC_TEST_UNAME_M: 'arm64', SC_TEST_NO_GH: '1',
    SC_TEST_CURL_CALLS_FILE: path.join(root, 'curl-calls'),
  };
  for (const status of ['200', '404', '503']) {
    await fs.writeFile(environment.SC_TEST_CURL_CALLS_FILE, '');
    const result = await runInstaller(root, binDir, { ...environment, SC_TEST_HTTP_STATUS: status });
    const calls = await fs.readFile(environment.SC_TEST_CURL_CALLS_FILE, 'utf8');
    assert.equal(result.code === 0, status !== '503', result.stderr);
    assert.equal(calls.includes('/sc-aarch64-apple-darwin.tar.gz'), status === '404', calls);
  }
  await fs.writeFile(environment.SC_TEST_CURL_CALLS_FILE, '');
  const result = await runInstaller(root, binDir, { ...environment, SC_TEST_HTTP_STATUS: '200', SC_TEST_BAD_CHECKSUM: '1' });
  assert.notEqual(result.code, 0);
  assert.doesNotMatch(await fs.readFile(environment.SC_TEST_CURL_CALLS_FILE, 'utf8'), /\/sc-aarch64/);
});
