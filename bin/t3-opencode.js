#!/usr/bin/env node

/**
 * The adapter behind T3 Code's "Subconscious (OpenCode)" provider; see
 * `t3-plan.js`. The helper (`serve` and its flags) gets the Subconscious
 * launch. `--version` and `--help` run the real OpenCode unchanged. Every
 * other command is refused.
 */

import { runAdapter } from './t3-plan.js';
import { OPENCODE_PROVIDER } from './t3-providers.js';

const HELP_OR_VERSION = new Set(['-h', '--help', '-v', '--version']);

/** `configured`, `passthrough`, or `unsupported` for one OpenCode command line. */
function classifyOpenCodeArgs(args) {
  if (args.length === 1 && HELP_OR_VERSION.has(args[0])) return 'passthrough';
  return args[0] === 'serve' ? 'configured' : 'unsupported';
}

runAdapter(OPENCODE_PROVIDER, classifyOpenCodeArgs, 't3OpenCodePlan');
