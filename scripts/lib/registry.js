/**
 * Shared registry loading + token substitution.
 *
 * The single source of truth lives in `agents/registry.json`. Tokens like
 * `{apiKey}`, `{model}`, `{baseUrl}`, `{baseUrlV1}` are placeholders that the
 * CLI substitutes at runtime. The literal `{env:...}` token is OpenCode's own
 * templating and must never be touched here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRY_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'agents',
  'registry.json',
);

/** Parse and return the canonical registry. */
function loadRegistry() {
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
}

// The substitutable tokens. `{env:...}` is intentionally excluded.
const TOKENS = ['apiKey', 'model', 'baseUrl', 'baseUrlV1'];

/** Replace `{token}` occurrences in a single string using `ctx`. */
function substituteString(str, ctx) {
  let out = str;
  for (const token of TOKENS) {
    if (ctx[token] === undefined) continue;
    out = out.split(`{${token}}`).join(ctx[token]);
  }
  return out;
}

/**
 * Deep-walk any JSON value, substituting tokens in strings and object keys.
 * A value of shape `{ "$json": <obj> }` is substituted then JSON.stringify'd
 * to a string. Returns a brand-new structure; never mutates the input.
 */
function substitute(value, ctx) {
  if (typeof value === 'string') {
    return substituteString(value, ctx);
  }
  if (Array.isArray(value)) {
    return value.map((item) => substitute(item, ctx));
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === '$json') {
      return JSON.stringify(substitute(value.$json, ctx));
    }
    const out = {};
    for (const key of keys) {
      const newKey = substituteString(key, ctx);
      out[newKey] = substitute(value[key], ctx);
    }
    return out;
  }
  return value;
}

export { loadRegistry, REGISTRY_PATH, substitute };
