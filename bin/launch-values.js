import { DEFAULTS, PACKAGED_MODELS } from './agent-data.js';

const MODEL_ID = /^[-A-Za-z0-9._:/+]+$/;

/** The launch model first, then the catalog, deduplicated and validated. */
export function modelIds(env) {
  const catalog = (
    env.SUBCONSCIOUS_MODELS?.trim() || PACKAGED_MODELS.join('\n')
  ).split(/\r?\n/);
  const models = [
    ...new Set([env.MODEL?.trim() || DEFAULTS.model, ...catalog]),
  ].filter(Boolean);
  for (const model of models)
    if (!MODEL_ID.test(model)) throw new Error(`Invalid model id: ${model}`);
  return models;
}

export function positiveInteger(input, name) {
  if (
    !/^[1-9][0-9]*$/.test(String(input)) ||
    !Number.isSafeInteger(Number(input))
  )
    throw new Error(`${name} must be a positive integer`);
  return Number(input);
}
