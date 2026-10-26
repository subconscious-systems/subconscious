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

import { spawn } from 'node:child_process';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import tls from 'node:tls';
import zlib from 'node:zlib';
import { c } from './colors.js';

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
// module's tunnel, so it is the one recommendation that is safe everywhere.
// Node must be restarted with the variable set: it is read at startup.
export function tlsTrustHint(error) {
  if (!isTlsTrustError(error)) return null;
  return [
    'The connection was re-signed by an untrusted CA — a corporate TLS-inspecting proxy (Zscaler, Netskope, ...).',
    'Ask IT for the proxy root certificate, then restart the CLI with it trusted:',
    '  export NODE_EXTRA_CA_CERTS=/path/to/corporate-root-ca.pem',
  ].join('\n  ');
}

/** Whether this Node build can add the OS certificate store to the trust store. */
function supportsSystemCa() {
  return process.allowedNodeEnvironmentFlags?.has('--use-system-ca') === true;
}

/**
 * Re-exec once with `--use-system-ca` when the OS certificate store is opted
 * in and this Node build supports the flag. Node 18 and 20 reject the flag
 * outright, so it is probed rather than assumed. Node reads the option at
 * startup, which is why this has to happen before any request.
 *
 * Resolves true once the child has exited and its status is mirrored, so the
 * caller must stop. The child re-enters here with the flag already present and
 * resolves false.
 */
export async function ensureSystemCa(options = {}) {
  if (process.execArgv.includes('--use-system-ca')) return false;
  if (!(options.supported ?? supportsSystemCa())) return false;
  const run = options.spawnImpl || spawn;
  try {
    await runMirrored(
      () =>
        run(
          process.execPath,
          ['--use-system-ca', ...process.execArgv, ...process.argv.slice(1)],
          { stdio: 'inherit' },
        ),
      options.interactive,
    );
    return true;
  } catch (error) {
    console.error(
      `${c.red}Could not restart with the OS certificate store: ${error.message}${c.reset}`,
    );
    return false;
  }
}

const FORWARDED_SIGNALS = ['SIGTERM', 'SIGHUP'];

// Run the child, pass SIGTERM/SIGHUP on to it, and mirror its exit code or
// signal. At a terminal, Ctrl-C already reaches the whole process group, so
// forwarding SIGINT would deliver it twice. Without a terminal, a script or
// harness signals this pid alone, so SIGINT is forwarded too.
function runMirrored(start, interactive = process.stdin.isTTY === true) {
  return new Promise((resolve, reject) => {
    const child = start();
    const forward = (signal) => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(signal);
      }
    };
    const onSigint = interactive ? () => {} : forward;
    for (const signal of FORWARDED_SIGNALS) process.on(signal, forward);
    process.on('SIGINT', onSigint);
    const stop = () => {
      for (const signal of FORWARDED_SIGNALS) process.off(signal, forward);
      process.off('SIGINT', onSigint);
    };
    child.on('error', (error) => {
      stop();
      reject(error);
    });
    child.on('exit', (code, signal) => {
      stop();
      if (signal) {
        process.exitCode = 128 + (os.constants.signals[signal] ?? 0);
        process.kill(process.pid, signal);
      } else if (code) {
        process.exitCode = code;
      }
      resolve();
    });
  });
}

/**
 * Fail before any request when SYSTEM_CA=on is set on a Node that cannot
 * honor it. Only network commands call this, so help, config and update-key
 * still work and the user can turn the setting off.
 */
export function refuseUnsupportedSystemCa(systemCaEnabled, profilePath) {
  if (!systemCaEnabled || supportsSystemCa()) return false;
  console.error(
    `${c.red}SYSTEM_CA=on needs Node 22.15 or newer (the --use-system-ca flag); this is ${process.version}.${c.reset}`,
  );
  const where = profilePath ? ` from ${profilePath}` : '';
  console.error(
    `${c.dim}Remove SYSTEM_CA=on${where} with subc config edit, or upgrade Node, then retry.${c.reset}`,
  );
  process.exitCode = 1;
  return true;
}

