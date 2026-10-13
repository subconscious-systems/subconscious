// Network helpers shared by the CLI.
//
// Two problems this module solves:
//
//   1. Node's built-in `fetch()` (undici) reports any connection-level failure
//      as the bare string "fetch failed". The real reason lives on
//      `error.cause` (`ENOTFOUND`, `ECONNREFUSED`, `ETIMEDOUT`,
//      `CERT_HAS_EXPIRED`, ...). Users hit "subc login -> fetch failed" with no
//      way to tell a DNS problem from a proxy problem, so `describeFetchError`
//      walks the cause chain and surfaces the codes and host.
//
//   2. Node's `fetch()` ignores the conventional proxy environment variables
//      (`HTTPS_PROXY`, `NO_PROXY`, ...). Corporate networks route egress
//      through a proxy, so without honoring them `subc login` fails with no
//      recourse. `createProxyFetch` returns a `fetch`-compatible function that
//      tunnels HTTPS through an HTTP proxy via CONNECT when one is configured.
//
// The CLI ships with zero runtime dependencies, so the proxy tunnel is built on
// Node's `node:net`/`node:tls`/`node:https` rather than pulling in `undici`.

import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

const PROXY_PROTOCOLS = new Set(['http:', 'https:']);

function errorCode(error) {
  if (!error || typeof error !== 'object') return null;
  if (typeof error.code === 'string' && error.code) return error.code;
  if (typeof error.errno === 'string' && error.errno) return error.errno;
  return null;
}

function collectErrors(error) {
  const seen = new Set();
  const out = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    out.push(node);
    // AggregateError (e.g. happy-eyeballs) carries its failures on `errors`.
    if (Array.isArray(node.errors)) {
      for (const child of node.errors) visit(child);
    }
    if (node.cause && typeof node.cause === 'object') visit(node.cause);
  };
  visit(error);
  return out;
}

export function describeFetchError(error) {
  if (!error) return 'unknown network error';
  const base =
    error instanceof Error && error.message ? error.message : String(error);
  const parts = [];
  for (const node of collectErrors(error)) {
    const code = errorCode(node);
    const detail =
      node instanceof Error && node.message && node.message !== base
        ? node.message
        : null;
    if (code && !parts.some((p) => p.code === code)) {
      parts.push({ code, detail });
    } else if (detail && !parts.some((p) => p.detail === detail)) {
      parts.push({ code: null, detail });
    }
  }
  if (parts.length === 0) return base;
  const rendered = parts
    .map(({ code, detail }) => {
      if (code && detail && detail !== code) return `${code}: ${detail}`;
      return code || detail;
    })
    .join('; ');
  return `${base} (${rendered})`;
}

// TLS failures whose cause is an untrusted issuing CA, typically a corporate
// middlebox (Zscaler, Netskope, ...) that re-signs traffic with its own root.
// Node does not trust that root unless it is added to the trust store.
const TLS_TRUST_ERROR_CODES = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_UNTRUSTED',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

export function isTlsTrustError(error) {
  return collectErrors(error).some((node) =>
    TLS_TRUST_ERROR_CODES.has(errorCode(node)),
  );
}

// Actionable guidance for the TLS-interception case. `NODE_EXTRA_CA_CERTS`
// *adds* to Node's built-in roots and is honored by both global fetch and this
// module's tunnel; the OS trust store path needs --use-openssl-ca.
export function tlsTrustHint(error) {
  if (!isTlsTrustError(error)) return null;
  return [
    'The connection was re-signed by an untrusted CA — a corporate TLS-inspecting proxy (Zscaler, Netskope, ...).',
    'Trust its root certificate by pointing Node at the .pem file:',
    '  export NODE_EXTRA_CA_CERTS=/path/to/corporate-root-ca.pem',
    'Or install that root in the OS trust store and run Node with --use-openssl-ca.',
  ].join('\n  ');
}

// Parse a proxy URL from an environment variable. Returns null when unset or
// malformed so a bad value never masks the real connection error.
function parseProxyUrl(value) {
  if (!value || typeof value !== 'string') return null;
  let url;
  try {
    url = new URL(value.includes('://') ? value : `http://${value}`);
  } catch {
    return null;
  }
  if (!PROXY_PROTOCOLS.has(url.protocol)) return null;
  return url;
}

// Match a hostname against a single NO_PROXY entry. Supports "*", a bare
// hostname, a ".suffix" domain match, and an optional ":port" suffix.
function hostMatchesNoProxy(hostname, entry) {
  const trimmed = entry.trim().toLowerCase();
  if (!trimmed) return false;
  if (trimmed === '*') return true;

  const colon = trimmed.lastIndexOf(':');
  let host = trimmed;
  if (colon !== -1 && trimmed.indexOf(']') === -1) {
    // Keep IPv6 literals intact; only treat a trailing ":port" as a port.
    host = trimmed.slice(0, colon);
  }
  host = host.replace(/^\./, '');
  return hostname === host || hostname.endsWith(`.${host}`);
}

export function proxyForUrl(targetUrl, env = process.env) {
  let url;
  try {
    url = new URL(targetUrl);
  } catch {
    return null;
  }
  const hostname = url.hostname.toLowerCase();

  const noProxy = env.NO_PROXY || env.no_proxy;
  if (noProxy) {
    for (const entry of noProxy.split(',')) {
      if (hostMatchesNoProxy(hostname, entry)) return null;
    }
  }

  const candidate =
    url.protocol === 'https:'
      ? env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy
      : env.HTTP_PROXY || env.http_proxy;
  return parseProxyUrl(candidate);
}

