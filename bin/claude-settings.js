// The one rule for the --settings value that every Claude Code launch
// passes: plain subc claude (interactive, headless, resume, handoff, and
// Windows) and the T3 Code provider.

// A launch pins ANTHROPIC_BASE_URL in the env of its --settings value.
// Claude Code applies the `env` of every settings source it loads, and a
// repo's .claude/settings.json or the user's ~/.claude/settings.json can set
// it. The flag's settings win over both, so the key goes only to the gateway
// of the launch. The URL is not a secret, so the argv stays free of the key.

export class ClaudeSettingsError extends Error {}

const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * `settings` with subc's keys from `extra` on top. `env` is merged name by
 * name, so the other env names in `settings` stay and subc's names win. A
 * name in `settings.env` that `dropEnv` matches is removed first.
 */
export function withSubcSettings(settings, extra, dropEnv = () => false) {
  const merged = { ...settings, ...extra };
  if (extra.env) {
    const own = isPlainObject(settings.env) ? settings.env : {};
    merged.env = Object.fromEntries(
      Object.entries(own).filter(([name]) => !dropEnv(name)),
    );
    Object.assign(merged.env, extra.env);
  }
  return merged;
}

/**
 * The pinned env block for a launch whose resolved env is `env`. It throws
 * when the launch has no ANTHROPIC_BASE_URL, or when the URL holds `apiKey`,
 * because the block goes in the argv.
 */
export function claudeGatewayPin(env, apiKey) {
  const url = env.ANTHROPIC_BASE_URL;
  if (!url)
    throw new ClaudeSettingsError(
      'The claude-code launch has no ANTHROPIC_BASE_URL. Update subc.',
    );
  if (apiKey && url.includes(apiKey))
    throw new ClaudeSettingsError(
      'ANTHROPIC_BASE_URL holds the API key, so it cannot go in the Claude Code argv. Check the profile.',
    );
  return { ANTHROPIC_BASE_URL: url };
}

/**
 * The --settings JSON for a launch: `settingsJson` (the model picker, or
 * any JSON object) with the gateway pinned in its `env`. `env` is the
 * launch's resolved env, and its ANTHROPIC_AUTH_TOKEN is the key.
 */
export function pinnedClaudeSettings(settingsJson, env) {
  let settings = {};
  if (settingsJson) {
    try {
      settings = JSON.parse(settingsJson);
    } catch {
      settings = null;
    }
    if (!isPlainObject(settings))
      throw new ClaudeSettingsError(
        'SUBC_CLAUDE_SETTINGS must be a JSON object. The value is not shown, because it can hold secrets.',
      );
  }
  const apiKey = env.ANTHROPIC_AUTH_TOKEN || env.API_KEY;
  return JSON.stringify(
    withSubcSettings(settings, { env: claudeGatewayPin(env, apiKey) }),
  );
}

const SETTINGS_UNREADABLE =
  'Claude Code got a --settings value that is not a JSON object. subc merges its gateway pin into that value, so pass settings as JSON, not a file path. The value is not shown, because it can hold secrets.';

/**
 * Merge `extra` into the last `--settings` value before any `--` in `args`,
 * which is the value Claude Code uses. With none, add one there, unless
 * `add` is false. `dropEnv` removes names from that value's `env`. A value
 * that is not a JSON object, such as a file path, stops the launch.
 */
export function mergeClaudeSettings(args, extra, { add = true, dropEnv } = {}) {
  let end = args.indexOf('--');
  if (end < 0) end = args.length;
  let last = -1;
  for (let i = 0; i < end; i++)
    if (args[i] === '--settings' || args[i].startsWith('--settings=')) last = i;
  if (last < 0) {
    if (!add) return args;
    return [
      ...args.slice(0, end),
      '--settings',
      JSON.stringify(extra),
      ...args.slice(end),
    ];
  }
  const inline = args[last] !== '--settings';
  const value = inline ? args[last].slice(11) : args[last + 1];
  let settings;
  try {
    settings = JSON.parse(value ?? '');
  } catch {
    throw new ClaudeSettingsError(SETTINGS_UNREADABLE);
  }
  if (!isPlainObject(settings))
    throw new ClaudeSettingsError(SETTINGS_UNREADABLE);
  return [
    ...args.slice(0, last),
    '--settings',
    JSON.stringify(withSubcSettings(settings, extra, dropEnv)),
    ...args.slice(last + (inline ? 1 : 2)),
  ];
}
