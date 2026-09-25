import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MIN_CLAUDE_CODE_VERSION,
  claudeVersionNeedsUpgrade,
  parseClaudeVersion,
  readClaudeVersion,
} from '../bin/agents.js';

test('parseClaudeVersion reads the official Claude Code banner', () => {
  assert.equal(parseClaudeVersion('2.1.259 (Claude Code)\n'), '2.1.259');
  assert.equal(parseClaudeVersion('v2.1.242'), '2.1.242');
  assert.equal(parseClaudeVersion('@anthropic-ai/claude-code/2.1.180'), '2.1.180');
  assert.equal(parseClaudeVersion('not a version'), null);
});

test('claudeVersionNeedsUpgrade treats the model-picker floor as inclusive', () => {
  assert.equal(claudeVersionNeedsUpgrade('2.1.241', MIN_CLAUDE_CODE_VERSION), true);
  assert.equal(claudeVersionNeedsUpgrade('2.1.242', MIN_CLAUDE_CODE_VERSION), false);
  assert.equal(claudeVersionNeedsUpgrade('2.1.259', MIN_CLAUDE_CODE_VERSION), false);
  assert.equal(claudeVersionNeedsUpgrade(null, MIN_CLAUDE_CODE_VERSION), false);
});

test('readClaudeVersion uses the resolved binary and fails open', () => {
  const calls = [];
  const version = readClaudeVersion('claude', '/tmp/claude-bin', {
    execFileSync(bin, args, options) {
      calls.push({ bin, args, path: options.env.PATH });
      return '2.1.180 (Claude Code)\n';
    },
  });
  assert.equal(version, '2.1.180');
  assert.equal(calls[0].bin, 'claude');
  assert.deepEqual(calls[0].args, ['--version']);
  assert.match(calls[0].path, /^\/tmp\/claude-bin/);

  assert.equal(
    readClaudeVersion('claude', '/missing', {
      execFileSync() {
        throw new Error('not found');
      },
    }),
    null,
  );
});
