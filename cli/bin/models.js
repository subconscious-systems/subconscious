import { readFileSync } from 'node:fs';

const registry = JSON.parse(
  readFileSync(new URL('./registry.generated.json', import.meta.url), 'utf-8'),
);

export const DEFAULT_MODEL = registry.defaults.model;
export const DEFAULT_GATEWAY_URL = registry.defaults.baseUrl;
export const FALLBACK_MODELS = Object.freeze(
  Array.isArray(registry.defaults.models) && registry.defaults.models.length
    ? [...new Set(registry.defaults.models)]
    : [DEFAULT_MODEL],
);

export function modelsEndpoint(gatewayUrl) {
  const url = new URL(gatewayUrl);
  const pathname = url.pathname.replace(/\/+$/, '');
  const originPath = pathname.replace(/\/v1(?:\/(?:chat\/completions|responses|models))?$/, '');
  url.pathname = `${originPath}/v1/models`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function parseModelsResponse(payload) {
  if (!payload || !Array.isArray(payload.data)) {
    throw new Error('Gateway returned an invalid model catalog');
  }

  const models = [
    ...new Set(
      payload.data
        .map((entry) => (typeof entry?.id === 'string' ? entry.id.trim() : ''))
        .filter(Boolean),
    ),
  ];
  if (!models.length) throw new Error('Gateway returned an empty model catalog');
  return models;
}

export async function fetchGatewayModels(gatewayUrl, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('This Node version does not provide fetch');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
  try {
    const response = await fetchImpl(modelsEndpoint(gatewayUrl), {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Gateway model catalog returned HTTP ${response.status}`);
    }
    return parseModelsResponse(await response.json());
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Gateway model catalog request timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveGatewayModels(gatewayUrl, options = {}) {
  try {
    return {
      models: await fetchGatewayModels(gatewayUrl, options),
      source: 'gateway',
      error: null,
    };
  } catch (error) {
    return {
      models: [...FALLBACK_MODELS],
      source: 'fallback',
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
