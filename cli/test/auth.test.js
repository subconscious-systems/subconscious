import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAllowedCallbackOrigin } from '../bin/auth.js';

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
