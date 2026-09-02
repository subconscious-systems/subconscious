import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AVAILABLE_MODELS_PATH,
  fetchGatewayModels,
  isLiveModelSource,
  normalizeModelIds,
  PUBLIC_MODELS_PATH,
  resolveModelCatalog,
} from '../bin/models.js';

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

function catalogResponse(ids) {
  return jsonResponse({
    object: 'list',
    data: ids.map((id) => ({ id, object: 'model' })),
  });
}

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

test('isLiveModelSource treats available and public catalogs as live', () => {
  assert.equal(isLiveModelSource('available'), true);
  assert.equal(isLiveModelSource('public'), true);
  assert.equal(isLiveModelSource('packaged'), false);
  assert.equal(isLiveModelSource('gateway'), false);
});

test('fetchGatewayModels reads IDs from the provisioned endpoint when a key is supplied', async () => {
  let request;
  const models = await fetchGatewayModels({
    baseUrl: 'https://gateway.example/',
    apiKey: 'sk-test',
    path: AVAILABLE_MODELS_PATH,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return catalogResponse(['subconscious/one', 'subconscious/two']);
    },
  });

  assert.deepEqual(models, ['subconscious/one', 'subconscious/two']);
  assert.equal(request.url, 'https://gateway.example/v1/models/available');
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.headers.Authorization, 'Bearer sk-test');
  assert.equal(request.options.headers['Cache-Control'], 'no-cache, no-store');
  assert.equal(request.options.cache, 'no-store');
  assert.ok(request.options.signal instanceof AbortSignal);
});

test('fetchGatewayModels omits Authorization on the public catalog', async () => {
  let request;
  const models = await fetchGatewayModels({
    baseUrl: 'https://gateway.example/',
    path: PUBLIC_MODELS_PATH,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return catalogResponse(['subconscious/public']);
    },
  });

  assert.deepEqual(models, ['subconscious/public']);
  assert.equal(request.url, 'https://gateway.example/v1/models');
  assert.equal(request.options.headers.Authorization, undefined);
});

test('resolveModelCatalog uses provisioned models and preserves the selected model first', async () => {
  const urls = [];
  const result = await resolveModelCatalog({
    baseUrl: 'https://gateway.example',
    apiKey: 'sk-test',
    selectedModel: 'subconscious/two',
    fetchImpl: async (url) => {
      urls.push(url);
      return catalogResponse(['subconscious/one', 'subconscious/two']);
    },
  });

  assert.equal(result.source, 'available');
  assert.equal(result.error, null);
  assert.deepEqual(result.models, ['subconscious/two', 'subconscious/one']);
  assert.deepEqual(urls, ['https://gateway.example/v1/models/available']);
});

test('resolveModelCatalog treats a successful provisioned catalog as authoritative', async () => {
  const result = await resolveModelCatalog({
    baseUrl: 'https://gateway.example',
    apiKey: 'sk-test',
    selectedModel: 'subconscious/removed',
    fallbackModels: ['subconscious/removed'],
    fetchImpl: async () => catalogResponse(['subconscious/live']),
  });

  assert.equal(result.source, 'available');
  assert.deepEqual(result.models, ['subconscious/live']);
});

test('resolveModelCatalog treats an empty provisioned list as authoritative', async () => {
  const urls = [];
  const result = await resolveModelCatalog({
    baseUrl: 'https://gateway.example',
    apiKey: 'sk-test',
    selectedModel: 'subconscious/custom',
    fallbackModels: ['subconscious/default'],
    fetchImpl: async (url) => {
      urls.push(url);
      return catalogResponse([]);
    },
  });

  assert.equal(result.source, 'available');
  assert.equal(result.error, null);
  assert.deepEqual(result.models, []);
  assert.deepEqual(urls, ['https://gateway.example/v1/models/available']);
});

test('resolveModelCatalog falls back to the public catalog without auth when /available fails', async () => {
  const requests = [];
  const result = await resolveModelCatalog({
    baseUrl: 'https://gateway.example',
    apiKey: 'sk-test',
    selectedModel: 'subconscious/two',
    fallbackModels: ['subconscious/default'],
    fetchImpl: async (url, options) => {
      requests.push({ url, authorization: options.headers.Authorization });
      if (url.endsWith(AVAILABLE_MODELS_PATH)) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      return catalogResponse(['subconscious/one', 'subconscious/two']);
    },
  });

  assert.equal(result.source, 'public');
  assert.equal(result.error, null);
  assert.deepEqual(result.models, ['subconscious/two', 'subconscious/one']);
  assert.deepEqual(requests, [
    { url: 'https://gateway.example/v1/models/available', authorization: 'Bearer sk-test' },
    { url: 'https://gateway.example/v1/models', authorization: undefined },
  ]);
});

test('resolveModelCatalog skips /available and uses the public catalog when no key is present', async () => {
  const requests = [];
  const result = await resolveModelCatalog({
    baseUrl: 'https://gateway.example',
    selectedModel: 'subconscious/one',
    fallbackModels: ['subconscious/default'],
    fetchImpl: async (url, options) => {
      requests.push({ url, authorization: options.headers.Authorization });
      return catalogResponse(['subconscious/one', 'subconscious/two']);
    },
  });

  assert.equal(result.source, 'public');
  assert.equal(result.error, null);
  assert.deepEqual(result.models, ['subconscious/one', 'subconscious/two']);
  assert.deepEqual(requests, [
    { url: 'https://gateway.example/v1/models', authorization: undefined },
  ]);
});

test('resolveModelCatalog falls back to packaged models when both live endpoints fail', async () => {
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

test('resolveModelCatalog treats an empty public catalog as a packaged fallback', async () => {
  const result = await resolveModelCatalog({
    baseUrl: 'https://gateway.example',
    selectedModel: 'subconscious/custom',
    fallbackModels: ['subconscious/default'],
    fetchImpl: async () => catalogResponse([]),
  });

  assert.equal(result.source, 'packaged');
  assert.match(result.error.message, /no usable model IDs/);
  assert.deepEqual(result.models, ['subconscious/custom', 'subconscious/default']);
});
