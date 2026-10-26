// The proxy tunnel must behave like global fetch for its callers: honor the
// caller's AbortSignal at every stage, name a timeout the same way, and return
// a real Response, so code paths that only run behind a proxy cannot drift.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createProxyFetch } from '../bin/network.js';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const ca = fs.readFileSync(path.join(fixtures, 'localhost-cert.pem'));
const key = fs.readFileSync(path.join(fixtures, 'localhost-key.pem'));

function trackSockets(server) {
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  return () => {
    for (const socket of sockets) socket.destroy();
  };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

async function close(server, destroySockets) {
  destroySockets();
  await new Promise((resolve) => server.close(resolve));
}

// An HTTPS origin plus a CONNECT proxy in front of it.
async function startOriginBehindProxy(handler) {
  const origin = https.createServer({ key, cert: ca }, handler);
  const destroyOrigin = trackSockets(origin);
  const originPort = await listen(origin);

  const proxy = http.createServer();
  const destroyProxy = trackSockets(proxy);
  proxy.on('connect', (req, clientSocket, head) => {
    const [host, port] = req.url.split(':');
    const upstream = net.connect(Number(port), host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
  });
  const proxyPort = await listen(proxy);

  return {
    url: (pathname) => `https://127.0.0.1:${originPort}${pathname}`,
    proxyFetch: createProxyFetch({
      env: { HTTPS_PROXY: `http://127.0.0.1:${proxyPort}` },
      ca,
    }),
    async stop() {
      await close(proxy, destroyProxy);
      await close(origin, destroyOrigin);
    },
  };
}

test('a tunnel that goes silent after CONNECT honors the caller signal', async () => {
  // A policy proxy can accept CONNECT and then forward nothing. Without the
  // caller's signal the TLS handshake waits forever and the CLI hangs.
  const silent = net.createServer((socket) => {
    socket.once('data', () => socket.write('HTTP/1.1 200 OK\r\n\r\n'));
  });
  const destroy = trackSockets(silent);
  const port = await listen(silent);
  try {
    const proxyFetch = createProxyFetch({
      env: { HTTPS_PROXY: `http://127.0.0.1:${port}` },
      ca,
    });
    const started = Date.now();
    await assert.rejects(
      proxyFetch('https://platform.example/x', {
        signal: AbortSignal.timeout(300),
      }),
      (error) => error.name === 'TimeoutError',
    );
    assert.ok(Date.now() - started < 3000, 'rejected near the 300ms signal');
  } finally {
    await close(silent, destroy);
  }
});

test('an already-aborted signal rejects before any connection', async () => {
  const proxyFetch = createProxyFetch({
    env: { HTTPS_PROXY: 'http://127.0.0.1:1' },
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    proxyFetch('https://platform.example/x', { signal: controller.signal }),
    (error) => error.name === 'AbortError',
  );
});

test('a timeout while waiting for the origin is a TimeoutError, as with global fetch', async () => {
  const server = await startOriginBehindProxy(() => {
    // Never respond.
  });
  try {
    await assert.rejects(
      server.proxyFetch(server.url('/slow'), {
        signal: AbortSignal.timeout(300),
      }),
      (error) => error.name === 'TimeoutError',
    );
  } finally {
    await server.stop();
  }
});

test('the tunnel returns a real Response and accepts a Headers instance', async () => {
  let seenHeader = null;
  const server = await startOriginBehindProxy((req, res) => {
    seenHeader = req.headers['x-probe'];
    res.writeHead(200, {
      'content-type': 'application/json',
      'x-reply': 'yes',
    });
    res.end(JSON.stringify({ pong: true }));
  });
  try {
    const res = await server.proxyFetch(server.url('/ping'), {
      headers: new Headers({ 'x-probe': 'sent' }),
    });
    assert.ok(res instanceof Response);
    assert.equal(res.headers.get('x-reply'), 'yes');
    assert.equal(res.url, server.url('/ping'));
    assert.deepEqual(await res.json(), { pong: true });
    assert.equal(seenHeader, 'sent');
  } finally {
    await server.stop();
  }
});

test('the tunnel handles a response with no body', async () => {
  const server = await startOriginBehindProxy((_req, res) => {
    res.writeHead(204);
    res.end();
  });
  try {
    const res = await server.proxyFetch(server.url('/empty'));
    assert.equal(res.status, 204);
    assert.equal(await res.text(), '');
  } finally {
    await server.stop();
  }
});

test('the tunnel follows redirects and turns a 303 POST into a GET', async () => {
  const seen = [];
  const server = await startOriginBehindProxy((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.url === '/start') {
      res.writeHead(303, { location: '/final' });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ at: req.url }));
  });
  try {
    const res = await server.proxyFetch(server.url('/start'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.deepEqual(await res.json(), { at: '/final' });
    assert.equal(res.redirected, true);
    assert.equal(res.url, server.url('/final'));
    assert.deepEqual(seen, ['POST /start', 'GET /final']);
  } finally {
    await server.stop();
  }
});

test('redirect: manual returns the redirect response unchanged', async () => {
  const server = await startOriginBehindProxy((_req, res) => {
    res.writeHead(302, { location: '/elsewhere' });
    res.end();
  });
  try {
    const res = await server.proxyFetch(server.url('/start'), {
      redirect: 'manual',
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/elsewhere');
  } finally {
    await server.stop();
  }
});

test('an IP target is checked against its own address, not the proxy host', async () => {
  // The cert covers localhost and 127.0.0.1 only. The proxy is reached as
  // localhost but tunnels every CONNECT to the origin, so a request for
  // 10.0.0.1 gets a cert that does not name it and must be refused.
  const origin = https.createServer({ key, cert: ca }, (_req, res) =>
    res.end('ok'),
  );
  const destroyOrigin = trackSockets(origin);
  const originPort = await listen(origin);
  const proxy = http.createServer();
  const destroyProxy = trackSockets(proxy);
  proxy.on('connect', (_req, clientSocket) => {
    const upstream = net.connect(originPort, '127.0.0.1', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
  });
  const proxyPort = await listen(proxy);
  const proxyFetch = createProxyFetch({
    env: { HTTPS_PROXY: `http://localhost:${proxyPort}` },
    ca,
  });
  try {
    await assert.rejects(
      proxyFetch('https://10.0.0.1/', { signal: AbortSignal.timeout(5000) }),
      (error) => error.code === 'ERR_TLS_CERT_ALTNAME_INVALID',
    );
    const ok = await proxyFetch(`https://127.0.0.1:${originPort}/`, {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(await ok.text(), 'ok');
  } finally {
    await close(proxy, destroyProxy);
    await close(origin, destroyOrigin);
  }
});
