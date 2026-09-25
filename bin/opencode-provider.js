import { modelSupportsVision } from './model-capabilities.js';

export const OPENCODE_PROVIDER_ID = 'subconscious';
export const OPENCODE_PROVIDER_NAME = 'Subconscious Gateway';

const ACRONYMS = new Set([
  'gpt',
  'oss',
  'api',
  'gguf',
  'ggml',
  'nomic',
  'vl',
  'it',
  'mlx',
]);

function formatToken(token) {
  const lower = token.toLowerCase();
  if (ACRONYMS.has(lower)) return token.toUpperCase();
  if (/^\d+[bkmg]$/i.test(token)) return token.toUpperCase();
  if (/^q\d+$/i.test(token)) return token.toUpperCase();
  if (/^\d+\.\d+/.test(token)) return token;
  if (/^[a-z]\d+[a-z]$/i.test(token) || /^\d+[a-z]$/i.test(token))
    return token.toUpperCase();
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

/** Drop the subconscious/ prefix, then capitalize each dash-separated token. */
export function opencodeModelDisplayName(modelId) {
  const text = String(modelId ?? '').trim();
  const slug = text.startsWith('subconscious/')
    ? text.slice('subconscious/'.length)
    : text;
  return slug.split(/[-_]/).filter(Boolean).map(formatToken).join(' ');
}

export function buildOpenCodeModels(modelIds, { context, output }) {
  return Object.fromEntries(
    modelIds.map((id) => [
      id,
      {
        name: opencodeModelDisplayName(id),
        tools: true,
        limit: { context, output },
        ...(modelSupportsVision(id)
          ? {
              attachment: true,
              modalities: { input: ['text', 'image'], output: ['text'] },
            }
          : {}),
      },
    ]),
  );
}

export function buildOpenCodeConfig({
  baseUrl,
  model,
  modelIds,
  context,
  output,
}) {
  return {
    $schema: 'https://opencode.ai/config.json',
    disabled_providers: ['subconscious-cli'],
    provider: {
      [OPENCODE_PROVIDER_ID]: {
        npm: '@ai-sdk/openai-compatible',
        name: OPENCODE_PROVIDER_NAME,
        whitelist: [...modelIds],
        options: {
          baseURL: `${baseUrl}/v1`,
          apiKey: '{env:SUBCONSCIOUS_API_KEY}',
          headers: { 'x-subconscious-client': 'opencode' },
          modelsDiscovery: { enabled: false },
        },
        models: buildOpenCodeModels(modelIds, { context, output }),
      },
    },
    model: `${OPENCODE_PROVIDER_ID}/${model}`,
  };
}
