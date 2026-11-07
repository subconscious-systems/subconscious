import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { MAX_IMAGES, windowFetch } from '../bin/runbook/image-window/window.js';

function requestBody(count) {
  return JSON.stringify({
    model: 'subconscious/deepseek-v4.1-flash-marathon',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Preserve Unicode: \u00e9' },
          ...Array.from({ length: count }, () => ({
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,AAAA' },
          })),
        ],
      },
    ],
  });
}

test('windowed native fetch recomputes Content-Length after shrinking JSON', async () => {
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('error', () => {});
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          bytes: body.length,
          contentLength: request.headers['content-length'],
          payload: JSON.parse(body.toString('utf8')),
        }),
      );
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const body = requestBody(MAX_IMAGES + 1);
    const response = await windowFetch(fetch)(
      `http://127.0.0.1:${server.address().port}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(body)),
        },
        body,
        signal: AbortSignal.timeout(3000),
      },
    );
    const received = await response.json();
    assert.equal(Number(received.contentLength), received.bytes);
    assert.equal(
      received.payload.messages[0].content.filter(
        (part) => part.type === 'image_url',
      ).length,
      MAX_IMAGES,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('windowing preserves caller headers and unmodified request identities', async () => {
  for (const headers of [
    { 'Content-Length': '9999', Authorization: 'Bearer dummy' },
    [
      ['content-length', '9999'],
      ['authorization', 'Bearer dummy'],
    ],
    new Headers({ 'content-length': '9999', Authorization: 'Bearer dummy' }),
  ]) {
    let sent;
    const wrapped = windowFetch(async (_input, init) => {
      sent = init;
      return {};
    });
    await wrapped('https://gateway.example', {
      headers,
      body: requestBody(MAX_IMAGES + 1),
    });
    assert.equal(new Headers(sent.headers).has('content-length'), false);
    assert.equal(
      new Headers(sent.headers).get('authorization'),
      'Bearer dummy',
    );
    assert.equal(new Headers(headers).get('content-length'), '9999');
    const unchanged = { headers, body: requestBody(MAX_IMAGES) };
    await wrapped('https://gateway.example', unchanged);
    assert.equal(sent, unchanged);
  }
});

test('windowing corrects headers inherited from a Request without consuming it', async () => {
  const body = requestBody(MAX_IMAGES + 1);
  const request = new Request('https://gateway.example', {
    method: 'POST',
    headers: {
      'Content-Length': String(Buffer.byteLength(body)),
      Authorization: 'Bearer dummy',
    },
    body,
  });
  let sent;
  await windowFetch(async (_input, init) => {
    sent = init;
    return {};
  })(request, { body });
  assert.equal(new Headers(sent.headers).has('content-length'), false);
  assert.equal(new Headers(sent.headers).get('authorization'), 'Bearer dummy');
  assert.equal(
    request.headers.get('content-length'),
    String(Buffer.byteLength(body)),
  );
  assert.equal(request.bodyUsed, false);
});
