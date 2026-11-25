import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AGENTS, agentById, agentInputs } from '../bin/agent-data.js';
import { launchPlan, resolveInputs, takeFlags } from '../bin/agent-launch.js';

const environment = {
  GATEWAY_URL: 'https://gateway.example',
  API_KEY: 'sk-test',
  MODEL: 'subconscious/test',
};

test('declared integer inputs reject malformed values before launching', () => {
  for (const agent of AGENTS) {
    for (const input of agentInputs(agent).filter(
      (input) => input.type === 'integer',
    )) {
      for (const value of ['oops', '1.5', '9007199254740992']) {
        assert.throws(
          () => resolveInputs(agent, { ...environment, [input.name]: value }),
          (error) => error.message.includes(input.name),
          `${agent.id} ${input.name}=${value}`,
        );
      }
    }
  }
});

test('launch plans enforce declared bounds while keeping valid zero and aliases', () => {
  const claude = agentById('claude-code');
  for (const value of ['99999', '1000001']) {
    assert.throws(
      () =>
        launchPlan(claude, {
          env: environment,
          args: ['--compact-window', value],
        }),
      /compact-window/,
    );
  }
  const resolved = resolveInputs(claude, {
    ...environment,
    COMPACT_WINDOW: '100000',
    MAX_SUBAGENT_SPAWN_DEPTH: '0',
  });
  assert.equal(resolved.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '100000');
  assert.equal(resolved.MAX_SUBAGENT_SPAWN_DEPTH, '0');
  assert.doesNotThrow(() =>
    resolveInputs(
      claude,
      { ...environment, MAX_SUBAGENT_SPAWN_DEPTH: 'oops' },
      {},
      { strict: false },
    ),
  );
});

test('missing flag values cannot consume another option or a separator', () => {
  const agent = agentById('claude-code');
  for (const next of ['--gateway-url', '--continue', '--']) {
    assert.throws(
      () => takeFlags(agent, ['--api-key', next]),
      /--api-key requires a value/,
    );
  }
  assert.deepEqual(
    takeFlags(agent, ['--api-key=--literal', '--', '--continue']),
    { values: { CLAUDE_CODE_API_KEY: '--literal' }, rest: ['--continue'] },
  );
});
