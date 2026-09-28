#!/usr/bin/env node
// Local proxy between Codex and the Subconscious gateway that keeps each
// request at the newest MAX_IMAGES screenshots.
//
// Codex has no plugin hooks and resends its whole history, every screenshot
// included, on every turn, so a long session's upload grows until the gateway
// refuses it. subc starts this proxy next to Codex and points Codex at it. Each
// request body is rewritten before it leaves the machine: past the newest
// MAX_IMAGES, an image becomes the text the gateway's own window leaves in its
// place, so the gateway receives exactly what its window would have produced
// and Subconscious Cache still reuses the rest.
//
// The body is edited as raw bytes, never parsed: Codex requests reach hundreds
// of MB, past what a JavaScript string can hold. Anything that is not the shape
// we know is forwarded unchanged, so a problem here never breaks a session.
//
// Usage: node image-proxy.js --upstream <gateway url> [--parent-pid <pid>]
// Prints {"url": "http://127.0.0.1:<port>"} once listening.

import http from 'node:http';
import https from 'node:https';
import { pathToFileURL } from 'node:url';

export const MAX_IMAGES = 100;
const IMAGE_URL = Buffer.from('"image_url":"data:');
const IMAGE_TYPE = Buffer.from('"type":"input_image"');
const LABEL = Buffer.from('{"type":"input_text","text":"image"}');
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const QUOTE = 0x22;

/** Byte ranges of each `{"type":"input_image",...,"image_url":"data:..."}`, or null if unsure. */
function imageObjects(body) {
  const spans = [];
  let at = body.indexOf(IMAGE_URL);
  while (at !== -1) {
    const start = body.lastIndexOf(OPEN_BRACE, at);
    const urlEnd = body.indexOf(QUOTE, at + IMAGE_URL.length);
    const end = urlEnd === -1 ? -1 : body.indexOf(CLOSE_BRACE, urlEnd);
    if (start === -1 || end === -1) return null;
    const tail = body.subarray(urlEnd, end);
    // Only simple fields (like "detail") may follow the URL; anything nested
    // means this is not the object we think it is.
    if (tail.includes(OPEN_BRACE) || tail.includes(OPEN_BRACKET)) return null;
    if (body.subarray(start, at).includes(IMAGE_TYPE))
      spans.push([start, end + 1]);
    at = body.indexOf(IMAGE_URL, end + 1);
  }
  return spans;
}

/** Returns the body with its oldest images past `max` replaced, or the same body. */
export function windowResponsesBody(body, max = MAX_IMAGES) {
  if (body[0] !== OPEN_BRACE) return body;
  const spans = imageObjects(body);
  if (!spans || spans.length <= max) return body;
  const pieces = [];
  let from = 0;
  for (const [start, end] of spans.slice(0, spans.length - max)) {
    pieces.push(body.subarray(from, start), LABEL);
    from = end;
  }
  pieces.push(body.subarray(from));
  return Buffer.concat(pieces);
}

function forward(client, target, req, res, body) {
  const headers = { ...req.headers, host: target.host };
  if (body) {
    delete headers['transfer-encoding'];
    headers['content-length'] = String(body.length);
  }
  const upstream = client.request(
    target,
    { method: req.method, headers },
    (reply) => {
      res.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.pipe(res);
    },
  );
  upstream.on('error', (error) => {
    if (!res.headersSent)
      res.writeHead(502, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        error: { message: `subc image proxy: ${error.message}` },
      }),
    );
  });
  // Codex gave up (Ctrl-C, timeout): stop the upstream request too.
  res.on('close', () => {
    if (!res.writableFinished) upstream.destroy();
  });
  if (body) upstream.end(body);
  else req.pipe(upstream);
}

/** Starts the proxy on 127.0.0.1; resolves to { url, close }. */
export function startImageProxy({ upstream, port = 0, max = MAX_IMAGES }) {
  const base = new URL(upstream);
  const client = base.protocol === 'https:' ? https : http;
  const server = http.createServer((req, res) => {
    const target = new URL(req.url ?? '/', base);
    if (req.method === 'GET' || req.method === 'HEAD') {
      forward(client, target, req, res);
      return;
    }
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const encoded = req.headers['content-encoding'];
      forward(
        client,
        target,
        req,
        res,
        encoded ? body : windowResponsesBody(body, max),
      );
    });
  });
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const upstream = argument('--upstream');
  if (!upstream) {
    process.stderr.write('usage: image-proxy.js --upstream <url>\n');
    process.exit(2);
  }
  const proxy = await startImageProxy({ upstream });
  process.stdout.write(`${JSON.stringify({ url: proxy.url })}\n`);
  // Exit with the launcher so a crashed session never leaves a proxy behind.
  const parent = Number(argument('--parent-pid'));
  if (parent)
    setInterval(() => {
      try {
        process.kill(parent, 0);
      } catch {
        process.exit(0);
      }
    }, 2000).unref();
}
