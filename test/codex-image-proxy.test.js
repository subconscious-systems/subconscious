import assert from 'node:assert/strict';
import http from 'node:http';
import { after, test } from 'node:test';
import {
  MAX_IMAGES,
  startImageProxy,
  windowResponsesBody,
} from '../bin/runbook/codex/image-proxy.js';

// Codex's shape: each screenshot comes back as a function_call_output.
function codexBody(images) {
  const input = [
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'go' }],
    },
  ];
  for (let n = 0; n < images; n++) {
    input.push({
      type: 'function_call',
      call_id: `c${n}`,
      name: 'view_image',
      arguments: '{}',
    });
    input.push({
      type: 'function_call_output',
      call_id: `c${n}`,
      output: [
        {
          type: 'input_image',
          image_url: `data:image/png;base64,${'A'.repeat(64)}${n}`,
          detail: 'high',
        },
      ],
    });
  }
  return Buffer.from(
    JSON.stringify({
      model: 'subconscious/deepseek-v4.1-flash-marathon',
      input,
      stream: true,
    }),
  );
}

function images(buffer) {
  return JSON.parse(buffer.toString())
    .input.flatMap((item) =>
      Array.isArray(item.output) ? item.output : (item.content ?? []),
    )
    .filter((part) => part.type === 'input_image')
    .map((part) => part.image_url.slice(-3));
}

test('a body at the cap is returned as is', () => {
  const body = codexBody(MAX_IMAGES);
  assert.equal(windowResponsesBody(body), body);
});

test('past the cap the oldest images become the text the gateway leaves', () => {
  const trimmed = windowResponsesBody(codexBody(MAX_IMAGES + 2));
  const kept = images(trimmed);
  assert.equal(kept.length, MAX_IMAGES);
  assert.equal(kept[0], 'AA2');
  const parsed = JSON.parse(trimmed.toString());
  assert.deepEqual(parsed.input[2].output, [
    { type: 'input_text', text: 'image' },
  ]);
  // Nothing else moves: same items, same order.
  assert.equal(parsed.input.length, 1 + 2 * (MAX_IMAGES + 2));
});

test('each new turn replaces exactly one more image', () => {
  const turn = JSON.parse(
    windowResponsesBody(codexBody(MAX_IMAGES + 1)).toString(),
  );
  const next = JSON.parse(
    windowResponsesBody(codexBody(MAX_IMAGES + 2)).toString(),
  );
  turn.input[4].output = [{ type: 'input_text', text: 'image' }];
  assert.deepEqual(next.input.slice(0, -2), turn.input);
});

test('bodies that are not plain JSON pass through', () => {
  for (const body of [
    Buffer.from('not json'),
    Buffer.from([0x28, 0xb5, 0x2f, 0xfd]),
  ])
    assert.equal(windowResponsesBody(body), body);
});

// Live: harness -> proxy -> fake upstream.
const received = [];
const upstream = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    received.push({
      method: req.method,
      url: req.url,
      body: Buffer.concat(chunks),
      headers: req.headers,
    });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: one\n\n');
    setTimeout(() => res.end('data: two\n\n'), 20);
  });
});
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const proxy = await startImageProxy({
  upstream: `http://127.0.0.1:${upstream.address().port}`,
});
after(async () => {
  await proxy.close();
  upstream.close();
});

function send(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${proxy.url}${path}`,
      {
        method,
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer sk-test',
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

test('the proxy trims what it forwards and streams the reply back', async () => {
  const reply = await send('POST', '/v1/responses', codexBody(MAX_IMAGES + 5));
  assert.equal(reply.status, 200);
  assert.equal(reply.body, 'data: one\n\ndata: two\n\n');
  const forwarded = received.at(-1);
  assert.equal(forwarded.url, '/v1/responses');
  assert.equal(forwarded.headers.authorization, 'Bearer sk-test');
  assert.equal(images(forwarded.body).length, MAX_IMAGES);
  assert.equal(
    Number(forwarded.headers['content-length']),
    forwarded.body.length,
  );
});

test('requests without a body pass straight through', async () => {
  const reply = await send('GET', '/v1/models/available');
  assert.equal(reply.status, 200);
  assert.equal(received.at(-1).method, 'GET');
});
