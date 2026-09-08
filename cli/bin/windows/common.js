import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const defaults = JSON.parse(readFileSync(new URL('../registry.generated.json', import.meta.url), 'utf8')).defaults;
export const value = (env, key, fallback = '') => env[key]?.trim() || fallback;
export const origin = url => url.replace(/\/+$/, '').replace(/\/v1(?:\/(?:messages|responses|chat\/completions))?$/, '');
export function positiveInteger(input, name) {
  if (!/^[1-9][0-9]*$/.test(String(input)) || !Number.isSafeInteger(Number(input))) throw new Error(`${name} must be a positive integer`);
  return Number(input);
}
export function modelIds(env) {
  const models = [...new Set([value(env, 'MODEL', defaults.model), ...value(env, 'SUBCONSCIOUS_MODELS', defaults.models.join('\n')).split(/\r?\n/)].filter(Boolean))];
  for (const model of models) if (!/^[-A-Za-z0-9._:/+]+$/.test(model)) throw new Error(`Invalid model id: ${model}`);
  return models;
}
export function parseOptions(argv, schema, { strict = false } = {}) {
  const options = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--') {
      if (strict && i + 1 < argv.length) throw new Error(`Unexpected setup argument: ${argv[i + 1]}`);
      rest.push(...argv.slice(i + 1)); break;
    }
    const [flag, ...equals] = argv[i].split('=');
    if (!Object.hasOwn(schema, flag)) {
      if (strict) throw new Error(`Unknown setup option: ${argv[i]}`);
      rest.push(argv[i]); continue;
    }
    if (schema[flag] === true) {
      if (equals.length) throw new Error(`${flag} does not take a value`);
      options[flag] = true; continue;
    }
    const next = equals.length ? equals.join('=') : argv[++i];
    if (!next || next.startsWith('--')) throw new Error(`${flag} requires a value`);
    options[flag] = next;
  }
  return { options, rest };
}
export async function readJson(file, fallback) {
  try { return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(`Cannot read ${file}; leaving it unchanged: ${error.message}`);
  }
}
export function object(value, description) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${description} must be a JSON object; leaving it unchanged`);
  return value;
}
export async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }); }
}
