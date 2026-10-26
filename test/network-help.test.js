// An agent driving `subc` learns about proxies only from what the CLI prints:
// the failure message and the help pages. These tests pin that guidance.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { proxyHint } from '../bin/network.js';

const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const TARGET = 'https://platform.subconscious.dev/api/cli/device/register';

function networkError(code) {
  const error = new TypeError('fetch failed');
  error.cause = Object.assign(new Error(`connect ${code}`), { code });
  return error;
}

function runCli(args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subc-help-'));
  try {
    const env = { ...process.env, SUBC_CONFIG_DIR: dir, NO_COLOR: '1' };
    delete env.HTTPS_PROXY;
    delete env.https_proxy;
    const result = spawnSync(process.execPath, [cli, ...args], {
      env,
      encoding: 'utf8',
    });
    return `${result.stdout}${result.stderr}`;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('proxyHint suggests HTTPS_PROXY for a connection failure with no proxy set', () => {
  for (const code of ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN']) {
    const hint = proxyHint(networkError(code), TARGET, {});
    assert.match(hint, /HTTPS_PROXY=http:\/\/host:port/, code);
    assert.match(hint, /subc login help/, code);
  }
});

test('proxyHint suggests HTTPS_PROXY for a timeout with no proxy set', () => {
  const timeout = new DOMException('timed out', 'TimeoutError');
  assert.match(proxyHint(timeout, TARGET, {}), /HTTPS_PROXY/);
});

test('proxyHint names the proxy in use instead of suggesting one', () => {
  const env = { HTTPS_PROXY: 'http://user:secret@proxy.corp:8080' };
  const hint = proxyHint(networkError('ECONNREFUSED'), TARGET, env);
  assert.match(hint, /Tried via proxy http:\/\/proxy\.corp:8080/);
  assert.doesNotMatch(hint, /secret/);
  assert.doesNotMatch(hint, /set HTTPS_PROXY/);
});

test('proxyHint stays quiet for errors a proxy cannot fix', () => {
  assert.equal(proxyHint(new Error('HTTP 500'), TARGET, {}), null);
  const tlsError = new TypeError('fetch failed');
  tlsError.cause = Object.assign(new Error('self-signed'), {
    code: 'SELF_SIGNED_CERT_IN_CHAIN',
  });
  assert.equal(proxyHint(tlsError, TARGET, {}), null);
});

test('subc login help explains proxies, CA certificates and the offline fallback', () => {
  const output = runCli(['login', 'help']);
  for (const expected of [
    /HTTPS_PROXY/,
    /NO_PROXY/,
    /NODE_EXTRA_CA_CERTS/,
    /SYSTEM_CA=on/,
    /subc update-key/,
  ]) {
    assert.match(output, expected);
  }
});

test('subc --help points to the proxy guidance', () => {
  const output = runCli(['--help']);
  assert.match(output, /proxy/i);
  assert.match(output, /subc login help/);
});
