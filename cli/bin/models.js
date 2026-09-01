/**
 * Resolve the model catalog exposed by an OpenAI-compatible gateway.
 *
 * Live discovery is best-effort: launches should keep working with the
 * packaged registry when the gateway is offline or does not expose /v1/models.
 */

const MODEL_ID_PATTERN = /^[-A-Za-z0-9._:/+]+$/;
export const DEFAULT_MODEL_FETCH_TIMEOUT_MS = 3000;

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

export async function fetchGatewayModels({
  baseUrl,
  apiKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_MODEL_FETCH_TIMEOUT_MS,
}) {
  if (!baseUrl?.trim()) throw new Error('Gateway URL is not configured');
  if (!apiKey?.trim()) throw new Error('No API key is available for model discovery');
  if (typeof fetchImpl !== 'function') {
    throw new Error('This Node.js version does not support fetch');
  }

  const endpoint = `${baseUrl.trim().replace(/\/+$/, '')}/v1/models`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  try {
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
        'Cache-Control': 'no-cache, no-store',
        Pragma: 'no-cache',
      },
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

    const models = normalizeModelIds(payload.data.map((model) => model?.id));
    if (!models.length) throw new Error('Model discovery returned no usable model IDs');
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

export async function resolveModelCatalog({
  baseUrl,
  apiKey,
  selectedModel,
  fallbackModels = [],
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_MODEL_FETCH_TIMEOUT_MS,
}) {
  try {
    const discovered = await fetchGatewayModels({ baseUrl, apiKey, fetchImpl, timeoutMs });
    return {
      models: normalizeModelIds(discovered, selectedModel),
      source: 'gateway',
      error: null,
    };
  } catch (error) {
    return {
      models: normalizeModelIds([selectedModel, ...fallbackModels], selectedModel),
      source: 'packaged',
      error,
    };
  }
}
