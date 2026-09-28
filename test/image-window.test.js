import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  IMAGE_LABEL,
  MAX_IMAGES,
  windowFetch,
  windowImages,
} from '../bin/runbook/image-window/window.js';

const MODEL = 'subconscious/deepseek-v4.1-flash-marathon';

function image(n) {
  return {
    type: 'image_url',
    image_url: { url: `data:image/png;base64,${n}` },
  };
}

// Pi's shape: tool text, then the screenshot in a following user message.
function payload(images, model = MODEL) {
  const messages = [{ role: 'user', content: 'take screenshots' }];
  for (let n = 0; n < images; n++) {
    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: `c${n}`, type: 'function' }],
    });
    messages.push({ role: 'tool', tool_call_id: `c${n}`, content: 'ok' });
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: 'Attached image(s) from tool result:' },
        image(n),
      ],
    });
  }
  return { model, messages };
}

function urls(body) {
  return body.messages
    .flatMap((message) =>
      Array.isArray(message.content) ? message.content : [],
    )
    .filter((part) => part.type === 'image_url')
    .map((part) => part.image_url.url);
}

test('a request at the cap is left alone', () => {
  assert.equal(windowImages(payload(MAX_IMAGES)), undefined);
});

test('past the cap only the oldest images are replaced by the label', () => {
  const before = payload(MAX_IMAGES + 2);
  const after = windowImages(before);
  const kept = urls(after);
  assert.equal(kept.length, MAX_IMAGES);
  assert.equal(kept[0], 'data:image/png;base64,2');
  // Each step stays; the image becomes the text the gateway would leave.
  assert.equal(after.messages.length, before.messages.length);
  assert.deepEqual(after.messages[3].content, [
    { type: 'text', text: 'Attached image(s) from tool result:' },
    { type: 'text', text: IMAGE_LABEL },
  ]);
  // The request Pi built is not modified.
  assert.equal(urls(before).length, MAX_IMAGES + 2);
});

test('each new turn replaces exactly one more image', () => {
  const turn = windowImages(payload(MAX_IMAGES + 1));
  const next = windowImages(payload(MAX_IMAGES + 2));
  const expected = structuredClone(turn.messages);
  expected[6].content[1] = { type: 'text', text: IMAGE_LABEL };
  assert.deepEqual(next.messages.slice(0, -3), expected);
});

test('other providers are never touched', () => {
  assert.equal(windowImages(payload(MAX_IMAGES + 5, 'gpt-5')), undefined);
});

test('a payload without messages is left alone', () => {
  assert.equal(windowImages({ model: MODEL }), undefined);
  assert.equal(windowImages(undefined), undefined);
});

// OpenCode: the same rule, applied inside the fetch OpenCode sends with.
function recordingFetch() {
  const calls = [];
  const fetchFn = async (input, init) => {
    calls.push({ input, init });
    return new Response('{}');
  };
  return { calls, fetchFn };
}

test('the wrapped fetch trims the body it sends', async () => {
  const { calls, fetchFn } = recordingFetch();
  const body = JSON.stringify(payload(MAX_IMAGES + 3));
  await windowFetch(fetchFn)('https://gateway.example/v1/chat/completions', {
    method: 'POST',
    body,
  });
  assert.equal(calls.length, 1);
  assert.equal(urls(JSON.parse(calls[0].init.body)).length, MAX_IMAGES);
  assert.equal(calls[0].init.method, 'POST');
});

test('the wrapped fetch passes everything else through untouched', async () => {
  const { calls, fetchFn } = recordingFetch();
  const wrapped = windowFetch(fetchFn);
  const small = JSON.stringify(payload(3));
  for (const init of [{ body: small }, { body: 'not json' }, undefined])
    await wrapped('https://gateway.example/v1/models', init);
  assert.deepEqual(
    calls.map((call) => call.init),
    [{ body: small }, { body: 'not json' }, undefined],
  );
});

const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-pi-window-'));
after(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

test('subc installs the image window extension with Pi', async () => {
  const piDir = path.join(testDir, 'pi-agent');
  const runbook = new URL('../bin/runbook/pi/install.sh', import.meta.url);
  const env = {
    ...process.env,
    PI_CODING_AGENT_DIR: piDir,
    SUBC_ENV_FILE: os.devNull,
  };
  const installed = spawnSync(
    'bash',
    [
      runbook.pathname,
      'install',
      '--gateway-url',
      'https://gateway.example',
      '--api-key',
      'sk-test',
    ],
    { encoding: 'utf8', env },
  );
  assert.equal(installed.status, 0, installed.stderr);
  const dir = path.join(piDir, 'extensions', 'subconscious-image-window');
  for (const file of ['index.ts', 'window.js'])
    await fs.access(path.join(dir, file));

  const removed = spawnSync('bash', [runbook.pathname, 'uninstall'], {
    encoding: 'utf8',
    env,
  });
  assert.equal(removed.status, 0, removed.stderr);
  await assert.rejects(fs.access(dir));
});