// One line for a failure that a command can print and keep going. Adds the
// real cause for Node's opaque "fetch failed", and the CA fix when the cause is
// an untrusted issuer (the common corporate-machine failure).
export function describeFailure(error) {
  const message = describeFetchError(error);
  if (error?.name === 'TimeoutError') return message;
  const hint = tlsTrustHint(error);
  return hint
    ? `${message}\n  Ask IT for the proxy root certificate, then restart with NODE_EXTRA_CA_CERTS set, or set SYSTEM_CA=on in your profile.`
    : message;
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

// The reason a signal aborted, as global fetch reports it: a TimeoutError for
// AbortSignal.timeout(), an AbortError for a plain abort().
function abortReason(signal) {
  return (
    signal.reason ??
    new DOMException('This operation was aborted', 'AbortError')
  );
}

// Open a TCP tunnel to `targetHost:targetPort` through the HTTP proxy, then
// upgrade it to TLS for the target host. Resolves to a connected TLSSocket.
// CONNECT establishes a tunnel to an HTTPS origin. It is the only form that
// makes sense here: `createProxyFetch` never tunnels a plain `http:` target
// (see there for why).
//
// `timeoutMs` bounds the whole setup, CONNECT and TLS handshake together.
// `signal` is the caller's: a proxy that answers CONNECT and then forwards
// nothing must not outlive the caller's deadline.
export function connectThroughProxy(
  proxyUrl,
  targetHost,
  targetPort,
  options = {},
) {
  const timeoutMs = options.timeoutMs ?? 8000;
  const signal = options.signal;
  const proxyPort =
    Number(proxyUrl.port) || (proxyUrl.protocol === 'https:' ? 443 : 80);

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }

    // The promise must always settle. A proxy that blocks a destination just
    // closes the socket: with no 'error' event, no response, and no other work
    // left, the event loop empties and the CLI exits 0 having printed nothing.
    let settled = false;
    let tlsSocket = null;
    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
    };
    const fail = (error) => {
      if (settled) return;
      cleanup();
      tlsSocket?.destroy();
      socket.destroy();
      reject(error);
    };
    const succeed = () => {
      if (settled) return;
      cleanup();
      resolve(tlsSocket);
    };
    const onError = (error) => fail(error);
    const onClose = () => {
      const error = new Error(
        'The proxy closed the connection without responding to CONNECT',
      );
      error.code = 'EPROXY';
      fail(error);
    };
    const onAbort = () => fail(abortReason(signal));

    // When the proxy itself is HTTPS, speak TLS to the proxy first.
    const socket =
      proxyUrl.protocol === 'https:'
        ? tls.connect({
            host: proxyUrl.hostname,
            port: proxyPort,
            servername: proxyUrl.hostname,
          })
        : net.connect({ host: proxyUrl.hostname, port: proxyPort });

    const timer = setTimeout(() => {
      const error = new Error('Timed out opening the proxy tunnel');
      error.code = 'ETIMEDOUT';
      fail(error);
    }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    socket.once('error', onError);
    socket.once('close', onClose);

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
        fail(error);
        return;
      }
      const remainder = buffer.slice(headerEnd + 4);
      if (remainder.length > 0)
        socket.unshift(Buffer.from(remainder, 'latin1'));

      tlsSocket = tls.connect({
        socket,
        servername: net.isIP(targetHost) ? undefined : targetHost,
        // Without a servername (IP targets) Node checks the cert against the
        // socket's host, which is the proxy. Check it against the target.
        checkServerIdentity: (_host, cert) =>
          tls.checkServerIdentity(targetHost, cert),
        rejectUnauthorized: options.rejectUnauthorized ?? true,
        ca: options.ca,
      });
      tlsSocket.once('secureConnect', succeed);
      tlsSocket.once('error', (error) => fail(error));
    };
    socket.on('data', onData);
  });
}

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 20;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
// Statuses whose Response must be built with a null body.
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

