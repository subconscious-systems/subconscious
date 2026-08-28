import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FALLBACK_MODELS,
  fetchGatewayModels,
  modelsEndpoint,
  parseModelsResponse,
  resolveGatewayModels,
} from '../bin/models.js';

test('models endpoint is derived from gateway origins and OpenAI API URLs', () => {
  assert.equal(
    modelsEndpoint('https://api.subconscious.dev'),
    'https://api.subconscious.dev/v1/models',
  );
  assert.equal(
    modelsEndpoint('http://localhost:8080/v1/chat/completions'),
    'http://localhost:8080/v1/models',
  );
});

test('model responses are validated, normalized, and deduplicated', () => {
  assert.deepEqual(
    parseModelsResponse({
      object: 'list',
      data: [{ id: 'subconscious/a' }, { id: ' subconscious/b ' }, { id: 'subconscious/a' }],
    }),
    ['subconscious/a', 'subconscious/b'],
  );
  assert.throws(() => parseModelsResponse({ data: [] }), /empty model catalog/);
  assert.throws(() => parseModelsResponse({ models: [] }), /invalid model catalog/);
});

test('gateway discovery is anonymous and returns live model ids', async () => {
  let request;
  const models = await fetchGatewayModels('https://gateway.example/v1', {
    fetchImpl: async (url, init) => {
      request = { url, init };
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'subconscious/new-model' }] }),
      };
    },
  });

  assert.deepEqual(models, ['subconscious/new-model']);
  assert.equal(request.url, 'https://gateway.example/v1/models');
  assert.deepEqual(request.init.headers, { accept: 'application/json' });
  assert.equal('authorization' in request.init.headers, false);
});

test('runtime discovery falls back safely when the gateway is unavailable', async () => {
  const result = await resolveGatewayModels('https://gateway.example', {
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });

  assert.equal(result.source, 'fallback');
  assert.deepEqual(result.models, [...FALLBACK_MODELS]);
  assert.match(result.error.message, /offline/);
});
