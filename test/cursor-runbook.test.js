import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const cursorDir = new URL('../bin/runbook/cursor/', import.meta.url);
const hookPath = new URL('hook.sh', cursorDir);
const hooksPath = new URL('hooks.json', cursorDir);
const testHome = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-cursor-test-'));
const requests = [];

const server = http.createServer((request, response) => {
  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => {
    body += chunk;
  });
  request.on('end', () => {
    requests.push({
      url: request.url,
      authorization: request.headers.authorization,
      client: request.headers['x-subconscious-client'],
      body: JSON.parse(body),
    });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{}');
  });
});

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(testHome, { recursive: true, force: true });
});

function runHook(payload) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const child = spawn('bash', [hookPath.pathname], {
      env: {
        ...process.env,
        HOME: testHome,
        SUBCONSCIOUS_GATEWAY_URL: `http://127.0.0.1:${address.port}`,
        SUBCONSCIOUS_API_KEY: 'test-cursor-key',
        SUBCONSCIOUS_HOOKS_ENV: path.join(testHome, 'missing.env'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
}

test('Cursor manifest registers both correlation lifecycle hooks', async () => {
  const manifest = JSON.parse(await fs.readFile(hooksPath, 'utf8'));
  assert.deepEqual(Object.keys(manifest.hooks).sort(), [
    'beforeSubmitPrompt',
    'preCompact',
  ]);
  assert.equal(manifest.hooks.beforeSubmitPrompt[0].command, 'HOOK_SH_PATH');
  assert.equal(manifest.hooks.preCompact[0].command, 'HOOK_SH_PATH');
});

test('Cursor hook forwards prompt and compaction correlation events', async () => {
  const promptResult = await runHook({
    hook_event_name: 'beforeSubmitPrompt',
    conversation_id: 'cursor-conversation-1',
    prompt: 'Keep this raw prompt',
    workspace_roots: ['/workspace/subconscious'],
  });
  assert.equal(promptResult.code, 0, promptResult.stderr);
  assert.deepEqual(JSON.parse(promptResult.stdout), {
    continue: true,
    permission: 'allow',
  });

  const compactResult = await runHook({
    hook_event_name: 'preCompact',
    conversation_id: 'cursor-conversation-1',
    generation_id: 'generation-2',
    is_first_compaction: true,
    trigger: 'auto',
    context_tokens: 120000,
    context_window_size: 200000,
    context_usage_percent: 60,
    message_count: 42,
    messages_to_compact: 10,
  });
  assert.equal(compactResult.code, 0, compactResult.stderr);
  assert.deepEqual(JSON.parse(compactResult.stdout), {});

  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.url, '/v1/agent-hooks');
    assert.equal(request.authorization, 'Bearer test-cursor-key');
    assert.equal(request.client, 'cursor');
  }
  assert.deepEqual(requests[0].body, {
    event: 'conversation_ensure',
    conversation_id: 'cursor-conversation-1',
    prompt: 'Keep this raw prompt',
    workspace: 'subconscious',
    hook_event_name: 'beforeSubmitPrompt',
  });
  assert.deepEqual(requests[1].body, {
    event: 'conversation_compaction',
    conversation_id: 'cursor-conversation-1',
    phase: 'point',
    hook_event_name: 'preCompact',
    dedupe_key: 'cursor-conversation-1:generation-2:true',
    metadata: {
      trigger: 'auto',
      context_tokens: 120000,
      context_window_size: 200000,
      context_usage_percent: 60,
      message_count: 42,
      messages_to_compact: 10,
      is_first_compaction: true,
    },
  });
});
