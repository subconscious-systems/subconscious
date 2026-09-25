import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_PLATFORM_URL, getPlatformUrl } from '../bin/auth.js';

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
