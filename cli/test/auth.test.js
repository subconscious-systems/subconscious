import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_PLATFORM_URL,
  getPlatformUrl,
  isAllowedCallbackOrigin,
  isLoginMissing,
  probeLoginPage,
} from '../bin/auth.js';

test('callback CORS allows www, platform, and localhost', () => {
  assert.equal(isAllowedCallbackOrigin('https://www.subconscious.dev'), true);
  assert.equal(isAllowedCallbackOrigin('https://platform.subconscious.dev'), true);
  assert.equal(isAllowedCallbackOrigin('https://dev.subconscious.dev'), true);
  assert.equal(isAllowedCallbackOrigin('https://platform-dev.subconscious.dev'), true);
  assert.equal(isAllowedCallbackOrigin('http://localhost:3847'), true);
  assert.equal(isAllowedCallbackOrigin('http://127.0.0.1:3847'), true);
});

test('callback CORS allows SUBCONSCIOUS_URL override and rejects others', () => {
  assert.equal(
    isAllowedCallbackOrigin('http://localhost:3000', 'http://localhost:3000'),
    true,
  );
  assert.equal(isAllowedCallbackOrigin('https://evil.example'), false);
  assert.equal(isAllowedCallbackOrigin(''), false);
});

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

test('login 404 is treated as a missing auth page', () => {
  assert.equal(isLoginMissing(404), true);
  assert.equal(isLoginMissing(200), false);
  assert.equal(isLoginMissing(307), false);
  assert.equal(isLoginMissing(null), false);
});

test('probeLoginPage returns the status and treats network errors as unreachable', async () => {
  const status = await probeLoginPage('https://platform.subconscious.dev', async (url, init) => {
    assert.equal(url, 'https://platform.subconscious.dev/cli/auth');
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'manual');
    return { status: 404 };
  });
  assert.equal(status, 404);

  const unreachable = await probeLoginPage('https://platform.subconscious.dev', async () => {
    throw new Error('offline');
  });
  assert.equal(unreachable, null);
});
