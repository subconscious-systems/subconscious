import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUNBOOK_DIR = fileURLToPath(
  new URL('./runbook/', import.meta.url),
);

const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;
const PLATFORMS = new Set(['darwin', 'linux', 'win32']);
const MODES = new Set(['launch', 'setup']);
const SETUP_ACTIONS = new Set(['install', 'status', 'uninstall']);
const INPUT_TYPES = new Set([
  'secret',
  'integer',
  'text',
  'choice',
  'url',
  'model',
]);

function readJson(relative) {
  const file = new URL(`./runbook/${relative}`, import.meta.url);
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch (error) {
    throw new Error(`Cannot read bin/runbook/${relative}: ${error.message}`);
  }
}

function check(condition, where, message) {
  if (!condition) throw new Error(`Invalid ${where}: ${message}`);
}

const isObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isStringList = (value) =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

function validateEntry(entry, where, { needsValue = false } = {}) {
  check(isObject(entry), where, 'expected an object');
  check(ENV_NAME.test(entry.name ?? ''), where, `bad name ${entry.name}`);
  if (needsValue) check('value' in entry, where, `${entry.name} has no value`);
  if (entry.type !== undefined)
    check(INPUT_TYPES.has(entry.type), where, `bad type ${entry.type}`);
  if (entry.override !== undefined)
    check(isStringList(entry.override), where, `${entry.name} override`);
  if (entry.aliases !== undefined)
    check(isStringList(entry.aliases), where, `${entry.name} aliases`);
  if (entry.flag !== undefined)
    check(/^--[a-z][a-z-]*$/.test(entry.flag), where, `bad flag ${entry.flag}`);
  if (entry.strict)
    check(isStringList(entry.choices), where, `${entry.name} needs choices`);
}

function validateLaunch(launch, where) {
  check(isObject(launch), where, 'launch agents need a launch block');
  for (const key of ['argv', 'headless_argv', 'resume', 'handoff']) {
    if (launch[key] === undefined) continue;
    check(
      isStringList(launch[key]) && launch[key].length > 0,
      where,
      `launch.${key} must be a non-empty list of strings`,
    );
  }
  check(launch.argv !== undefined, where, 'launch.argv is required');
  if (launch.headless_argv) {
    const platforms = launch.headless_platforms;
    check(
      isStringList(platforms) && platforms.every((p) => PLATFORMS.has(p)),
      where,
      'launch.headless_platforms must list darwin, linux, or win32',
    );
  }
}

function validateRunbook(runbook, where) {
  check(isObject(runbook), where, 'runbook block is required');
  check(MODES.has(runbook.mode), where, `bad runbook.mode ${runbook.mode}`);
  const actions = runbook.setup_actions ?? [];
  check(
    isStringList(actions) && actions.every((a) => SETUP_ACTIONS.has(a)),
    where,
    'runbook.setup_actions may only list install, status, uninstall',
  );
  check(
    actions.length === 0 || typeof runbook.setup_script === 'string',
    where,
    'setup actions need runbook.setup_script',
  );
}

/** Check one agent file; throws with the file and the first problem found. */
export function validateAgent(agent, id) {
  const where = `bin/runbook/${id}/agent.json`;
  check(isObject(agent), where, 'expected an object');
  check(agent.id === id, where, `id must be ${id}`);
  for (const key of ['command', 'name', 'description', 'protocol'])
    check(typeof agent[key] === 'string' && agent[key], where, `${key}`);
  check(isStringList(agent.aliases), where, 'aliases must be a list');
  check(isObject(agent.install), where, 'install block is required');
  check(isObject(agent.help), where, 'help block is required');
  check(Array.isArray(agent.help.options), where, 'help.options');
  validateRunbook(agent.runbook, where);
  if (agent.runbook.mode === 'launch') validateLaunch(agent.launch, where);
  for (const key of ['prerequisites', 'inputs', 'env', 'config'])
    check(Array.isArray(agent[key]), where, `${key} must be a list`);
  for (const input of agent.inputs) validateEntry(input, `${where} inputs`);
  for (const entry of agent.env)
    validateEntry(entry, `${where} env`, { needsValue: true });
  const caps = agent.capabilities;
  check(isObject(caps) && isObject(caps.compaction), where, 'capabilities');
  return agent;
}