// A proxy can re-encode the response (some middleboxes gzip application/json
// on the way through). Node's global fetch decompresses transparently; the
// tunnel must do the same, or res.json() silently fails to parse.
function decodeBody(buffer, encoding) {
  const normalized = String(encoding || '')
    .trim()
    .toLowerCase();
  try {
    if (normalized === 'gzip' || normalized === 'x-gzip')
      return zlib.gunzipSync(buffer);
    if (normalized === 'deflate') return zlib.inflateSync(buffer);
    if (normalized === 'br') return zlib.brotliDecompressSync(buffer);
  } catch (error) {
    throw new Error(
      `Could not decode a ${normalized} response body: ${error.message}`,
    );
  }
  return buffer;
}

function readResponseBody(response) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    response.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_RESPONSE_BYTES) {
        response.destroy();
        reject(new Error('Response body was too large'));
        return;
      }
      chunks.push(chunk);
    });
    response.once('end', () => {
      try {
        resolve(
          decodeBody(
            Buffer.concat(chunks),
            response.headers['content-encoding'],
          ),
        );
      } catch (error) {
        reject(error);
      }
    });
    response.once('error', reject);
    response.once('close', () => {
      if (!response.complete) {
        reject(new Error('The connection closed before the response ended'));
      }
    });
  });
}

// Build a real Response, so callers get the same object global fetch returns
// (`headers.get()`, `arrayBuffer()`, `url`, ...) whether or not a proxy is set.
function toResponse(response, body, url, redirected) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      headers.append(name, item);
    }
  }
  // The body is already decoded, so these no longer describe it.
  headers.delete('content-encoding');
  headers.delete('content-length');
  const status = response.statusCode;
  const result = new Response(NULL_BODY_STATUSES.has(status) ? null : body, {
    status,
    statusText: response.statusMessage,
    headers,
  });
  Object.defineProperty(result, 'url', { value: url });
  Object.defineProperty(result, 'redirected', { value: redirected });
  return result;
}

// Send one request through a fresh tunnel and buffer the whole response. The
// tunnel carries exactly one request and closes when it settles: an idle open
// socket would keep the event loop alive and make the CLI hang on exit.
function requestThroughProxy(targetUrl, init, proxyUrl, options) {
  const url = new URL(targetUrl);
  const targetPort = Number(url.port) || 443;
  // URL keeps the brackets on an IPv6 literal; the proxy expects a bare host.
  const targetHost = url.hostname.replace(/^\[|\]$/g, '');
  const signal = init.signal;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    let done = false;
    let tlsSocket = null;
    let request = null;
    const settle = (callback, value) => {
      if (done) return;
      done = true;
      signal?.removeEventListener('abort', onAbort);
      request?.destroy();
      tlsSocket?.destroy();
      callback(value);
    };
    const onAbort = () => settle(reject, abortReason(signal));
    signal?.addEventListener('abort', onAbort, { once: true });

    connectThroughProxy(proxyUrl, targetHost, targetPort, {
      ...options,
      signal,
    }).then(
      (socket) => {
        if (done) {
          socket.destroy();
          return;
        }
        tlsSocket = socket;
        const headers = {
          ...Object.fromEntries(new Headers(init.headers ?? {})),
          host: url.host,
        };
        request = https.request({
          method: init.method || 'GET',
          path: `${url.pathname}${url.search}`,
          headers,
          createConnection: () => socket,
        });
        request.once('error', (error) => settle(reject, error));
        request.once('response', (response) => {
          readResponseBody(response).then(
            (body) =>
              settle(
                resolve,
                toResponse(response, body, targetUrl, options.redirected),
              ),
            (error) => settle(reject, error),
          );
        });
        if (init.body) request.write(init.body);
        request.end();
      },
      (error) => settle(reject, error),
    );
  });
}

