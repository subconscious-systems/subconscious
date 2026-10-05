import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  IMAGE_LABEL,
  imagesToDrop,
  MAX_IMAGES,
  windowFetch,
  windowImages,
} from '../bin/runbook/image-window/window.js';
import { runSync, setupCommand } from './helpers/agent-command.js';

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

// The byte budget: large screenshots can pass Baseten's limit before 100.
test('the window keeps the newest images within both limits', () => {
  assert.equal(imagesToDrop([1, 1, 1], 100, 10), 0);
  assert.equal(imagesToDrop([1, 1, 1], 2, 10), 1);
  assert.equal(imagesToDrop([4, 4, 4], 100, 10), 1);
  // The newest image is always kept, even alone over the budget.
  assert.equal(imagesToDrop([5, 50], 100, 10), 1);
  assert.equal(imagesToDrop([], 100, 10), 0);
});

// Removals per turn: turn k's request carries the first k screenshots.
function removalsPerTurn(sizes, soft, hard) {
  const drops = sizes.map((_, k) =>
    imagesToDrop(sizes.slice(0, k + 1), MAX_IMAGES, soft, hard),
  );
  return drops.slice(1).map((d, k) => d - drops[k]);
}

test('never more than one screenshot is removed per turn', () => {
  // Sizes vary 0.3 to 1.2 units, as real screenshots do; soft 50, hard 62.
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const sizes = Array.from({ length: 300 }, () => 0.3 + 0.9 * random());
  const steps = removalsPerTurn(sizes, 50, 62);
  assert.equal(Math.max(...steps), 1);
  assert.equal(Math.min(...steps), 0);
});

test('a big screenshot goes over the soft limit, then catches up one per turn', () => {
  const sizes = [10, 10, 10, 10, 10, 15, 10, 10];
  assert.deepEqual(removalsPerTurn(sizes, 50, 62), [0, 0, 0, 0, 1, 1, 1]);
  // Turn 6 keeps 55 units: over the soft limit, under the hard one.
  assert.equal(imagesToDrop(sizes.slice(0, 6), MAX_IMAGES, 50, 62), 1);
});

test('reaching the hard limit drops straight back to the soft limit', () => {
  // Turn 6 would keep 70 units with one removal: over 62, so it drops to 50.
  const sizes = [10, 10, 10, 10, 10, 30];
  assert.equal(imagesToDrop(sizes, MAX_IMAGES, 50, 62), 3);
});

test('the count limit still removes exactly one per new screenshot', () => {
  const sizes = Array.from({ length: MAX_IMAGES + 50 }, () => 1);
  assert.equal(imagesToDrop(sizes, MAX_IMAGES, 1e9, 1e9), 50);
  assert.deepEqual(
    new Set(removalsPerTurn(sizes, 1e9, 1e9).slice(MAX_IMAGES)),
    new Set([1]),
  );
});

test('big screenshots are trimmed by bytes before the count', () => {
  const body = payload(10);
  for (const message of body.messages)
    for (const part of Array.isArray(message.content) ? message.content : [])
      if (part.type === 'image_url') part.image_url.url += 'x'.repeat(1000);
  const kept = urls(windowImages(body, MAX_IMAGES, 3500));
  assert.equal(kept.length, 3);
  assert.match(kept[0], /base64,7x/);
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
  const env = { ...process.env, PI_CODING_AGENT_DIR: piDir };
  const installed = runSync(
    setupCommand(
      'pi',
      [
        'install',
        '--gateway-url',
        'https://gateway.example',
        '--api-key',
        'sk-test',
      ],
      env,
    ),
  );
  assert.equal(installed.status, 0, installed.stderr);
  const dir = path.join(piDir, 'extensions', 'subconscious-image-window');
  for (const file of ['index.ts', 'window.js'])
    await fs.access(path.join(dir, file));

  const removed = runSync(setupCommand('pi', ['uninstall'], env));
  assert.equal(removed.status, 0, removed.stderr);
  await assert.rejects(fs.access(dir));
});
