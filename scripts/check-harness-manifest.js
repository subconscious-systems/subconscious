#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { checkHarnessManifestChange } from './lib/harness-manifest-check.js';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function parseArgs(argv) {
  const index = argv.indexOf('--base');
  return {
    base: index === -1 ? 'origin/main' : argv[index + 1],
    head: process.env.HEAD_SHA || 'HEAD',
  };
}

const { base, head } = parseArgs(process.argv.slice(2));
if (!base) {
  console.error('usage: check-harness-manifest.js [--base <ref>]');
  process.exit(2);
}

let changedFiles;
let commitMessages;
try {
  changedFiles = git(['diff', '--name-only', `${base}...${head}`])
    .split('\n')
    .filter(Boolean);
  commitMessages = git(['log', '--format=%B%x00', `${base}..${head}`])
    .split('\0')
    .filter((text) => text.trim());
} catch (error) {
  console.error(`Could not compare ${base} with ${head}: ${error.message}`);
  process.exit(2);
}

// The PR description arrives through the environment so it is never
// interpolated into a shell command.
const messages = [...commitMessages, process.env.PR_BODY ?? ''];
const result = checkHarnessManifestChange({ changedFiles, messages });
(result.ok ? console.log : console.error)(result.message);
process.exit(result.ok ? 0 : 1);