function loadShared() {
  const shared = readJson('shared.json');
  check(isStringList(shared.agents), 'shared.json', 'agents must be ids');
  check(isObject(shared.defaults), 'shared.json', 'defaults is required');
  for (const input of shared.inputs ?? [])
    validateEntry(input, 'shared.json inputs');
  return shared;
}

const shared = loadShared();

export const DEFAULTS = Object.freeze(shared.defaults);
export const PACKAGED_MODELS = Object.freeze(
  DEFAULTS.models?.length ? [...DEFAULTS.models] : [DEFAULTS.model],
);
export const MODEL_CAPABILITIES = Object.freeze(
  shared.model_capabilities ?? {},
);
export const SHARED_INPUTS = Object.freeze(shared.inputs ?? []);

export const AGENTS = Object.freeze(
  shared.agents.map((id) => validateAgent(readJson(`${id}/agent.json`), id)),
);

const SHARED_BY_NAME = new Map(SHARED_INPUTS.map((i) => [i.name, i]));

export function agentById(id) {
  return AGENTS.find((agent) => agent.id === id) ?? null;
}

/** An agent's inputs, each merged over the shared input of the same name. */
export function agentInputs(agent) {
  return agent.inputs.map((input) => ({
    ...(SHARED_BY_NAME.get(input.name) || {}),
    ...input,
  }));
}

export function agentBinary(agent) {
  return agent.launch?.argv?.[0] ?? null;
}

/** Per-OS install commands with `{package}` filled in, or null. */
export function installCommands(agent) {
  const { commands, package: name } = agent.install;
  if (!commands) return null;
  return Object.fromEntries(
    Object.entries(commands).map(([os, command]) => [
      os,
      name ? command.replaceAll('{package}', name) : command,
    ]),
  );
}

/** The API key input that overrides API_KEY for this agent, if any. */
export function agentKeyName(agent) {
  return (
    agent.inputs.find(
      (input) => input.type === 'secret' && input.name !== 'API_KEY',
    )?.name ?? null
  );
}

export function agentCommandName(agent) {
  return agent.command || agent.id;
}

export function agentSetupActions(agent) {
  return agent.runbook?.setup_actions ?? [];
}

/** Where the agent's own installer puts its binary, if it says. */
export function agentInstallDirs(agent, environment, home) {
  const { install_dir: dir, install_dir_env: envName } = agent.install;
  const configured = envName ? environment[envName]?.trim() : '';
  if (configured) return [path.resolve(configured)];
  return dir ? [path.resolve(home, dir.replace(/^~[/\\]/, ''))] : [];
}

const WHOLE_REF = /^\$\{([A-Z_][A-Z0-9_]*)\}$/;
const REF = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

/**
 * Replace `${NAME}` references with `lookup(NAME)`, keeping the referenced
 * value's type when the reference is the whole string. Unknown names stay.
 */
export function resolveRefs(value, lookup) {
  if (typeof value === 'string') {
    const whole = WHOLE_REF.exec(value);
    if (whole) {
      const target = lookup(whole[1]);
      return target === undefined ? value : resolveRefs(target, lookup);
    }
    return value.replace(REF, (match, name) => {
      const target = lookup(name);
      return target === undefined ? match : String(resolveRefs(target, lookup));
    });
  }
  if (Array.isArray(value))
    return value.map((item) => resolveRefs(item, lookup));
  if (isObject(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        resolveRefs(item, lookup),
      ]),
    );
  return value;
}

/** Look up an input's default or an env entry's value by name. */
export function staticLookup(agent) {
  const values = new Map();
  for (const entry of agent.env) values.set(entry.name, entry.value);
  for (const input of agentInputs(agent))
    if (input.default !== undefined) values.set(input.name, input.default);
  return (name) => values.get(name);
}
