import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const runPath = new URL('../bin/runbook/deepseek-harness/run.sh', import.meta.url);

async function makeFakeDsh(root) {
  const binDir = path.join(root, 'bin');
  const fakePath = path.join(binDir, 'dsh');
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(
    fakePath,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\0' "$@" >"$DSH_ARGS_FILE"
patch_file=''
previous=''
for argument in "$@"; do
  if [[ "$previous" == '--patch' ]]; then patch_file="$argument"; break; fi
  previous="$argument"
done
cp "$patch_file" "$DSH_OVERLAY_COPY"
printf '%s\\n' "$SUBCONSCIOUS_DSH_BASE_URL" >"$DSH_BASE_URL_FILE"
printf '%s\\n' "$SUBCONSCIOUS_API_KEY" >"$DSH_API_KEY_FILE"
exit "\${DSH_FAKE_EXIT_CODE:-0}"
`,
    { mode: 0o755 },
  );
  return binDir;
}

function runHarness(root, binDir, args = [], overrides = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [runPath.pathname, ...args], {
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
        TMPDIR: root,
        GATEWAY_URL: 'https://gateway.example/',
        API_KEY: 'test-harness-key',
        MODEL: 'subconscious/glm-5.3-marathon',
        SUBCONSCIOUS_MODELS: [
          'subconscious/glm-5.2',
          'subconscious/deepseek-v4-flash-marathon',
          'subconscious/glm-5.3-marathon',
        ].join('\n'),
        DSH_ARGS_FILE: path.join(root, 'args'),
        DSH_OVERLAY_COPY: path.join(root, 'overlay.yml'),
        DSH_BASE_URL_FILE: path.join(root, 'base-url'),
        DSH_API_KEY_FILE: path.join(root, 'api-key'),
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

async function readNullArgs(file) {
  const raw = await fs.readFile(file, 'utf8');
  return raw.split('\0').filter(Boolean);
}

test('DeepSeek Harness launches web with a temporary live-catalog provider', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-dsh-test-'));
  try {
    const binDir = await makeFakeDsh(root);
    const result = await runHarness(root, binDir, ['--port', '8080']);
    assert.equal(result.code, 0, result.stderr);

    const args = await readNullArgs(path.join(root, 'args'));
    assert.equal(args[0], 'web');
    assert.equal(args[1], '--patch');
    assert.deepEqual(args.slice(3), ['--port', '8080']);
    await assert.rejects(fs.access(args[2]));

    const overlay = await fs.readFile(path.join(root, 'overlay.yml'), 'utf8');
    assert.match(overlay, /provider: subconscious/);
    assert.match(overlay, /model: 'subconscious\/glm-5\.3-marathon'/);
    assert.match(overlay, /x-subconscious-client: deepseek-harness/);
    assert.match(overlay, /supportsDeveloperRole: false/);
    assert.match(overlay, /maxTokensField: max_tokens/);
    assert.equal((overlay.match(/subconscious\/glm-5\.3-marathon/g) || []).length, 3);
    assert.match(overlay, /subconscious\/deepseek-v4-flash-marathon/);
    assert.doesNotMatch(overlay, /test-harness-key/);

    assert.equal(
      await fs.readFile(path.join(root, 'base-url'), 'utf8'),
      'https://gateway.example/v1\n',
    );
    assert.equal(await fs.readFile(path.join(root, 'api-key'), 'utf8'), 'test-harness-key\n');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('DeepSeek Harness supports headless mode and mirrors its exit status', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-dsh-headless-test-'));
  try {
    const binDir = await makeFakeDsh(root);
    const result = await runHarness(
      root,
      binDir,
      ['headless', 'fix the tests'],
      { DSH_FAKE_EXIT_CODE: '7' },
    );
    assert.equal(result.code, 7);
    const args = await readNullArgs(path.join(root, 'args'));
    assert.deepEqual(args.slice(0, 2), ['--profile', 'headless']);
    assert.deepEqual(args.slice(-1), ['fix the tests']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
