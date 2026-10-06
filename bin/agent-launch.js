import { agentInputs, agentKeyName } from './agent-data.js';
import { openCodeConfigFromEnv } from './opencode-provider.js';
import { isUnsetSetting } from './profiles.js';

// One pass, so a substituted value (a prompt, a settings document) is never
// scanned again for placeholders.
const PLACEHOLDER = /\$\{([A-Z_][A-Z0-9_]*)\}(\/)?|\{([A-Za-z][A-Za-z0-9]*)\}/g;
const present = (value) =>
  value !== undefined && value !== null && value !== '';

function tokensFor(agent, env, extra) {
  const baseUrl = String(env.GATEWAY_URL ?? '').replace(/\/+$/, '');
  const keyName = agentKeyName(agent);
  return {
    baseUrl,
    baseUrlV1: `${baseUrl}/v1`,
    apiKey: (keyName && env[keyName]) || env.API_KEY || '',
    model: env.MODEL ?? '',
    // Left for the runbook, which writes the file and substitutes its path.
    tempFile: '{tempFile}',
    opencodeConfig: () => JSON.stringify(openCodeConfigFromEnv(env)),
    ...extra,
  };
}

/**
 * Fill `{token}` placeholders and `${NAME}` env references. A reference
 * followed by `/` drops the value's trailing slashes, so URLs join cleanly.
 */
export function render(template, agent, env, extra = {}) {
  const tokens = tokensFor(agent, env, extra);
  return String(template).replace(PLACEHOLDER, (match, ref, slash, token) => {
    if (ref) {
      const value = String(env[ref] ?? '');
      return slash ? `${value.replace(/\/+$/, '')}/` : value;
    }
    if (!(token in tokens) || tokens[token] === undefined)
      throw new Error(`${agent.id}: ${match} has no value here`);
    const value = tokens[token];
    return typeof value === 'function' ? value() : value;
  });
}

/**
 * Pull the agent's declared flags out of `args`, up to the first `--`, which
 * is dropped. Everything else passes through in order.
 */
export function takeFlags(agent, args, { skip = [] } = {}) {
  const flags = new Map(
    agentInputs(agent)
      .filter((input) => input.flag && !skip.includes(input.name))
      .map((input) => [input.flag, input]),
  );
  const values = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      rest.push(...args.slice(i + 1));
      break;
    }
    const equals = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const name = equals > 0 ? arg.slice(0, equals) : arg;
    const input = flags.get(name);
    if (!input) {
      rest.push(arg);
    } else if ('flag_value' in input) {
      if (equals > 0) throw new Error(`${name} does not take a value`);
      values[input.name] = input.flag_value;
    } else if (equals > 0) {
      values[input.name] = arg.slice(equals + 1);
    } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
      values[input.name] = args[++i];
    } else {
      throw new Error(`${name} requires a value`);
    }
  }
  return { values, rest };
}

function inputValue(input, env, agent) {
  const own = env[input.name];
  const usable = (value) =>
    present(value) && !(input.unset_words && isUnsetSetting(value));
  if (usable(own)) return own;
  const alias = (input.aliases || []).map((name) => env[name]).find(usable);
  if (alias !== undefined) return alias;
  if (own === '' && input.keep_empty) return own;
  if (input.default === undefined) return own;
  return render(input.default, agent, env);
}

/**
 * Apply flags, then each input's aliases and default, in file order. A
 * launch rejects a strict input outside its choices; status and uninstall
 * pass `{ strict: false }` so a bad setting cannot block the way out.
 */
