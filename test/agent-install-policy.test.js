import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const registry = JSON.parse(
  readFileSync(new URL('../agents/registry.json', import.meta.url), 'utf8'),
);

const THIRD_PARTY = new Set([
  'claude-code',
  'codex',
  'opencode',
  'deepseek-harness',
  'aider',
]);

test('subc never ships third-party pipe-to-shell install commands', () => {
  for (const agent of registry.agents) {
    if (!THIRD_PARTY.has(agent.id)) continue;
    const commands = agent.install
      ? Object.values(agent.install).filter((v) => typeof v === 'string')
      : [];
    for (const command of commands) {
      // Display-only, actionable package-manager commands — never piping a
      // remote script into a shell.
      assert.doesNotMatch(command, /\|\s*(ba)?sh\b/, `${agent.id}: ${command}`);
      assert.doesNotMatch(command, /\|\s*iex\b/, `${agent.id}: ${command}`);
      assert.doesNotMatch(command, /irm\s+http/i, `${agent.id}: ${command}`);
      assert.doesNotMatch(command, /curl.*\|/, `${agent.id}: ${command}`);
    }
  }
});

test('third-party agents with a binary carry an official install URL', () => {
  for (const agent of registry.agents) {
    if (!THIRD_PARTY.has(agent.id)) continue;
    assert.ok(agent.bin, `${agent.id} should declare a bin`);
    assert.ok(
      agent.install && typeof agent.install === 'object',
      `${agent.id} should have a per-OS install object`,
    );
    assert.match(
      agent.installUrl || '',
      /^https:\/\//,
      `${agent.id} installUrl`,
    );
  }
});

test('only first-party agents may declare a binary install script', () => {
  for (const agent of registry.agents) {
    if (agent.runbook?.binaryInstallScript) {
      assert.equal(
        agent.id,
        'subconscious-code',
        `${agent.id} must not be auto-installed by subc`,
      );
    }
  }
});
