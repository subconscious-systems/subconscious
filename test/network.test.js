import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import {
  createProxyFetch,
  describeFetchError,
  describeProxy,
  proxyForUrl,
} from '../bin/network.js';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const ca = fs.readFileSync(path.join(fixtures, 'localhost-cert.pem'));

test('describeFetchError surfaces the cause code and host', () => {
  const error = new TypeError('fetch failed');
  error.cause = Object.assign(
    new Error('getaddrinfo ENOTFOUND platform.subconscious.dev'),
    { code: 'ENOTFOUND' },
  );
  const message = describeFetchError(error);
  assert.match(message, /^fetch failed/);
  assert.match(message, /ENOTFOUND/);
  assert.match(message, /platform\.subconscious\.dev/);
});

test('describeFetchError walks nested cause chains', () => {
  const inner = Object.assign(new Error('socket hang up'), {
    code: 'ECONNRESET',
  });
  const mid = new TypeError('fetch failed', { cause: inner });
  const error = new TypeError('aggregate', { cause: mid });
  const message = describeFetchError(error);
  assert.match(message, /ECONNRESET/);
});

test('describeFetchError collects AggregateError sub-errors', () => {
  const a = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), {
    code: 'ECONNREFUSED',
  });
  const b = Object.assign(new Error('connect ETIMEDOUT'), {
    code: 'ETIMEDOUT',
  });
  const error = new TypeError('fetch failed', {
    cause: new AggregateError([a, b]),
  });
  const message = describeFetchError(error);
  assert.match(message, /ECONNREFUSED/);
  assert.match(message, /ETIMEDOUT/);
});

test('describeFetchError leaves plain errors unchanged', () => {
  assert.equal(describeFetchError(new Error('boom')), 'boom');
  assert.equal(describeFetchError('nope'), 'nope');
});

test('proxyForUrl honors HTTPS_PROXY and lower-case variants', () => {
  assert.equal(
    proxyForUrl('https://platform.subconscious.dev/x', {
      HTTPS_PROXY: 'http://proxy.corp:8080',
    })?.href,
    'http://proxy.corp:8080/',
  );
  assert.equal(
    proxyForUrl('https://platform.subconscious.dev/x', {
      https_proxy: 'http://proxy.corp:8080',
    })?.href,
    'http://proxy.corp:8080/',
  );
});

test('proxyForUrl respects NO_PROXY host and suffix matches', () => {
  const env = {
    HTTPS_PROXY: 'http://proxy.corp:8080',
    NO_PROXY: 'localhost,.subconscious.dev,example.com',
  };
  assert.equal(proxyForUrl('https://platform.subconscious.dev/x', env), null);
  assert.equal(proxyForUrl('https://api.subconscious.dev/x', env), null);
  assert.equal(proxyForUrl('https://example.com/x', env), null);
  assert.equal(proxyForUrl('https://localhost/x', env), null);
  assert.notEqual(proxyForUrl('https://other.test/x', env), null);
});

test('proxyForUrl accepts a wildcard NO_PROXY', () => {
  const env = { HTTPS_PROXY: 'http://proxy.corp:8080', NO_PROXY: '*' };
  assert.equal(proxyForUrl('https://platform.subconscious.dev/x', env), null);
});

test('proxyForUrl ignores malformed and non-http proxy values', () => {
  assert.equal(
    proxyForUrl('https://platform.subconscious.dev/x', {
      HTTPS_PROXY: 'not a url',
    }),
    null,
  );
  assert.equal(
    proxyForUrl('https://platform.subconscious.dev/x', {
      HTTPS_PROXY: 'socks5://proxy.corp:1080',
    }),
    null,
  );
});

test('describeProxy reports the proxy host without credentials', () => {
  const env = { HTTPS_PROXY: 'http://user:pass@proxy.corp:8080' };
  const described = describeProxy('https://platform.subconscious.dev/x', env);
  assert.equal(described, 'http://proxy.corp:8080');
  assert.doesNotMatch(described, /user|pass/);
  assert.equal(
    describeProxy('https://platform.subconscious.dev/x', { NO_PROXY: '*' }),
    null,
  );
});