export function resolveInputs(
  agent,
  env,
  flagged = {},
  { strict = true } = {},
) {
  const resolved = { ...env, ...flagged };
  for (const input of agentInputs(agent)) {
    if (input.name in flagged) continue;
    const value = inputValue(input, resolved, agent);
    if (value !== undefined) resolved[input.name] = String(value);
  }
  for (const input of agentInputs(agent)) {
    if (!strict) continue;
    const source =
      input.name in flagged ? input.flag || input.name : input.name;
    if (input.type === 'integer' && resolved[input.name] !== undefined) {
      const text = String(resolved[input.name]).trim();
      const number = Number(text);
      if (!/^-?\d+$/.test(text) || !Number.isSafeInteger(number)) {
        throw new Error(
          input.min === 1
            ? `${source} must be a positive integer`
            : `${source} must be a safe decimal integer`,
        );
      }
      if (input.min !== undefined && number < input.min) {
        throw new Error(
          input.min === 1
            ? `${source} must be a positive integer`
            : `${source} must be an integer >= ${input.min}`,
        );
      }
      if (input.max !== undefined && number > input.max) {
        throw new Error(`${source} must be an integer <= ${input.max}`);
      }
      resolved[input.name] = String(number);
    }
    if (!input.strict) continue;
    if (input.choices.includes(resolved[input.name])) continue;
    throw new Error(`${source} must be one of: ${input.choices.join(', ')}`);
  }
  return resolved;
}

/** Set each env entry: the first non-empty override, otherwise its value. */
export function resolveAgentEnv(agent, env) {
  const resolved = { ...env };
  for (const entry of agent.env) {
    const override = (entry.override || [])
      .map((name) => resolved[name])
      .find(present);
    resolved[entry.name] =
      override !== undefined ? override : render(entry.value, agent, resolved);
  }
  return resolved;
}

function holds(when, env) {
  return Object.entries(when || {}).every(([name, test]) => {
    const value = env[name] ?? '';
    if (test === 'set') return value !== '';
    if (test === 'empty') return value === '';
    if (test && 'not' in test) return value !== test.not;
    throw new Error(`Unknown condition for ${name}: ${JSON.stringify(test)}`);
  });
}

/** `-c name=value` pairs (or the agent's config flag) for cli-config entries. */
export function configArgs(agent, env) {
  const flag = agent.launch?.config_flag;
  return agent.config
    .filter((entry) => entry.kind === 'cli-config' && holds(entry.when, env))
    .flatMap((entry) => [
      flag,
      `${entry.name}=${render(entry.value, agent, env)}`,
    ]);
}

function expandArgv(agent, template, env, args, prompt) {
  const argv = [];
  let templateWords;
  for (const word of template) {
    if (word === '{args}') {
      templateWords ??= argv.length;
      argv.push(...args);
    } else if (word === '{config}') {
      argv.push(...configArgs(agent, env));
    } else {
      if (word.includes('{prompt}')) templateWords ??= argv.length;
      argv.push(render(word, agent, env, { prompt }));
    }
  }
  return { argv, templateWords: templateWords ?? argv.length };
}

/**
 * Everything needed to start an agent: its argv, env, and stdin. `args` are
 * the words after the agent name with subc's own flags already removed;
 * `prompt` is set for a headless run. `templateWords` counts the leading argv
 * words that came from the template, the only ones a runbook may rewrite.
 */
export function launchPlan(agent, { env, args = [], prompt } = {}) {
  const headless = prompt !== undefined;
  const { launch } = agent;
  const words =
    !headless && launch.mode_word && args[0] === launch.mode_word
      ? args.slice(1)
      : args;
  const { values, rest } = takeFlags(agent, words);
  const resolved = resolveAgentEnv(agent, resolveInputs(agent, env, values));
  const template = headless ? launch.headless_argv : launch.argv;
  const { argv, templateWords } = expandArgv(
    agent,
    template,
    resolved,
    rest,
    prompt,
  );
  if (!headless)
    return { argv, env: resolved, stdin: 'inherit', templateWords };
  if (!launch.headless_stdin)
    return { argv, env: resolved, stdin: 'ignore', templateWords };
  const input = render(launch.headless_stdin, agent, resolved, { prompt });
  return { argv, env: resolved, stdin: 'pipe', input, templateWords };
}
