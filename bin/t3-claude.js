#!/usr/bin/env node

/**
 * The adapter behind T3 Code's "Subconscious (Claude)" provider; see
 * `t3-plan.js`. The version check runs the real Claude Code unchanged. The
 * SDK probe, sessions (stream-json), and text generation (`-p`) get the
 * Subconscious launch. T3 Code adds session flags between releases, so a
 * launch is recognized by its protocol flags alone. Any other command is
 * refused.
 */

import { runAdapter } from './t3-plan.js';
import { CLAUDE_PROVIDER } from './t3-providers.js';

const HELP_OR_VERSION = new Set(['-h', '--help', '-v', '--version']);
const PROTOCOL_FLAGS = new Set([
  '--input-format',
  '--output-format',
  '-p',
  '--print',
]);

// Claude Code 2.1.331's subcommands, from `claude --help`. Each one does
// something other than run a session, such as sign in or add a plugin.
const SUBCOMMANDS = new Set([
  'agents',
  'attach',
  'auth',
  'auto-mode',
  'doctor',
  'gateway',
  'import',
  'install',
  'kill',
  'logs',
  'mcp',
  'plugin',
  'plugins',
  'purge',
  'respawn',
  'rm',
  'setup-token',
  'stop',
  'ultrareview',
  'update',
  'upgrade',
]);
// Root options that take a value, so the next word is that value, not a
// subcommand. An unknown option's value counts as a word, which can only
// refuse a launch, never let a subcommand through.
const VALUE_OPTIONS = new Set([
  '--add-dir',
  '--agent',
  '--agents',
  '--allowedTools',
  '--allowed-tools',
  '--append-system-prompt',
  '--autocompact',
  '--betas',
  '--cloud',
  '-d',
  '--debug',
  '--debug-file',
  '--disallowedTools',
  '--disallowed-tools',
  '--effort',
  '--environment',
  '--fallback-model',
  '--file',
  '--from-pr',
  '--input-format',
  '--json-schema',
  '--max-budget-usd',
  '--mcp-config',
  '--model',
  '-n',
  '--name',
  '--output-format',
  '--permission-mode',
  '--permission-prompts',
  '--plugin-dir',
  '--plugin-url',
  '--prompt-suggestions',
  '--remote-control',
  '--remote-control-session-name-prefix',
  '-r',
  '--resume',
  '--session-id',
  '--setting-sources',
  '--settings',
  '--system-prompt',
  '--system-prompt-snapshot',
  '--teleport',
  '--tools',
  '-w',
  '--worktree',
]);

/** True when a word in `options` that is not an option value names a subcommand. */
function namesSubcommand(options) {
  for (let i = 0; i < options.length; i++) {
    const arg = options[i];
    if (arg.startsWith('-')) {
      const next = options[i + 1];
      if (VALUE_OPTIONS.has(arg) && next !== undefined && !next.startsWith('-'))
        i++;
      continue;
    }
    if (SUBCOMMANDS.has(arg)) return true;
  }
  return false;
}

function isProtocolFlag(arg) {
  return (
    PROTOCOL_FLAGS.has(arg) ||
    arg.startsWith('--input-format=') ||
    arg.startsWith('--output-format=')
  );
}

/** `configured`, `passthrough`, or `unsupported` for one Claude command line. */
function classifyClaudeArgs(args) {
  if (args.length && args.every((arg) => HELP_OR_VERSION.has(arg)))
    return 'passthrough';
  if (
    args[0] === 'update' &&
    args.slice(1).every((arg) => HELP_OR_VERSION.has(arg))
  )
    return 'passthrough';
  // T3 Code starts every launch with a flag. A first word that is not one
  // is a subcommand, such as `auth login --print`.
  if (!args[0]?.startsWith('-')) return 'unsupported';
  const end = args.indexOf('--');
  const options = end < 0 ? args : args.slice(0, end);
  if (namesSubcommand(options)) return 'unsupported';
  return options.some(isProtocolFlag) ? 'configured' : 'unsupported';
}

runAdapter(CLAUDE_PROVIDER, classifyClaudeArgs, 't3ClaudePlan');
