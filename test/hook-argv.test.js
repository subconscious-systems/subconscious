import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

// Any local user can read a running process's argv from ps or
// /proc/<pid>/cmdline, so the hooks must hand curl the API key and the request
// body some other way. A fake curl first on PATH records exactly what curl
// would have been exec'd with.

const runbookDir = new URL('../bin/runbook/', import.meta.url);
const testDir = await fs.mkdtemp(
  path.join(os.tmpdir(), 'subc-hook-argv-test-'),
);
const binDir = path.join(testDir, 'bin');
const apiKey = 'sk-test-argv-check';
const prompt = 'argv check prompt text';

await fs.mkdir(binDir);
await fs.writeFile(
  path.join(binDir, 'curl'),
  `#!/bin/sh
# One line per argument. Header files (-H @file) are read so the test can
# confirm the key still reaches the request; the body arrives on stdin.
for arg in "$@"; do
  printf '%s\\n' "$arg" >> "$CURL_ARGS"
  case "$arg" in
    @-) ;;
    @*) cat "\${arg#@}" >> "$CURL_HEADER_FILES" ;;
  esac
done
cat >> "$CURL_BODY"
`,
  { mode: 0o755 },
);

after(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

async function runHook(agent, payload) {
  const home = await fs.mkdtemp(path.join(testDir, `${agent}-`));
  const files = {
    args: path.join(home, 'args.txt'),
    headerFiles: path.join(home, 'header-files.txt'),
    body: path.join(home, 'body.txt'),
  };
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      'bash',
      [new URL(`${agent}/hook.sh`, runbookDir).pathname],
      {
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
          HOME: home,
          SUBCONSCIOUS_GATEWAY_URL: 'http://127.0.0.1:9',
          SUBCONSCIOUS_API_KEY: apiKey,
          SUBCONSCIOUS_HOOKS_ENV: path.join(home, 'missing.env'),
          CURL_ARGS: files.args,
          CURL_HEADER_FILES: files.headerFiles,
          CURL_BODY: files.body,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
  assert.equal(result.code, 0, result.stderr);
  const read = (file) => fs.readFile(file, 'utf8');
  return {
    args: await read(files.args),
    headerFiles: await read(files.headerFiles),
    body: await read(files.body),
  };
}

function assertNotInArgv(curl, secrets) {
  for (const secret of secrets) {
    assert.ok(
      !curl.args.includes(secret),
      `${secret} leaked into curl argv:\n${curl.args}`,
    );
  }
  // The key still goes out, just not through argv.
  assert.equal(curl.headerFiles, `Authorization: Bearer ${apiKey}\n`);
}

test('Codex hook keeps the API key out of curl argv', async () => {
  const curl = await runHook('codex', {
    hook_event_name: 'PreCompact',
    session_id: 'thr_argv',
    turn_id: 'turn-1',
    trigger: 'auto',
  });
  assertNotInArgv(curl, [apiKey]);
  assert.equal(JSON.parse(curl.body).conversation_id, 'thr_argv');
});

test('Copilot hook keeps the API key and prompt out of curl argv', async () => {
  const curl = await runHook('copilot', {
    hook_event_name: 'UserPromptSubmit',
    session_id: 'copilot-argv',
    prompt,
    cwd: '/workspace/subconscious',
  });
  assertNotInArgv(curl, [apiKey, prompt]);
  assert.equal(JSON.parse(curl.body).prompt, prompt);
});

test('Cursor hook keeps the API key and prompt out of curl argv', async () => {
  const curl = await runHook('cursor', {
    hook_event_name: 'beforeSubmitPrompt',
    conversation_id: 'cursor-argv',
    prompt,
    workspace_roots: ['/workspace/subconscious'],
  });
  assertNotInArgv(curl, [apiKey, prompt]);
  assert.equal(JSON.parse(curl.body).prompt, prompt);
});
