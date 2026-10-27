import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Where Claude Code keeps its config, for `subc sessions`. subc itself never
// moves Claude's config: a launch runs on the folder plain `claude` uses
// (~/.claude, or the user's own CLAUDE_CONFIG_DIR), and all Subconscious
// routing, credentials and model pinning ride the launch env and --settings,
// which persist nothing. Claude Code writes plan files, sessions, memories
// and skills where it always does.

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