test('createProxyFetch falls back to the base fetch without a proxy', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ via: 'direct' }) };
  };
  const proxyFetch = createProxyFetch({ env: {}, fetchImpl });
  const res = await proxyFetch('https://platform.example/x', {
    method: 'POST',
  });
  assert.equal(calls.length, 1);
  assert.equal((await res.json()).via, 'direct');
});

test('createProxyFetch tunnels HTTPS through an HTTP proxy via CONNECT', async () => {
  const originSockets = new Set();
  const proxySockets = new Set();
  const origin = https.createServer(
    {
      key: fs.readFileSync(path.join(fixtures, 'localhost-key.pem')),
      cert: ca,
    },
    (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ pong: true }));
    },
  );
  origin.on('connection', (socket) => {
    originSockets.add(socket);
    socket.on('close', () => originSockets.delete(socket));
  });
  await new Promise((resolve) => origin.listen(0, '127.0.0.1', resolve));
  const originPort = origin.address().port;

  const connectTargets = [];
  const proxy = http.createServer();
  proxy.on('connection', (socket) => {
    proxySockets.add(socket);
    socket.on('close', () => proxySockets.delete(socket));
  });
  proxy.on('connect', (req, clientSocket, head) => {
    connectTargets.push(req.url);
    const [host, port] = req.url.split(':');
    const upstream = net.connect(Number(port), host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
  });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const proxyPort = proxy.address().port;

  try {
    const proxyFetch = createProxyFetch({
      env: { HTTPS_PROXY: `http://127.0.0.1:${proxyPort}` },
      ca,
    });
    const res = await proxyFetch(`https://127.0.0.1:${originPort}/ping`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });
    assert.equal(res.ok, true);
    assert.deepEqual(await res.json(), { pong: true });
    assert.equal(connectTargets.length, 1);
    assert.match(
      connectTargets[0],
      new RegExp(`^127\\.0\\.0\\.1:${originPort}$`),
    );
  } finally {
    for (const socket of proxySockets) socket.destroy();
    for (const socket of originSockets) socket.destroy();
    await new Promise((resolve) => proxy.close(resolve));
    await new Promise((resolve) => origin.close(resolve));
  }
});

test('createProxyFetch rejects when the proxy drops the CONNECT', async () => {
  // Some policy appliances accept the TCP connection, read CONNECT, then close
  // without answering. The promise must still reject, or the caller's await
  // never settles and the process exits 0 having printed nothing.
  const dropping = net.createServer((socket) => {
    socket.on('data', () => socket.destroy());
  });
  await new Promise((resolve) => dropping.listen(0, '127.0.0.1', resolve));
  const port = dropping.address().port;
  try {
    const proxyFetch = createProxyFetch({
      env: { HTTPS_PROXY: `http://127.0.0.1:${port}` },
      ca,
      timeoutMs: 3000,
    });
    await assert.rejects(
      proxyFetch('https://platform.example/x'),
      (error) => error.code === 'EPROXY' || error.code === 'ECONNRESET',
    );
  } finally {
    await new Promise((resolve) => dropping.close(resolve));
  }
});

test('createProxyFetch is not used for plain http targets', async () => {
  // Node's global fetch already honors the proxy env vars for http, and a
  // CONNECT tunnel would speak TLS to a plaintext origin. The SUBCONSCIOUS_URL
  // local-development flow (http://localhost:3000) must keep working.
  const calls = [];
  const baseFetch = async (url) => {
    calls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ via: 'base' }) };
  };
  const proxyFetch = createProxyFetch({
    env: { HTTPS_PROXY: 'http://127.0.0.1:1' },
    fetchImpl: baseFetch,
  });
  const res = await proxyFetch('http://localhost:3000/api/cli/whoami');
  assert.deepEqual(await res.json(), { via: 'base' });
  assert.deepEqual(calls, ['http://localhost:3000/api/cli/whoami']);
});

