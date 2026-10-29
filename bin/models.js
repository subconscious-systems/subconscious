/**
 * Resolve the model catalog exposed by an OpenAI-compatible gateway.
 *
 * A key-scoped GET /v1/models is the canonical source: the gateway filters
 * it by the key's model access and describes each model (lifecycle, limits,
 * modalities, capabilities). Older gateways without the canonical catalog
 * fall back to /v1/models/available, then the public /v1/models list.
 * Launches keep working with the packaged registry when the gateway is
 * offline or returns nothing usable.
 */

import { proxyAwareFetch } from './network.js';

const MODEL_ID_PATTERN = /^[-A-Za-z0-9._:/+]+$/;
export const DEFAULT_MODEL_FETCH_TIMEOUT_MS = 3000;
export const AVAILABLE_MODELS_PATH = '/v1/models/available';
export const PUBLIC_MODELS_PATH = '/v1/models';
export const PUBLIC_CATALOG_FALLBACK_MESSAGE =
  'Provisioned catalog unavailable; showing the public model list.';

export function isLiveModelSource(source) {
  return source === 'catalog' || source === 'available' || source === 'public';
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

/**
 * Rich entry fields from a canonical /v1/models response: lifecycle
 * (status, deprecation_date, replacement), limits, modalities, and
 * capabilities. Minimal legacy responses produce entries that carry only
 * the id; every optional field is absent, never guessed.
 */
export function parseCatalogEntries(data = []) {
  const entries = [];
  for (const model of data) {
    if (model == null || typeof model !== 'object') continue;
    const id = typeof model.id === 'string' ? model.id.trim() : '';
    if (!id || !MODEL_ID_PATTERN.test(id)) continue;
    entries.push({
      id,
      lifecycle: model.lifecycle ?? null,
      limits: model.limits ?? null,
      modalities: model.modalities ?? null,
      capabilities: model.capabilities ?? null,
    });
  }
  return entries;
}

/** True when the response is the canonical catalog, not a minimal list. */
function isCanonicalResponse(data = []) {
  return data.some((model) => model?.schema_version === '1');
}

function gatewayOrigin(baseUrl) {
  if (!baseUrl?.trim()) throw new Error('Gateway URL is not configured');
  return baseUrl.trim().replace(/\/+$/, '');
}

function modelsEndpoint(baseUrl, path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${gatewayOrigin(baseUrl)}${normalizedPath}`;
}

async function fetchModelsPayload({
  baseUrl,
  apiKey,
  path,
  fetchImpl,
  timeoutMs,
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
        if (signal?.aborted)
          reject(abortError('Model discovery was cancelled'));
        else
          reject(new Error(`Model discovery timed out after ${timeoutMs}ms`));
      };
      controller.signal.addEventListener('abort', fail, { once: true });
    });
    const discover = async () => {
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

      return payload.data;
    };
    return await Promise.race([discover(), aborted]);
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

/**
 * Fetch one models listing. Returns the id list, the parsed catalog
 * entries, and whether the gateway answered with the canonical catalog.
 */
export async function fetchGatewayCatalog({
  baseUrl,
  apiKey,
  path = PUBLIC_MODELS_PATH,
  fetchImpl = proxyAwareFetch,
  timeoutMs = DEFAULT_MODEL_FETCH_TIMEOUT_MS,
  signal,
}) {
  const data = await fetchModelsPayload({
    baseUrl,
    apiKey,
    path,
    fetchImpl,
    timeoutMs,
    signal,
  });
  const entries = parseCatalogEntries(data);
  const models = normalizeModelIds(entries.map((entry) => entry.id));
  if (!models.length)
    throw new Error('Model discovery returned no usable model IDs');
  return { models, entries, canonical: isCanonicalResponse(data) };
}

export async function fetchGatewayModels(args) {
  const { models } = await fetchGatewayCatalog(args);
  return models;
}

function packagedCatalog(selectedModel, fallbackModels, error) {
  return {
    models: normalizeModelIds(
      [selectedModel, ...fallbackModels],
      selectedModel,
    ),
    defaultModels: normalizeModelIds(
      [selectedModel, ...fallbackModels],
      selectedModel,
    ),
    entries: [],
    source: 'packaged',
    error,
  };
}

/**
 * Assemble the catalog views. `models` is everything the caller can invoke,
 * deprecated models included. `defaultModels` drops models the gateway
 * marked deprecated or retired, so new sessions pick a current model while
 * existing configurations that name a deprecated model keep working.
 */
function liveCatalog(models, selectedModel, source, entries = []) {
  const normalized = normalizeModelIds(models, selectedModel);
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const defaults = normalized.filter((id) => {
    const status = entryById.get(id)?.lifecycle?.status;
    return status !== 'deprecated' && status !== 'retired';
  });
  return {
    models: normalized,
    defaultModels: defaults.length ? defaults : normalized,
    entries,
    source,
    error: null,
  };
}

export async function resolveModelCatalog({
  baseUrl,
  apiKey,
  selectedModel,
  fallbackModels = [],
  pinnedModels,
  fetchImpl = proxyAwareFetch,
  timeoutMs = DEFAULT_MODEL_FETCH_TIMEOUT_MS,
  signal,
}) {
  // A caller that names its catalog (a benchmark run, a CI job) needs the same
  // models on every launch, whatever the gateway lists that day.
  const pinned = pinnedModels?.split(/\r?\n/).filter((id) => id.trim());
  if (pinned?.length) {
    return {
      models: normalizeModelIds(pinned, selectedModel),
      defaultModels: normalizeModelIds(pinned, selectedModel),
      entries: [],
      source: 'pinned',
      error: null,
    };
  }

  const key = apiKey?.trim() || '';

  if (key) {
    let canonicalError;
    try {
      // The canonical catalog is key-scoped and access-filtered by the
      // gateway, so no second request is needed when it answers.
      const discovered = await fetchGatewayCatalog({
        baseUrl,
        apiKey: key,
        path: PUBLIC_MODELS_PATH,
        fetchImpl,
        timeoutMs,
        signal,
      });
      if (discovered.canonical) {
        return liveCatalog(
          discovered.models,
          selectedModel,
          'catalog',
          discovered.entries,
        );
      }
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw error;
      canonicalError = error;
    }

    try {
      // An older gateway: /v1/models is a public minimal list, and
      // /v1/models/available is the key-scoped one.
      const discovered = await fetchGatewayCatalog({
        baseUrl,
        apiKey: key,
        path: AVAILABLE_MODELS_PATH,
        fetchImpl,
        timeoutMs,
        signal,
      });
      return liveCatalog(discovered.models, selectedModel, 'available');
    } catch (availableError) {
      if (isAbortError(availableError) || signal?.aborted) throw availableError;
      try {
        const discovered = await fetchGatewayCatalog({
          baseUrl,
          fetchImpl,
          timeoutMs,
          signal,
        });
        return liveCatalog(discovered.models, selectedModel, 'public');
      } catch (publicError) {
        if (isAbortError(publicError) || signal?.aborted) throw publicError;
        return packagedCatalog(
          selectedModel,
          fallbackModels,
          canonicalError ?? availableError,
        );
      }
    }
  }

  try {
    const discovered = await fetchGatewayCatalog({
      baseUrl,
      fetchImpl,
      timeoutMs,
      signal,
    });
    return liveCatalog(discovered.models, selectedModel, 'public');
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw error;
    return packagedCatalog(selectedModel, fallbackModels, error);
  }
}
