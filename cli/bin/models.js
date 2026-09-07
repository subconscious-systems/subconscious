/**
 * Resolve the model catalog exposed by an OpenAI-compatible gateway.
 *
 * When a profile (or agent) API key is present, prefer the key-scoped
 * /v1/models/available list. If that request fails, fall back to the public
 * /v1/models fleet catalog. Launches keep working with the packaged registry
 * when the gateway is offline or returns nothing usable.
 */

const MODEL_ID_PATTERN = /^[-A-Za-z0-9._:/+]+$/;
export const DEFAULT_MODEL_FETCH_TIMEOUT_MS = 3000;
export const AVAILABLE_MODELS_PATH = '/v1/models/available';
export const PUBLIC_MODELS_PATH = '/v1/models';
export const PUBLIC_CATALOG_FALLBACK_MESSAGE =
  'Provisioned catalog unavailable; showing the public model list.';
export const PACKAGED_DEFAULT_MODEL = 'subconscious/glm-5.3-marathon';

export function isLiveModelSource(source) {
  return source === 'available' || source === 'public';
}

function isFlagshipModel(model) {
  return model?.metadata?.is_flagship === true;
}

export function pickFlagshipModelId(models = []) {
  const flagged = models.filter(isFlagshipModel);
  if (flagged.length === 1) return flagged[0].id;
  return null;
}

export function orderModelIds(models = [], selectedModel) {
  const ids = [];
  const seen = new Set();

  for (const model of models) {
    const id = typeof model?.id === 'string' ? model.id.trim() : '';
    if (!id || !MODEL_ID_PATTERN.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  const flagshipId = pickFlagshipModelId(models);
  if (flagshipId) {
    const flagshipIndex = ids.indexOf(flagshipId);
    if (flagshipIndex > 0) {
      ids.unshift(ids.splice(flagshipIndex, 1)[0]);
    }
  }

  const selected = selectedModel?.trim();
  const selectedIndex = selected ? ids.indexOf(selected) : -1;
  if (selectedIndex > 0) {
    ids.unshift(ids.splice(selectedIndex, 1)[0]);
  }

  return ids;
}

export function resolveDefaultModel({ models = [], modelIds = [], fallbackModels = [] }) {
  return (
    pickFlagshipModelId(models) ||
    modelIds[0] ||
    fallbackModels.find((model) => MODEL_ID_PATTERN.test(model)) ||
    PACKAGED_DEFAULT_MODEL
  );
}

function gatewayOrigin(baseUrl) {
  if (!baseUrl?.trim()) throw new Error('Gateway URL is not configured');
  return baseUrl.trim().replace(/\/+$/, '');
}

function modelsEndpoint(baseUrl, path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${gatewayOrigin(baseUrl)}${normalizedPath}`;
}

function normalizeGatewayModels(payloadModels = []) {
  return payloadModels
    .filter((model) => model && typeof model === 'object')
    .map((model) => {
      const id = typeof model.id === 'string' ? model.id.trim() : '';
      if (!id || !MODEL_ID_PATTERN.test(id)) return null;
      const normalized = { id };
      if (typeof model.object === 'string') normalized.object = model.object;
      if (typeof model.created === 'number') normalized.created = model.created;
      if (typeof model.owned_by === 'string') normalized.owned_by = model.owned_by;
      if (typeof model.context_length === 'number') {
        normalized.context_length = model.context_length;
      }
      if (typeof model.max_output_length === 'number') {
        normalized.max_output_length = model.max_output_length;
      }
      if (Array.isArray(model.input_modalities)) {
        normalized.input_modalities = model.input_modalities;
      }
      if (Array.isArray(model.output_modalities)) {
        normalized.output_modalities = model.output_modalities;
      }
      if (Array.isArray(model.supported_sampling_parameters)) {
        normalized.supported_sampling_parameters = model.supported_sampling_parameters;
      }
      if (Array.isArray(model.supported_features)) {
        normalized.supported_features = model.supported_features;
      }
      if (model.metadata && typeof model.metadata === 'object') {
        normalized.metadata = model.metadata;
      }
      return normalized;
    })
    .filter(Boolean);
}

export async function fetchGatewayModels({
  baseUrl,
  apiKey,
  path = PUBLIC_MODELS_PATH,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_MODEL_FETCH_TIMEOUT_MS,
}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('This Node.js version does not support fetch');
  }

  const endpoint = modelsEndpoint(baseUrl, path);
  const headers = {
    Accept: 'application/json',
    'Cache-Control': 'no-cache, no-store',
    Pragma: 'no-cache',
  };
  if (apiKey?.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  try {
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      headers,
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Model discovery returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload?.data)) {
      throw new Error('Model discovery returned an invalid response');
    }

    const models = normalizeGatewayModels(payload.data);
    if (!models.length) {
      throw new Error('Model discovery returned no usable model IDs');
    }
    return models;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Model discovery timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPublicModels({ baseUrl, fetchImpl, timeoutMs }) {
  return fetchGatewayModels({
    baseUrl,
    path: PUBLIC_MODELS_PATH,
    fetchImpl,
    timeoutMs,
  });
}

function packagedCatalog(selectedModel, fallbackModels, error) {
  const seed = [];
  const selected = selectedModel?.trim();
  if (selected && MODEL_ID_PATTERN.test(selected)) {
    seed.push(selected);
  }
  for (const model of fallbackModels) {
    if (typeof model === 'string' && MODEL_ID_PATTERN.test(model.trim())) {
      seed.push(model.trim());
    }
  }
  const models = [];
  const seen = new Set();
  for (const id of seed) {
    if (seen.has(id)) continue;
    seen.add(id);
    models.push({ id });
  }
  const modelIds = orderModelIds(models, selectedModel);
  return {
    models,
    modelIds,
    defaultModel: resolveDefaultModel({ models, modelIds, fallbackModels }),
    source: 'packaged',
    error,
  };
}

function liveCatalog(models, selectedModel, source) {
  const modelIds = orderModelIds(models, selectedModel);
  return {
    models,
    modelIds,
    defaultModel: resolveDefaultModel({ models, modelIds }),
    source,
    error: null,
  };
}

export async function resolveModelCatalog({
  baseUrl,
  apiKey,
  selectedModel,
  fallbackModels = [],
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_MODEL_FETCH_TIMEOUT_MS,
}) {
  const key = apiKey?.trim() || '';

  if (key) {
    try {
      const discovered = await fetchGatewayModels({
        baseUrl,
        apiKey: key,
        path: AVAILABLE_MODELS_PATH,
        fetchImpl,
        timeoutMs,
      });
      return liveCatalog(discovered, selectedModel, 'available');
    } catch (availableError) {
      try {
        const discovered = await fetchPublicModels({ baseUrl, fetchImpl, timeoutMs });
        return liveCatalog(discovered, selectedModel, 'public');
      } catch {
        return packagedCatalog(selectedModel, fallbackModels, availableError);
      }
    }
  }

  try {
    const discovered = await fetchPublicModels({ baseUrl, fetchImpl, timeoutMs });
    return liveCatalog(discovered, selectedModel, 'public');
  } catch (error) {
    return packagedCatalog(selectedModel, fallbackModels, error);
  }
}

/** Backward-compatible helper for callers that only need ordered slug IDs. */
export function normalizeModelIds(modelIds = [], selectedModel) {
  const models = modelIds.map((id) => ({ id }));
  return orderModelIds(models, selectedModel);
}