// The request to send after a redirect, following the fetch spec: 303 (and
// 301/302 after a POST) becomes a bodiless GET, and credentials do not cross
// to a different origin.
function redirectInit(init, status, fromUrl, toUrl) {
  const method = (init.method || 'GET').toUpperCase();
  const toGet =
    (status === 303 && method !== 'GET' && method !== 'HEAD') ||
    ((status === 301 || status === 302) && method === 'POST');
  const headers = new Headers(init.headers ?? {});
  if (toGet) {
    headers.delete('content-type');
    headers.delete('content-length');
  }
  if (new URL(fromUrl).origin !== new URL(toUrl).origin) {
    headers.delete('authorization');
  }
  return {
    ...init,
    method: toGet ? 'GET' : init.method,
    body: toGet ? undefined : init.body,
    headers: Object.fromEntries(headers),
  };
}

function redirectError(message) {
  return new TypeError('fetch failed', { cause: new Error(message) });
}

// Return a `fetch`-compatible function that routes through the configured proxy
// (from `env`) when one applies to the target URL. Falls back to the provided
// base fetch (global `fetch` by default) otherwise. Redirects are followed per
// hop, so each new URL gets its own proxy and NO_PROXY decision.
//
// Only `https:` targets are tunneled. A CONNECT tunnel would speak TLS to a
// plaintext origin, which breaks the `SUBCONSCIOUS_URL=http://localhost:3000`
// local-development flow. Plain `http:` requests therefore go out directly
// through the base fetch, which does not use the proxy env vars.
export function createProxyFetch(options = {}) {
  const env = options.env || process.env;
  const baseFetch = options.fetchImpl || globalThis.fetch;
  const tunnel = {
    timeoutMs: options.timeoutMs,
    ca: options.ca,
    rejectUnauthorized: options.rejectUnauthorized,
  };
  const proxyFetch = async (url, init = {}, hops = 0) => {
    const target = String(url);
    if (!/^https:/i.test(target)) return baseFetch(url, init);
    const proxy = proxyForUrl(target, env);
    if (!proxy) return baseFetch(url, init);

    const response = await requestThroughProxy(target, init, proxy, {
      ...tunnel,
      redirected: hops > 0,
    });
    const mode = init.redirect ?? 'follow';
    const location = response.headers.get('location');
    if (!REDIRECT_STATUSES.has(response.status) || !location) return response;
    if (mode === 'manual') return response;
    if (mode === 'error') throw redirectError('unexpected redirect');
    if (hops >= MAX_REDIRECTS) throw redirectError('redirect count exceeded');
    const next = new URL(location, target).href;
    return proxyFetch(
      next,
      redirectInit(init, response.status, target, next),
      hops + 1,
    );
  };
  return (url, init) => proxyFetch(url, init);
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

// Failures a proxy setting can explain: the host was never reached.
const CONNECTION_ERROR_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPROXY',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function isConnectionError(error) {
  if (error?.name === 'TimeoutError') return true;
  return collectErrors(error).some((node) =>
    CONNECTION_ERROR_CODES.has(errorCode(node)),
  );
}

function isHttpsUrl(url) {
  try {
    return new URL(String(url)).protocol === 'https:';
  } catch {
    return false;
  }
}

// One line about proxies for a request to `url` that failed with `error`.
// With a proxy configured, name it so the user can check it. Without one,
// suggest setting it: an agent driving subc sees only this output, so the
// failure itself has to say where the fix is documented. Null when a proxy
// cannot explain the failure (an HTTP error, or a TLS trust failure, which
// tlsTrustHint covers).
export function proxyHint(error, url, env = process.env) {
  if (isTlsTrustError(error) || !isConnectionError(error)) return null;
  // Only https requests go through the proxy, so it cannot explain the rest.
  if (!isHttpsUrl(url)) return null;
  const proxy = describeProxy(url, env);
  if (proxy) {
    return `Tried via proxy ${proxy} (from HTTPS_PROXY/NO_PROXY).`;
  }
  return 'If this network needs a proxy, set HTTPS_PROXY=http://host:port and retry. See subc login help.';
}
