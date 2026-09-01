import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fetchGatewayModels,
  normalizeModelIds,
  resolveModelCatalog,
} from '../bin/models.js';

test('normalizeModelIds reorders a present selected model and removes invalid duplicates', () => {
  assert.deepEqual(
    normalizeModelIds(
      ['subconscious/two', 'subconscious/one', 'bad model', '', 'subconscious/two'],
      'subconscious/one',
    ),
    ['subconscious/one', 'subconscious/two'],
  );
});

test('normalizeModelIds does not invent a selected model absent from the live catalog', () => {
  assert.deepEqual(
    normalizeModelIds(['subconscious/live'], 'subconscious/removed'),
    ['subconscious/live'],
  );
});

test('fetchGatewayModels reads IDs from the authenticated OpenAI-compatible endpoint', async () => {
  let request;
  const models = await fetchGatewayModels({
    baseUrl: 'https://gateway.example/',
    apiKey: 'sk-test',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({
          object: 'list',
          data: [
            { id: 'subconscious/one', object: 'model' },
            { id: 'subconscious/two', object: 'model', supports_tools: true },
          ],
        }),
      };
    },
  });

  assert.deepEqual(models, ['subconscious/one', 'subconscious/two']);
  assert.equal(request.url, 'https://gateway.example/v1/models');
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.headers.Authorization, 'Bearer sk-test');
  assert.equal(request.options.headers['Cache-Control'], 'no-cache, no-store');
  assert.equal(request.options.cache, 'no-store');
  assert.ok(request.options.signal instanceof AbortSignal);
});

test('resolveModelCatalog falls back and still prepends an explicitly selected model', async () => {
  const result = await resolveModelCatalog({
    baseUrl: 'https://gateway.example',
    apiKey: 'sk-test',
    selectedModel: 'subconscious/custom',
    fallbackModels: ['subconscious/default', 'subconscious/backup'],
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });

  assert.equal(result.source, 'packaged');
  assert.match(result.error.message, /HTTP 503/);
  assert.deepEqual(result.models, [
    'subconscious/custom',
    'subconscious/default',
    'subconscious/backup',
  ]);
});

test('resolveModelCatalog uses live models and preserves the selected model first', async () => {
  const result = await resolveModelCatalog({
    baseUrl: 'https://gateway.example',
    apiKey: 'sk-test',
    selectedModel: 'subconscious/two',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        data: [{ id: 'subconscious/one' }, { id: 'subconscious/two' }],
      }),
    }),
  });

  assert.equal(result.source, 'gateway');
  assert.equal(result.error, null);
  assert.deepEqual(result.models, ['subconscious/two', 'subconscious/one']);
});

test('resolveModelCatalog treats a successful live catalog as authoritative', async () => {
  const result = await resolveModelCatalog({
    baseUrl: 'https://gateway.example',
    apiKey: 'sk-test',
    selectedModel: 'subconscious/removed',
    fallbackModels: ['subconscious/removed'],
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 'subconscious/live' }] }),
    }),
  });

  assert.equal(result.source, 'gateway');
  assert.deepEqual(result.models, ['subconscious/live']);
});
