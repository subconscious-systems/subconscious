import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Where Claude Code keeps its config, for `subc sessions` and for notices
// about the retired isolation dir. subc itself never moves Claude's config:
// a launch runs on the folder plain `claude` uses (~/.claude, or the user's
// own CLAUDE_CONFIG_DIR), and all Subconscious routing, credentials and model
// pinning ride the launch env and --settings, which persist nothing. Claude
// Code writes plan files, sessions, memories and skills where it always does.
//
// subc 6.3 instead pointed sessions at ~/.subconscious/claude-code, an
// isolated config dir sharing ~/.claude through symlinks. Claude Code
// >=2.1.280 judges every model-driven write by where it resolves, so writes
// that landed in ~/.claude through those links prompted or failed
// (https://github.com/anthropics/claude-code/issues/98044). That dir is a
// leftover now: nothing writes it, and `subc claude uninstall` removes it.

/** Whether `folder` is one Claude Code has used: a typo or a code repo is not. */
function looksLikeClaudeConfig(folder) {
  return ['settings.json', '.claude.json', 'projects'].some((name) =>
    fs.existsSync(path.join(folder, name)),
  );
}

/**
 * The Claude config folder plain `claude` uses: the user's CLAUDE_CONFIG_DIR
 * when it names a Claude config folder, else ~/.claude. subc sessions run
 * there too, so `subc sessions` reads the same set of sessions.
 *
 * @param {{ env?: Record<string, string | undefined>, home?: string }} [options]
 * @returns {string}
 */
export function claudeSourceDir({
  env = process.env,
  home = os.homedir(),
} = {}) {
  const own = env.CLAUDE_CONFIG_DIR?.trim();
  if (own && path.isAbsolute(own) && looksLikeClaudeConfig(own)) return own;
  return path.join(home, '.claude');
}

/**
 * The config dir subc 6.3 prepared for Claude Code and pointed sessions at:
 * $SUBC_CONFIG_DIR/claude-code, else ~/.subconscious/claude-code.
 *
 * @param {{ env?: Record<string, string | undefined>, home?: string }} [options]
 * @returns {string}
 */
export function legacyClaudeConfigDir({
  env = process.env,
  home = os.homedir(),
} = {}) {
  const base = env.SUBC_CONFIG_DIR?.trim() || path.join(home, '.subconscious');
  return path.join(base, 'claude-code');
}

/**
 * A launch-time warning about the leftover 6.3 isolated config dir, or null
 * when there is nothing to say. The dir is inert after 6.4, but its entries
 * link into ~/.claude, so point the user at `subc claude uninstall` instead
 * of letting a manual `rm -r` follow them.
 *
 * @param {{ env?: Record<string, string | undefined>, home?: string }} [options]
 * @returns {string | null}
 */
export function legacyClaudeDirNotice({
  env = process.env,
  home = os.homedir(),
} = {}) {
  const dir = legacyClaudeConfigDir({ env, home });
  if (!looksLikeClaudeConfig(dir)) return null;
  return `${dir} is the isolated Claude config subc 6.3 made; subc no longer uses it. Remove it with: subc claude uninstall.\n`;
}
