import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import {
  DEFAULT_PLATFORM_URL,
  getPlatformUrl,
  whoamiCommand,
} from '../bin/auth.js';

test('default login URL is platform.subconscious.dev', () => {
  const prev = process.env.SUBCONSCIOUS_URL;
  delete process.env.SUBCONSCIOUS_URL;
  try {
    assert.equal(DEFAULT_PLATFORM_URL, 'https://platform.subconscious.dev');
    assert.equal(getPlatformUrl(), 'https://platform.subconscious.dev');
  } finally {
    if (prev === undefined) delete process.env.SUBCONSCIOUS_URL;
    else process.env.SUBCONSCIOUS_URL = prev;
  }
});

test('getPlatformUrl honors SUBCONSCIOUS_URL and strips a trailing slash', () => {
  const prev = process.env.SUBCONSCIOUS_URL;
  process.env.SUBCONSCIOUS_URL = 'https://platform-dev.subconscious.dev/';
  try {
    assert.equal(getPlatformUrl(), 'https://platform-dev.subconscious.dev');
  } finally {
    if (prev === undefined) delete process.env.SUBCONSCIOUS_URL;
    else process.env.SUBCONSCIOUS_URL = prev;
  }
});

test('getPlatformUrl prefers env over profile PLATFORM_URL', () => {
  const prev = process.env.SUBCONSCIOUS_URL;
  process.env.SUBCONSCIOUS_URL = 'https://env.example';
  try {
    assert.equal(
      getPlatformUrl({ values: { PLATFORM_URL: 'https://profile.example' } }),
      'https://env.example',
    );
  } finally {
    if (prev === undefined) delete process.env.SUBCONSCIOUS_URL;
    else process.env.SUBCONSCIOUS_URL = prev;
  }
});

test('getPlatformUrl falls back to profile PLATFORM_URL then default', () => {
  const prev = process.env.SUBCONSCIOUS_URL;
  delete process.env.SUBCONSCIOUS_URL;
  try {
    assert.equal(
      getPlatformUrl({ values: { PLATFORM_URL: 'https://profile.example/' } }),
      'https://profile.example',
    );
    assert.equal(getPlatformUrl({ values: {} }), DEFAULT_PLATFORM_URL);
  } finally {
    if (prev === undefined) delete process.env.SUBCONSCIOUS_URL;
    else process.env.SUBCONSCIOUS_URL = prev;
  }
});

async function whoamiOutput(t, status) {
  const server = http.createServer((_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end('{}');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const prev = process.env.SUBCONSCIOUS_URL;
  delete process.env.SUBCONSCIOUS_URL;
  const lines = [];
  const orig = console.log;
  console.log = (msg = '') => lines.push(String(msg));
  try {
    await whoamiCommand([], {
      profile: {
        name: 'default',
        path: '/profiles/default.env',
        values: {
          API_KEY: 'sk-test-whoami-key',
          PLATFORM_URL: `http://127.0.0.1:${server.address().port}`,
        },
      },
    });
  } finally {
    console.log = orig;
    if (prev === undefined) delete process.env.SUBCONSCIOUS_URL;
    else process.env.SUBCONSCIOUS_URL = prev;
  }
  return lines.join('\n');
}

test('whoami does not call the key invalid when the platform fails', async (t) => {
  for (const status of [429, 503]) {
    const output = await whoamiOutput(t, status);
    assert.match(output, /Could not verify the key/);
    assert.match(output, new RegExp(`HTTP ${status}`));
    assert.doesNotMatch(output, /invalid or revoked/);
    assert.doesNotMatch(output, /logout/);
  }
});

test('whoami reports a 401 as an invalid or revoked key', async (t) => {
  const output = await whoamiOutput(t, 401);
  assert.match(output, /Key is invalid or revoked/);
  assert.match(output, /subc logout then subc login/);
});
