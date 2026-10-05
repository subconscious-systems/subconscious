import assert from 'node:assert/strict';
import test from 'node:test';
import { agentById } from '../bin/agent-data.js';
import {
  configArgs,
  launchPlan,
  render,
  resolveAgentEnv,
  resolveInputs,
  takeFlags,
} from '../bin/agent-launch.js';

const codex = agentById('codex');
const claude = agentById('claude-code');
const base = {
  GATEWAY_URL: 'https://gateway.example',
  API_KEY: 'sk-shared',
  MODEL: 'subconscious/glm-5.3-marathon',
  SUBCONSCIOUS_MODELS: 'subconscious/glm-5.3-marathon',
  SUBC_CLAUDE_SETTINGS: '{"availableModels":[]}',
};

test('flags take a value, an = value, or set a fixed value, until --', () => {
  const { values, rest } = takeFlags(codex, [
    'resume',
    '--context-window',
    '10',
    '--reasoning-effort=low',
    '--external-tools',
    '--',
    '--max-subagents',
    '9',
    '--',
  ]);
  assert.deepEqual(values, {
    CODEX_CONTEXT_WINDOW: '10',
    CODEX_REASONING_EFFORT: 'low',
    CODEX_EXTERNAL_TOOLS: 'true',
  });
  assert.deepEqual(rest, ['resume', '--max-subagents', '9', '--']);
  assert.throws(
    () => takeFlags(codex, ['--context-window']),
    /requires a value/,
  );
  assert.throws(
    () => takeFlags(codex, ['--external-tools=yes']),
    /does not take a value/,
  );
  assert.deepEqual(takeFlags(codex, ['--subagent-effort', '']).values, {
    CODEX_SUBAGENT_REASONING_EFFORT: '',
  });
});

test('inputs fall back to their defaults, in file order, with references', () => {
  const env = resolveInputs(codex, { ...base, CODEX_CONTEXT_WINDOW: '' });
  assert.equal(env.CODEX_CONTEXT_WINDOW, '5000000');
  assert.equal(env.CODEX_MAX_CONTEXT_WINDOW, '5000000');
  assert.equal(env.MAX_CONCURRENT_SUBAGENTS, '4');
  const flagged = resolveInputs(codex, base, { CODEX_CONTEXT_WINDOW: '700' });
  assert.equal(flagged.CODEX_MAX_CONTEXT_WINDOW, '700');
  assert.equal(
    base.CODEX_CONTEXT_WINDOW,
    undefined,
    'input env is not mutated',
  );
});

test('an empty value opts out only where the input keeps it', () => {
  const env = resolveInputs(codex, {
    ...base,
    CODEX_MULTI_AGENT_VERSION: '',
    CODEX_REASONING_EFFORT: '',
  });
  assert.equal(env.CODEX_MULTI_AGENT_VERSION, '');
  assert.equal(env.CODEX_REASONING_EFFORT, 'max');
});

test('aliases and UNSET words resolve before the default', () => {
  const env = resolveInputs(claude, {
    ...base,
    COMPACT_WINDOW: '300000',
    CLAUDE_CODE_SUBAGENT_MODEL: 'UNSET',
  });
  assert.equal(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '300000');
  assert.equal(env.CLAUDE_CODE_SUBAGENT_MODEL, base.MODEL);
});

test('a strict input rejects a value outside its choices', () => {
  assert.throws(
    () => resolveInputs(codex, { ...base, CODEX_REASONING_EFFORT: 'huge' }),
    /--reasoning-effort must be one of: none, low, medium, high, max/,
  );
});

test('env entries take the first set override, else their value', () => {
  const env = resolveAgentEnv(
    claude,
    resolveInputs(claude, {
      ...base,
      CLAUDE_GATEWAY_URL: 'https://claude.example//',
      OTEL_LOGS_EXPORTER: 'none',
      CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
      CLAUDE_CODE_API_KEY: 'sk-claude',
    }),
  );
  assert.equal(env.ANTHROPIC_BASE_URL, 'https://claude.example//');
  assert.equal(
    env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,
    'https://claude.example/v1/logs',
  );
  assert.equal(env.OTEL_LOGS_EXPORTER, 'none');
  assert.equal(env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, '0');
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'sk-claude');
  assert.equal(env.OTEL_EXPORTER_OTLP_HEADERS, 'x-api-key=sk-claude');
});

test('config overrides follow their conditions', () => {
  const names = (env) =>
    configArgs(codex, resolveInputs(codex, { ...base, ...env }))
      .filter((_, index) => index % 2 === 1)
      .map((pair) => pair.split('=')[0]);
  const defaults = names({});
  assert.ok(defaults.includes('features.apps'));
  assert.ok(defaults.includes('agents.default_subagent_reasoning_effort'));
  assert.ok(!defaults.includes('agents.enabled'));
  assert.ok(!names({ CODEX_EXTERNAL_TOOLS: 'true' }).includes('features.apps'));
  const off = names({ CODEX_MULTI_AGENT_VERSION: '' });
  assert.ok(off.includes('agents.enabled'));
  assert.ok(!off.includes('agents.max_concurrent_threads_per_session'));
});

test('a placeholder in a prompt or argument is passed through untouched', () => {
  const prompt = 'use {model} and ${API_KEY} and {tempFile}';
  const plan = launchPlan(claude, {
    env: base,
    args: ['{model}'],
    prompt,
  });
  assert.equal(plan.argv.at(-1), prompt);
  assert.ok(plan.argv.includes('{model}'));
  assert.equal(plan.stdin, 'ignore');
});

test('a stdin agent gets the prompt on stdin, after its template words', () => {
  const dsh = agentById('deepseek-harness');
  const plan = launchPlan(dsh, { env: base, args: ['--json'], prompt: '- x' });
  assert.deepEqual(plan.argv, [
    'dsh',
    '--profile',
    'headless',
    '--patch',
    '{tempFile}',
    '--json',
  ]);
  assert.equal(plan.stdin, 'pipe');
  assert.equal(plan.input, '- x');
  assert.equal(plan.templateWords, 5);
  const web = launchPlan(dsh, { env: base, args: ['web', '--port', '1'] });
  assert.deepEqual(web.argv, [
    'dsh',
    'web',
    '--patch',
    '{tempFile}',
    '--port',
    '1',
  ]);
});

test('an unknown placeholder is an error, not silent text', () => {
  assert.throws(() => render('{nope}', codex, base), /\{nope\} has no value/);
  assert.equal(
    render('{baseUrlV1}', codex, base),
    'https://gateway.example/v1',
  );
});
