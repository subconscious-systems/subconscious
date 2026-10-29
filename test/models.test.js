import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AVAILABLE_MODELS_PATH,
  fetchGatewayModels,
  isAbortError,
  isLiveModelSource,
  normalizeModelIds,
  PUBLIC_MODELS_PATH,
  parseCatalogEntries,
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

function canonicalResponse(models) {
  return jsonResponse({
    object: 'list',
    data: models.map((model) => ({
      schema_version: '1',
      id: model.id,
      object: 'model',
      created: 0,
      owned_by: 'subconscious',
      name: model.id,
      ...model,
    })),
  });
}

test('normalizeModelIds reorders a present selected model and removes invalid duplicates', () => {
  assert.deepEqual(
    normalizeModelIds(
      [
        'subconscious/two',
        'subconscious/one',
        'bad model',
        '',
        'subconscious/two',
      ],
      'subconscious/one',
    ),
    ['subconscious/one', 'subconscious/two'],
  );
});

test('normalizeModelIds keeps gateway order when no selected model is set', () => {
  assert.deepEqual(
    normalizeModelIds(
      ['subconscious/glm-5.3-marathon', 'subconscious/glm-5.2'],
      '',
    ),
    ['subconscious/glm-5.3-marathon', 'subconscious/glm-5.2'],
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

test('resolveModelCatalog prefers the canonical catalog and preserves the selected model first', async () => {
  const urls = [];
  const result = await resolveModelCatalog({
    baseUrl: 'https://gateway.example',
    apiKey: 'sk-test',
    selectedModel: 'subconscious/two',
    fetchImpl: async (url) => {
      urls.push(url);
      return canonicalResponse([
        { id: 'subconscious/one' },
        {
          id: 'subconscious/two',
          lifecycle: { status: 'active' },
          limits: { context_length: 200000, max_output_tokens: 32000 },
        },
      ]);
    },
  });

  assert.equal(result.source, 'catalog');
  assert.equal(result.error, null);
  assert.deepEqual(result.models, ['subconscious/two', 'subconscious/one']);
  assert.deepEqual(urls, ['https://gateway.example/v1/models']);
  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.entries[1].lifecycle, { status: 'active' });
  assert.deepEqual(result.entries[1].limits, {
    context_length: 200000,
    max_output_tokens: 32000,
  });
});

test('resolveModelCatalog drops deprecated and retired models from the defaults but keeps them invocable', async () => {
  const result = await resolveModelCatalog({
    baseUrl: 'https://gateway.example',
    apiKey: 'sk-test',
    selectedModel: 'subconscious/old',
    fetchImpl: async () =>
      canonicalResponse([
        { id: 'subconscious/current' },
        {
          id: 'subconscious/old',
          lifecycle: {
            status: 'deprecated',
            deprecation_date: '2026-11-05',
            replacement: 'subconscious/current',
          },
        },
        { id: 'subconscious/gone', lifecycle: { status: 'retired' } },
      ]),
  });

  assert.equal(result.source, 'catalog');
  assert.deepEqual(result.models, [
    'subconscious/old',
    'subconscious/current',
    'subconscious/gone',
  ]);
  assert.deepEqual(result.defaultModels, ['subconscious/current']);
});

test('resolveModelCatalog keeps the full list as defaults when every model is deprecated', async () => {
  const result = await resolveModelCatalog({
    baseUrl: 'https://gateway.example',
    apiKey: 'sk-test',
    fetchImpl: async () =>
      canonicalResponse([
        {
          id: 'subconscious/old',
          lifecycle: { status: 'deprecated' },
        },
      ]),
  });

  assert.deepEqual(result.defaultModels, ['subconscious/old']);
});

test('resolveModelCatalog uses /available when the gateway answers with a minimal list', async () => {
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
  assert.deepEqual(urls, [
    'https://gateway.example/v1/models',
    'https://gateway.example/v1/models/available',
  ]);
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

test('resolveModelCatalog falls back to packaged models when every live listing is empty', async () => {
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

  assert.equal(result.source, 'packaged');
  assert.match(result.error.message, /no usable model IDs/);
  assert.deepEqual(result.models, [
    'subconscious/custom',
    'subconscious/default',
  ]);
  assert.deepEqual(urls, [
    'https://gateway.example/v1/models',
    'https://gateway.example/v1/models/available',
    'https://gateway.example/v1/models',
  ]);
});

test('resolveModelCatalog falls back to the public catalog without auth when the key-scoped listings fail', async () => {
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
      if (options.headers.Authorization) {
        return { ok: false, status: 503, json: async () => ({}) };
      }
      return catalogResponse(['subconscious/one', 'subconscious/two']);
    },
  });

  assert.equal(result.source, 'public');
  assert.equal(result.error, null);
  assert.deepEqual(result.models, ['subconscious/two', 'subconscious/one']);
  assert.deepEqual(requests, [
    {
      url: 'https://gateway.example/v1/models',
      authorization: 'Bearer sk-test',
    },
    {
      url: 'https://gateway.example/v1/models/available',
      authorization: 'Bearer sk-test',
    },
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
  assert.deepEqual(result.models, [
    'subconscious/custom',
    'subconscious/default',
  ]);
});

test('resolveModelCatalog does not fall back when the caller aborts', async () => {
  const controller = new AbortController();
  const pending = resolveModelCatalog({
    baseUrl: 'https://gateway.example',
    apiKey: 'sk-test',
    fallbackModels: ['subconscious/default'],
    signal: controller.signal,
    fetchImpl: () => new Promise(() => {}),
  });
  controller.abort();
  await assert.rejects(pending, (error) => isAbortError(error));
});

test('fetchGatewayModels times out while reading a stalled response body', async () => {
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(
      fetchGatewayModels({
        baseUrl: 'https://gateway.example',
        timeoutMs: 25,
        fetchImpl: async () => ({
          ok: true,
          json: () => new Promise(() => {}),
        }),
      }),
      /Model discovery timed out after 25ms/,
    );
  } finally {
    clearInterval(keepAlive);
  }
});

test('fetchGatewayModels cancels while reading a stalled response body', async () => {
  const controller = new AbortController();
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const pending = fetchGatewayModels({
      baseUrl: 'https://gateway.example',
      signal: controller.signal,
      fetchImpl: async () => ({
        ok: true,
        json: () => {
          controller.abort();
          return new Promise(() => {});
        },
      }),
    });
    await assert.rejects(pending, (error) => isAbortError(error));
  } finally {
    clearInterval(keepAlive);
  }
});

test('a pinned catalog wins over discovery and is never fetched', async () => {
  const catalog = await resolveModelCatalog({
    baseUrl: 'https://gateway.example',
    apiKey: 'key',
    selectedModel: 'subconscious/b',
    pinnedModels: 'subconscious/a\nsubconscious/b\n',
    fetchImpl: async () => {
      throw new Error('a pinned catalog must not fetch');
    },
  });
  assert.equal(catalog.source, 'pinned');
  assert.equal(catalog.error, null);
  assert.deepEqual(catalog.models, ['subconscious/b', 'subconscious/a']);
  assert.equal(isLiveModelSource(catalog.source), false);
});

test('a blank pinned catalog still discovers', async () => {
  const catalog = await resolveModelCatalog({
    baseUrl: 'https://gateway.example',
    apiKey: 'key',
    pinnedModels: '  \n',
    fetchImpl: async (url) =>
      url.endsWith(AVAILABLE_MODELS_PATH)
        ? catalogResponse(['subconscious/live'])
        : canonicalResponse([{ id: 'subconscious/live' }]),
  });
  assert.equal(catalog.source, 'catalog');
  assert.deepEqual(catalog.models, ['subconscious/live']);
});

test('parseCatalogEntries keeps only well-formed ids and carries optional fields', () => {
  const entries = parseCatalogEntries([
    null,
    'not-an-object',
    { id: 'subconscious/one' },
    { id: 'bad model' },
    {
      id: 'subconscious/two',
      lifecycle: { status: 'deprecated' },
      capabilities: { tools: true },
    },
  ]);
  assert.deepEqual(entries, [
    {
      id: 'subconscious/one',
      lifecycle: null,
      limits: null,
      modalities: null,
      capabilities: null,
    },
    {
      id: 'subconscious/two',
      lifecycle: { status: 'deprecated' },
      limits: null,
      modalities: null,
      capabilities: { tools: true },
    },
  ]);
});
