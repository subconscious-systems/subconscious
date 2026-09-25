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

export function isLiveModelSource(source) {
  return source === 'available' || source === 'public';
}

export function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

function linkAbortSignal(controller, signal) {
  if (!signal) return () => {};
  if (signal.aborted) {
    controller.abort();
    return () => {};
  }
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  return () => signal.removeEventListener('abort', onAbort);
}

function abortError(message) {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function normalizeModelIds(modelIds = [], selectedModel) {
  const models = [];
  const seen = new Set();

  for (const value of modelIds) {
    const model = typeof value === 'string' ? value.trim() : '';
    if (!model || !MODEL_ID_PATTERN.test(model) || seen.has(model)) continue;
    seen.add(model);
    models.push(model);
  }

  const selectedIndex = models.indexOf(selectedModel?.trim());
  if (selectedIndex > 0) {
    models.unshift(models.splice(selectedIndex, 1)[0]);
  }

  return models;
}

function gatewayOrigin(baseUrl) {
  if (!baseUrl?.trim()) throw new Error('Gateway URL is not configured');
  return baseUrl.trim().replace(/\/+$/, '');
}

function modelsEndpoint(baseUrl, path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${gatewayOrigin(baseUrl)}${normalizedPath}`;
}

export async function fetchGatewayModels({
  baseUrl,
  apiKey,
  path = PUBLIC_MODELS_PATH,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_MODEL_FETCH_TIMEOUT_MS,
  signal,
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
  const unlink = linkAbortSignal(controller, signal);

  try {
    if (signal?.aborted) throw abortError('Model discovery was cancelled');
    const aborted = new Promise((_, reject) => {
      const fail = () => {
        if (signal?.aborted) reject(abortError('Model discovery was cancelled'));
        else reject(new Error(`Model discovery timed out after ${timeoutMs}ms`));
      };
      controller.signal.addEventListener('abort', fail, { once: true });
    });
    const response = await Promise.race([
      fetchImpl(endpoint, {
        method: 'GET',
        headers,
        cache: 'no-store',
        signal: controller.signal,
      }),
      aborted,
    ]);

    if (!response.ok) {
      throw new Error(`Model discovery returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload?.data)) {
      throw new Error('Model discovery returned an invalid response');
    }

    return normalizeModelIds(payload.data.map((model) => model?.id));
  } catch (error) {
    if (signal?.aborted) throw abortError('Model discovery was cancelled');
    if (controller.signal.aborted) {
      throw new Error(`Model discovery timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    unlink();
    clearTimeout(timeout);
  }
}

async function fetchPublicModels({ baseUrl, fetchImpl, timeoutMs, signal }) {
  const models = await fetchGatewayModels({
    baseUrl,
    path: PUBLIC_MODELS_PATH,
    fetchImpl,
    timeoutMs,
    signal,
  });
  if (!models.length) throw new Error('Model discovery returned no usable model IDs');
  return models;
}

function packagedCatalog(selectedModel, fallbackModels, error) {
  return {
    models: normalizeModelIds([selectedModel, ...fallbackModels], selectedModel),
    source: 'packaged',
    error,
  };
}

function liveCatalog(models, selectedModel, source) {
  return {
    models: normalizeModelIds(models, selectedModel),
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
  signal,
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
        signal,
      });
      return liveCatalog(discovered, selectedModel, 'available');
    } catch (availableError) {
      if (isAbortError(availableError) || signal?.aborted) throw availableError;
      try {
        const discovered = await fetchPublicModels({ baseUrl, fetchImpl, timeoutMs, signal });
        return liveCatalog(discovered, selectedModel, 'public');
      } catch (publicError) {
        if (isAbortError(publicError) || signal?.aborted) throw publicError;
        return packagedCatalog(selectedModel, fallbackModels, availableError);
      }
    }
  }

  try {
    const discovered = await fetchPublicModels({ baseUrl, fetchImpl, timeoutMs, signal });
    return liveCatalog(discovered, selectedModel, 'public');
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw error;
    return packagedCatalog(selectedModel, fallbackModels, error);
  }
}