test('createProxyFetch decodes a gzip response body', async () => {
  // A middlebox that terminates TLS can also re-encode the body. Callers use
  // res.json() without reading headers, so the shim must decompress.
  const originSockets = new Set();
  const proxySockets = new Set();
  const origin = https.createServer(
    {
      key: fs.readFileSync(path.join(fixtures, 'localhost-key.pem')),
      cert: ca,
    },
    (_req, res) => {
      const body = zlib.gzipSync(
        Buffer.from(JSON.stringify({ organization: 'Gzip Corp' })),
      );
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-length': body.length,
      });
      res.end(body);
    },
  );
  origin.on('connection', (socket) => {
    originSockets.add(socket);
    socket.on('close', () => originSockets.delete(socket));
  });
  await new Promise((resolve) => origin.listen(0, '127.0.0.1', resolve));
  const originPort = origin.address().port;

  const proxy = http.createServer();
  proxy.on('connection', (socket) => {
    proxySockets.add(socket);
    socket.on('close', () => proxySockets.delete(socket));
  });
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
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const proxyPort = proxy.address().port;

  try {
    const proxyFetch = createProxyFetch({
      env: { HTTPS_PROXY: `http://127.0.0.1:${proxyPort}` },
      ca,
    });
    const res = await proxyFetch(`https://127.0.0.1:${originPort}/gzip`);
    assert.deepEqual(await res.json(), { organization: 'Gzip Corp' });
    assert.equal(res.status, 200);
  } finally {
    for (const socket of proxySockets) socket.destroy();
    for (const socket of originSockets) socket.destroy();
    await new Promise((resolve) => proxy.close(resolve));
    await new Promise((resolve) => origin.close(resolve));
  }
});

// Every outbound request in the CLI must honor the proxy env vars, not just
// login. These assert each module's default fetch is proxy-aware by pointing
// HTTPS_PROXY at a closed port and showing the request fails through it.
test('subc command modules default to the proxy-aware fetch', async () => {
  const { fetchUsage } = await import('../bin/usage.js');
  const { submitFeedback } = await import('../bin/feedback.js');
  const { fetchLatestVersion } = await import('../bin/upgrade.js');

  const saved = { ...process.env };
  process.env.HTTPS_PROXY = 'http://127.0.0.1:1';
  delete process.env.NO_PROXY;
  delete process.env.no_proxy;
  try {
    await assert.rejects(
      fetchUsage('key', 'https://platform.subconscious.dev'),
      (error) =>
        error.code === 'ECONNREFUSED' || /ECONNREFUSED/.test(error.message),
    );
    await assert.rejects(
      submitFeedback('key', 'https://platform.subconscious.dev', {}),
      (error) =>
        error.code === 'ECONNREFUSED' || /ECONNREFUSED/.test(error.message),
    );
    await assert.rejects(
      fetchLatestVersion(),
      (error) =>
        error.code === 'ECONNREFUSED' || /ECONNREFUSED/.test(error.message),
    );
  } finally {
    process.env = saved;
  }
});

test('model discovery routes through the proxy and falls back cleanly', async () => {
  const { resolveModelCatalog } = await import('../bin/models.js');

  const saved = { ...process.env };
  process.env.HTTPS_PROXY = 'http://127.0.0.1:1';
  delete process.env.NO_PROXY;
  delete process.env.no_proxy;
  try {
    const result = await resolveModelCatalog({
      baseUrl: 'https://api.subconscious.dev',
      apiKey: 'key',
      selectedModel: 'subconscious/glm-5.3-marathon',
      fallbackModels: ['subconscious/glm-5.3-marathon'],
    });
    assert.equal(result.source, 'packaged');
    assert.ok(result.error, 'expected the proxy failure to be recorded');
  } finally {
    process.env = saved;
  }
});

test('tlsTrustHint recognizes interception cert errors and suggests a fix', async () => {
  const { isTlsTrustError, tlsTrustHint } = await import('../bin/network.js');
  const error = new TypeError('fetch failed');
  error.cause = Object.assign(new Error('self signed cert'), {
    code: 'SELF_SIGNED_CERT_IN_CHAIN',
  });
  assert.equal(isTlsTrustError(error), true);
  const hint = tlsTrustHint(error);
  assert.match(hint, /NODE_EXTRA_CA_CERTS/);
  // Must not recommend --use-openssl-ca: on a platform without a usable
  // OpenSSL trust store (macOS) it makes working public TLS fail instead.
  assert.doesNotMatch(hint, /--use-openssl-ca/);
});

test('tlsTrustHint is null for non-cert failures', async () => {
  const { isTlsTrustError, tlsTrustHint } = await import('../bin/network.js');
  const error = new TypeError('fetch failed');
  error.cause = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
  assert.equal(isTlsTrustError(error), false);
  assert.equal(tlsTrustHint(error), null);
});
