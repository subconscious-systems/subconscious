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
 * name, so the other env names in `settings` stay and subc's names win.
 */
export function withSubcSettings(settings, extra) {
  const merged = { ...settings, ...extra };
  if (extra.env)
    merged.env = {
      ...(isPlainObject(settings.env) ? settings.env : {}),
      ...extra.env,
    };
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
