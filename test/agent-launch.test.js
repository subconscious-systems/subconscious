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
import { runbookEnv } from '../bin/agents.js';
import { CLAUDE_PINNED_SETTINGS_ENV } from '../bin/claude-settings.js';
import { handoffLaunchArgs, nativeResumeArgs } from '../bin/sessions.js';

const codex = agentById('codex');
const claude = agentById('claude-code');
const base = {
  GATEWAY_URL: 'https://gateway.example',
  API_KEY: 'sk-shared',
  MODEL: 'subconscious/glm-5.3-marathon',
  SUBCONSCIOUS_MODELS: 'subconscious/glm-5.3-marathon',
  SUBC_CLAUDE_SETTINGS: '{"availableModels":[]}',
};
// base.SUBC_CLAUDE_SETTINGS with the launch gateway pinned in its env.
const PINNED_SETTINGS = JSON.stringify({
  availableModels: [],
  env: {
    ANTHROPIC_BASE_URL: 'https://gateway.example',
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'https://gateway.example/v1/logs',
  },
});

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

test('a strict input rejects a value outside its choices, naming its source', () => {
  const choices = 'none, low, medium, high, max';
  assert.throws(
    () => resolveInputs(codex, { ...base, CODEX_REASONING_EFFORT: 'huge' }),
    new RegExp(`^Error: CODEX_REASONING_EFFORT must be one of: ${choices}$`),
  );
  assert.throws(
    () => resolveInputs(codex, base, { CODEX_REASONING_EFFORT: 'huge' }),
    /--reasoning-effort must be one of/,
  );
  const lenient = resolveInputs(
    codex,
    { ...base, CODEX_REASONING_EFFORT: 'huge' },
    {},
    { strict: false },
  );
  assert.equal(lenient.CODEX_REASONING_EFFORT, 'huge');
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

test('claude-code drops the mutating attribution header, unless the user keeps it', () => {
  const on = resolveAgentEnv(claude, resolveInputs(claude, { ...base }));
  assert.equal(on.CLAUDE_CODE_ATTRIBUTION_HEADER, '0');
  const kept = resolveAgentEnv(
    claude,
    resolveInputs(claude, { ...base, CLAUDE_CODE_ATTRIBUTION_HEADER: '1' }),
  );
  assert.equal(kept.CLAUDE_CODE_ATTRIBUTION_HEADER, '1');
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
  // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal placeholder
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

// Pinned by hand, so a template edit in an agent file has to be deliberate.
test('every headless agent runs exactly this argv and stdin', () => {
  const model = base.MODEL;
  const codexConfig = [
    `model=${model}`,
    'model_provider=subconscious',
    'model_catalog_json={tempFile}',
    'model_reasoning_effort=max',
    'web_search=disabled',
    'features.apps=false',
    'features.plugins=false',
    'apps._default.enabled=false',
    'agents.max_concurrent_threads_per_session=4',
    'agents.interrupt_message=true',
    'agents.default_subagent_reasoning_effort=low',
    'model_providers.subconscious.name=Subconscious',
    'model_providers.subconscious.base_url=https://gateway.example/v1',
    'model_providers.subconscious.wire_api=responses',
    'model_providers.subconscious.env_key=SUBCONSCIOUS_API_KEY',
    'model_providers.subconscious.stream_idle_timeout_ms=900000',
  ].flatMap((pair) => ['-c', pair]);
  const expected = {
    'claude-code': {
      argv: ['claude', '--settings', PINNED_SETTINGS, '--x', '-p', '--', 'P'],
      stdin: 'ignore',
    },
    codex: {
      argv: [
        'codex',
        ...codexConfig,
        'exec',
        '--skip-git-repo-check',
        '--x',
        '--',
        'P',
      ],
      stdin: 'ignore',
    },
    opencode: {
      argv: ['opencode', 'run', '--standalone', '--x'],
      stdin: 'pipe',
    },
    pi: {
      argv: [
        'pi',
        '--provider',
        'subconscious',
        '--model',
        model,
        '--print',
        '--x',
      ],
      stdin: 'pipe',
    },
    'deepseek-harness': {
      argv: ['dsh', '--profile', 'headless', '--patch', '{tempFile}', '--x'],
      stdin: 'pipe',
    },
  };
  for (const [id, want] of Object.entries(expected)) {
    const plan = launchPlan(agentById(id), {
      env: base,
      args: ['--', '--x'],
      prompt: 'P',
    });
    assert.deepEqual(plan.argv, want.argv, id);
    assert.equal(plan.stdin, want.stdin, id);
    assert.equal(plan.input, want.stdin === 'pipe' ? 'P' : undefined, id);
  }
});

test('interactive launches run exactly this argv', () => {
  const run = (id, args = []) =>
    launchPlan(agentById(id), { env: base, args }).argv;
  assert.deepEqual(run('claude-code', ['--continue']), [
    'claude',
    '--settings',
    PINNED_SETTINGS,
    '--continue',
  ]);
  assert.deepEqual(run('opencode', ['--', '--continue']), [
    'opencode',
    '--continue',
  ]);
  assert.deepEqual(run('deepseek-harness', ['--port', '1']), [
    'dsh',
    'web',
    '--patch',
    '{tempFile}',
    '--port',
    '1',
  ]);
  assert.equal(
    run('codex').at(-1),
    'model_providers.subconscious.stream_idle_timeout_ms=900000',
  );
});

// The one --settings value of a Claude Code plan, parsed.
function claudeSettings(plan) {
  const at = plan.argv.indexOf('--settings');
  assert.notEqual(at, -1, 'no --settings');
  assert.equal(plan.argv.lastIndexOf('--settings'), at, 'two --settings');
  return JSON.parse(plan.argv[at + 1]);
}

test('every subc claude launch form pins its gateway in --settings', () => {
  const key = 'sk-launch-secret';
  const env = { ...base, API_KEY: key };
  const own = 'https://claude-only.example';
  const flagged = 'https://flag.example';
  const forms = {
    interactive: [{ env, args: [] }, base.GATEWAY_URL],
    headless: [{ env, args: ['--x'], prompt: 'P' }, base.GATEWAY_URL],
    resume: [
      { env, args: nativeResumeArgs({ harness: 'claude', id: 'abc' }) },
      base.GATEWAY_URL,
    ],
    handoff: [
      { env, args: handoffLaunchArgs('claude', 'ctx') },
      base.GATEWAY_URL,
    ],
    CLAUDE_GATEWAY_URL: [{ env: { ...env, CLAUDE_GATEWAY_URL: own } }, own],
    '--gateway-url': [{ env, args: ['--gateway-url', flagged] }, flagged],
  };
  for (const [form, [options, gateway]] of Object.entries(forms)) {
    const plan = launchPlan(claude, options);
    assert.equal(plan.env.ANTHROPIC_BASE_URL, gateway, form);
    assert.deepEqual(
      claudeSettings(plan).env,
      {
        ANTHROPIC_BASE_URL: gateway,
        OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${gateway}/v1/logs`,
      },
      form,
    );
    assert.equal(plan.env.ANTHROPIC_AUTH_TOKEN, key, form);
    assert.ok(!plan.argv.some((word) => word.includes(key)), form);
  }
});

test('the gateway pin merges into the picker and an existing settings env', () => {
  const picker = {
    availableModels: ['m1', 'm2'],
    modelPicker: { replaceBuiltInOptions: true, options: [{ model: 'm1' }] },
    env: { KEEP: 'x', ANTHROPIC_BASE_URL: 'https://evil.example' },
  };
  const plan = launchPlan(claude, {
    env: { ...base, SUBC_CLAUDE_SETTINGS: JSON.stringify(picker) },
  });
  assert.deepEqual(claudeSettings(plan), {
    ...picker,
    env: {
      KEEP: 'x',
      ANTHROPIC_BASE_URL: 'https://gateway.example',
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'https://gateway.example/v1/logs',
    },
  });
  // The picker that runbookEnv builds keeps every key.
  const models = ['subconscious/a', 'subconscious/b'];
  const live = runbookEnv('sk-x', models[0], undefined, null, claude, models);
  const settings = claudeSettings(launchPlan(claude, { env: live }));
  const { env: _pin, ...rest } = settings;
  assert.deepEqual(rest, JSON.parse(live.SUBC_CLAUDE_SETTINGS));
  assert.equal(settings.env.ANTHROPIC_BASE_URL, live.GATEWAY_URL);
});

test('a Claude launch refuses settings it cannot pin', () => {
  assert.throws(
    () =>
      launchPlan(claude, {
        env: { ...base, SUBC_CLAUDE_SETTINGS: 'not json sk-hidden' },
      }),
    (error) =>
      /must be a JSON object/.test(error.message) &&
      !error.message.includes('sk-hidden'),
  );
  assert.throws(
    () =>
      launchPlan(claude, {
        env: { ...base, GATEWAY_URL: 'https://gw.example/sk-shared' },
      }),
    /ANTHROPIC_BASE_URL holds the API key/,
  );
  assert.throws(
    () => launchPlan(claude, { env: { ...base, GATEWAY_URL: '' } }),
    /no ANTHROPIC_BASE_URL/,
  );
});

test('the agent file names the env that the launch pins in --settings', () => {
  const entry = claude.config.find((item) => item.name === '--settings');
  assert.deepEqual(Object.keys(entry.value.env), CLAUDE_PINNED_SETTINGS_ENV);
  for (const [name, value] of Object.entries(entry.value.env))
    assert.equal(value, `\${${name}}`);
});
