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
  const end = args.indexOf('--');
  const options = end < 0 ? args : args.slice(0, end);
  return options.some(isProtocolFlag) ? 'configured' : 'unsupported';
}

runAdapter(CLAUDE_PROVIDER, classifyClaudeArgs, 't3ClaudePlan');
