// The one rule for the --settings value that every Claude Code launch
// passes: plain subc claude (interactive, headless, resume, handoff, and
// Windows) and the T3 Code provider.

// The env names that a launch pins in the --settings value. Claude Code
// applies the `env` of every settings source it loads, and a repo's
// .claude/settings.json or the user's ~/.claude/settings.json can set these
// names. The flag's settings win over both, so the key goes only to the
// gateway of the launch. Neither value is a secret, so the argv stays free
// of the key. The --settings entry in bin/runbook/claude-code/agent.json
// lists the same names.
export const CLAUDE_PINNED_SETTINGS_ENV = Object.freeze([
  'ANTHROPIC_BASE_URL',
  'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
]);

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
 * when the launch has no ANTHROPIC_BASE_URL, or when a pinned value holds
 * `apiKey`, because the block goes in the argv.
 */
export function claudeGatewayPin(env, apiKey) {
  const pinned = {};
  for (const name of CLAUDE_PINNED_SETTINGS_ENV) {
    const value = env[name];
    if (!value) continue;
    if (apiKey && value.includes(apiKey))
      throw new ClaudeSettingsError(
        `${name} holds the API key, so it cannot go in the Claude Code argv. Check the profile.`,
      );
    pinned[name] = value;
  }
  if (!pinned.ANTHROPIC_BASE_URL)
    throw new ClaudeSettingsError(
      'The claude-code launch has no ANTHROPIC_BASE_URL. Update subc.',
    );
  return pinned;
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
