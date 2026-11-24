#!/usr/bin/env node

/**
 * The adapter behind T3 Code's "Subconscious (Codex)" provider; see
 * `t3-plan.js`. A session (`app-server`) and a one-shot run (`exec`) get the
 * Subconscious launch. A capability query (`--version`, help, `mcp list`)
 * runs the real Codex unchanged. Any other command is refused.
 */

import { runAdapter } from './t3-plan.js';
import { CODEX_PROVIDER } from './t3-providers.js';

// Codex root options that take a value, so their value is not the command.
const ROOT_VALUE_OPTIONS = new Set([
  '-c',
  '--config',
  '--enable',
  '--disable',
  '--remote',
  '--remote-auth-token-env',
  '-i',
  '--image',
  '-m',
  '--model',
  '--local-provider',
  '-p',
  '--profile',
  '-s',
  '--sandbox',
  '-C',
  '--cd',
  '--add-dir',
  '-a',
  '--ask-for-approval',
]);
const APP_SERVER_VALUE_OPTIONS = new Set([
  '-c',
  '--config',
  '--enable',
  '--disable',
  '--startup-client-info',
  '--cloud-skills-snapshot',
  '--code-mode-host',
  '--listen',
]);
const HELP_OR_VERSION = new Set(['-h', '--help', '-V', '--version']);
const APP_SERVER_QUERIES = new Set([
  'help',
  'generate-ts',
  'generate-json-schema',
]);
const MCP_QUERIES = new Set(['list', 'get', 'help']);

/** The first word that is not an option, skipping option values. */
function firstPositional(args, valueOptions) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') return { index: -1 };
    if (!arg.startsWith('-') || arg === '-') return { index: i, word: arg };
    if (valueOptions.has(arg)) i++;
  }
  return { index: -1 };
}

function asksForHelpOrVersion(args) {
  const end = args.indexOf('--');
  return (end < 0 ? args : args.slice(0, end)).some((arg) =>
    HELP_OR_VERSION.has(arg),
  );
}

/**
 * `configured`, `passthrough`, or `unsupported` for one Codex command line.
 * The command is the first word after the root options, so a leading
 * `-c key=value` does not hide `mcp list`.
 */
function classifyCodexArgs(args) {
  const { index, word } = firstPositional(args, ROOT_VALUE_OPTIONS);
  if (index < 0)
    return asksForHelpOrVersion(args) ? 'passthrough' : 'unsupported';
  const rest = args.slice(index + 1);
  if (word === 'help') return 'passthrough';
  if (word === 'app-server') {
    if (asksForHelpOrVersion(rest)) return 'passthrough';
    const sub = firstPositional(rest, APP_SERVER_VALUE_OPTIONS);
    if (sub.index < 0) return 'configured';
    return APP_SERVER_QUERIES.has(sub.word) ? 'passthrough' : 'unsupported';
  }
  if (word === 'exec' || word === 'e')
    return asksForHelpOrVersion(rest) ? 'passthrough' : 'configured';
  if (word === 'mcp') {
    if (asksForHelpOrVersion(rest)) return 'passthrough';
    const sub = firstPositional(rest, new Set());
    return MCP_QUERIES.has(sub.word) ? 'passthrough' : 'unsupported';
  }
  return 'unsupported';
}

runAdapter(CODEX_PROVIDER, classifyCodexArgs, 't3CodexPlan');