function proxyAuthorizationHeader(proxyUrl) {
  const user = decodeURIComponent(proxyUrl.username || '');
  const pass = decodeURIComponent(proxyUrl.password || '');
  if (user || pass) {
    const token = Buffer.from(`${user}:${pass}`).toString('base64');
    return `Basic ${token}`;
  }
  return null;
}

// Open a TCP tunnel to `targetHost:targetPort` through the HTTP proxy, then
// upgrade it to TLS for the target host. Resolves to a connected TLSSocket.
export function connectThroughProxy(
  proxyUrl,
  targetHost,
  targetPort,
  options = {},
) {
  const timeoutMs = options.timeoutMs ?? 8000;
  const proxyPort =
    Number(proxyUrl.port) || (proxyUrl.protocol === 'https:' ? 443 : 80);

  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    // When the proxy itself is HTTPS, speak TLS to the proxy first.
    const socket =
      proxyUrl.protocol === 'https:'
        ? tls.connect({
            host: proxyUrl.hostname,
            port: proxyPort,
            servername: proxyUrl.hostname,
          })
        : net.connect({ host: proxyUrl.hostname, port: proxyPort });

    socket.setTimeout(timeoutMs);
    socket.once('error', onError);
    socket.once('timeout', () => {
      const error = new Error('Proxy CONNECT timed out');
      error.code = 'ETIMEDOUT';
      socket.destroy();
      reject(error);
    });

    const sendConnect = () => {
      const auth = proxyAuthorizationHeader(proxyUrl);
      const lines = [
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1`,
        `Host: ${targetHost}:${targetPort}`,
      ];
      if (auth) lines.push(`Proxy-Authorization: ${auth}`);
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    };

    if (proxyUrl.protocol === 'https:') {
      socket.once('secureConnect', sendConnect);
    } else {
      socket.once('connect', sendConnect);
    }

    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString('latin1');
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      socket.removeListener('data', onData);
      const statusLine = buffer.slice(0, headerEnd).split('\r\n')[0];
      const match = /^HTTP\/\d\.\d\s+(\d{3})/.exec(statusLine);
      const status = match ? Number(match[1]) : 0;
      if (status !== 200) {
        const error = new Error(
          `Proxy CONNECT failed (${status || 'no response'})`,
        );
        error.code = 'EPROXY';
        socket.destroy();
        reject(error);
        return;
      }
      const remainder = buffer.slice(headerEnd + 4);
      socket.setTimeout(0);
      socket.removeListener('error', onError);
      if (remainder.length > 0)
        socket.unshift(Buffer.from(remainder, 'latin1'));

      const tlsSocket = tls.connect({
        socket,
        servername: net.isIP(targetHost) ? undefined : targetHost,
        rejectUnauthorized: options.rejectUnauthorized ?? true,
        ca: options.ca,
      });
      tlsSocket.once('secureConnect', () => resolve(tlsSocket));
      tlsSocket.once('error', reject);
    };
    socket.on('data', onData);
  });
}

function requestThroughProxy(targetUrl, init, proxyUrl, env, options = {}) {
  const url = new URL(targetUrl);
  const targetPort = Number(url.port) || 443;
  const targetHost = url.hostname;

  return new Promise((resolve, reject) => {
    connectThroughProxy(proxyUrl, targetHost, targetPort, { env, ...options })
      .then((tlsSocket) => {
        const headers = { ...(init.headers || {}) };
        headers.Host = url.host;
        const request = https.request({
          method: init.method || 'GET',
          path: `${url.pathname}${url.search}`,
          headers,
          createConnection: () => tlsSocket,
          signal: init.signal,
        });
        request.once('error', reject);
        request.once('response', (response) => {
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            json: () =>
              new Promise((res, rej) => {
                let body = '';
                response.setEncoding('utf8');
                response.on('data', (chunk) => {
                  body += chunk;
                });
                response.on('end', () => {
                  try {
                    res(JSON.parse(body));
                  } catch (error) {
                    rej(error);
                  }
                });
                response.on('error', rej);
              }),
          });
        });
        if (init.body) request.write(init.body);
        request.end();
      })
      .catch(reject);
  });
}

// Return a `fetch`-compatible function that routes through the configured proxy
// (from `env`) when one applies to the target URL. Falls back to the provided
// base fetch (global `fetch` by default) otherwise.
export function createProxyFetch(options = {}) {
  const env = options.env || process.env;
  const baseFetch = options.fetchImpl || globalThis.fetch;
  const tunnel = {
    timeoutMs: options.timeoutMs,
    ca: options.ca,
    rejectUnauthorized: options.rejectUnauthorized,
  };
  return (url, init = {}) => {
    const proxy = proxyForUrl(url, env);
    if (!proxy) return baseFetch(url, init);
    return requestThroughProxy(String(url), init, proxy, env, tunnel);
  };
}

// A process-wide proxy-aware `fetch`. Callers across the CLI use this as the
// default so every outbound request honors HTTPS_PROXY/NO_PROXY, not just
// login. Tests inject their own `fetchImpl` where they need to stub the wire.
export function proxyAwareFetch(url, init) {
  return createProxyFetch()(url, init);
}

// A single env var can carry the whole proxy setup for a command; expose the
// detection so callers can tell the user when their request is being proxied.
// Credentials are intentionally omitted so they never reach logs or terminals.
export function describeProxy(url, env = process.env) {
  const proxy = proxyForUrl(url, env);
  if (!proxy) return null;
  return `${proxy.protocol}//${proxy.host}`;
}
