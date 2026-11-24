#!/usr/bin/env node

/**
 * The adapter behind T3 Code's "Subconscious (OpenCode)" provider; see
 * `t3-plan.js`. The version check runs the real OpenCode unchanged. The
 * helper (`serve --hostname=H --port=P`) gets the Subconscious launch.
 * `serve --service`, `serve
 * --stdio`, `upgrade`, and every other command are refused: the first starts
 * OpenCode's shared background service, and the second is another protocol.
 */

import { runAdapter } from './t3-plan.js';
import { OPENCODE_PROVIDER } from './t3-providers.js';

const HELP_OR_VERSION = new Set(['-h', '--help', '-v', '--version']);
const SERVE_HELP = new Set(['-h', '--help']);
// The `serve` flags that T3 Code passes or could pass. Each one takes a
// value, in `--flag=value` or `--flag value` form.
const SERVE_VALUE_FLAGS = new Set([
  '--hostname',
  '--port',
  '--cors',
  '--log-level',
]);
const PRINT_LOGS = new Set([
  '--print-logs',
  '--print-logs=true',
  '--print-logs=false',
]);

/** True when `args` holds only the serve flags that the launch allows. */
function knownServeFlags(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (PRINT_LOGS.has(arg)) continue;
    const equals = arg.indexOf('=');
    if (equals > 0) {
      if (!SERVE_VALUE_FLAGS.has(arg.slice(0, equals))) return false;
      continue;
    }
    if (!SERVE_VALUE_FLAGS.has(arg)) return false;
    const value = args[++i];
    if (value === undefined || value.startsWith('-')) return false;
  }
  return true;
}

/** `configured`, `passthrough`, or `unsupported` for one OpenCode command line. */
function classifyOpenCodeArgs(args) {
  if (args.length === 1 && HELP_OR_VERSION.has(args[0])) return 'passthrough';
  if (args[0] !== 'serve') return 'unsupported';
  const rest = args.slice(1);
  if (rest.length === 1 && SERVE_HELP.has(rest[0])) return 'passthrough';
  return knownServeFlags(rest) ? 'configured' : 'unsupported';
}

runAdapter(OPENCODE_PROVIDER, classifyOpenCodeArgs, 't3OpenCodePlan');
