import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-codex-test-'));
const fakeCodex = path.join(testDir, 'codex');
const capturedCatalog = path.join(testDir, 'catalog.json');

const capturedArgs = path.join(testDir, 'args.txt');

await fs.writeFile(
  fakeCodex,
  `#!/bin/sh
# Recording the argv is optional: tests that only care about the catalog do not
# set CAPTURED_ARGS, and the stub must not fail them.
[ -n "$CAPTURED_ARGS" ] && : > "$CAPTURED_ARGS"
for arg in "$@"; do
  [ -n "$CAPTURED_ARGS" ] && printf '%s\\n' "$arg" >> "$CAPTURED_ARGS"
  case "$arg" in
    model_catalog_json=*) cp "\${arg#model_catalog_json=}" "$CAPTURED_CATALOG" ;;
  esac
done
`,
  { mode: 0o755 },
);

after(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

test('Codex advertises image input for DeepSeek V4.1 only, selected or in the picker', async () => {
  const visionModel = 'subconscious/deepseek-v4.1-flash-marathon';
  const otherModel = 'subconscious/deepseek-v4-flash-marathon';
  for (const selected of [visionModel, otherModel]) {
    const result = spawnSync('bash', [new URL('../bin/runbook/codex/run.sh', import.meta.url).pathname], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${testDir}:${process.env.PATH}`,
        GATEWAY_URL: 'https://gateway.example', API_KEY: 'sk-test', MODEL: selected,
        SUBCONSCIOUS_MODELS: [otherModel, visionModel, `${visionModel}-other`].join('\n'),
        SUBC_ENV_FILE: os.devNull, CODEX_DIR: path.join(testDir, '.codex'),
        CAPTURED_CATALOG: capturedCatalog,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const catalog = JSON.parse(await fs.readFile(capturedCatalog, 'utf8'));
    assert.equal(catalog.models[0].slug, selected);
    for (const model of catalog.models) {
      assert.deepEqual(model.input_modalities, model.slug === visionModel ? ['text', 'image'] : undefined, model.slug);
    }
  }
});

// Runs the runbook against the stub `codex` above and returns the model catalog
// it generated. `env` overrides are layered on top of the shared defaults.
async function captureCatalog(env = {}) {
  const runbook = new URL('../bin/runbook/codex/run.sh', import.meta.url);
  const result = spawnSync('bash', [runbook.pathname], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${testDir}:${process.env.PATH}`,
      GATEWAY_URL: 'https://gateway.example',
      API_KEY: 'sk-test',
      MODEL: 'subconscious/glm-5.3-marathon',
      SUBC_ENV_FILE: os.devNull,
      CODEX_DIR: path.join(testDir, '.codex'),
      CAPTURED_CATALOG: capturedCatalog,
      CAPTURED_ARGS: capturedArgs,
      ...env,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(await fs.readFile(capturedCatalog, 'utf8'));
}

// The `-c key=value` overrides the runbook handed to Codex on the last launch.
async function captureArgs(env = {}) {
  await captureCatalog(env);
  return (await fs.readFile(capturedArgs, 'utf8')).split('\n').filter(Boolean);
}

test('Codex catalog advertises the configured priority service tier', async () => {
  const catalog = await captureCatalog();
  assert.deepEqual(catalog.models[0].service_tiers, [
    {
      id: 'priority',
      name: 'Priority',
      description: 'Route requests through the configured priority service tier',
    },
  ]);
});

test('Codex catalog enables multi-agent v2 so subagent tools are registered', async () => {
  const catalog = await captureCatalog();
  // This field selects which implementation Codex offers, not whether it
  // offers one: "v2" gives the `collaboration` namespace, while an empty or
  // missing value falls back to the older `multi_agent_v1` namespace, whose
  // tool set this gateway has never been exercised against.
  for (const model of catalog.models) {
    assert.equal(model.multi_agent_version, 'v2', model.slug);
  }
});

test('Codex catalog declares the reasoning levels it accepts', async () => {
  // An empty list means "supports nothing", and Codex validates a subagent's
  // reasoning effort against it, so spawn_agent fails with "Reasoning effort
  // `medium` is not supported ... Supported reasoning efforts:" and no values.
  const catalog = await captureCatalog();
  for (const model of catalog.models) {
    const efforts = (model.supported_reasoning_levels || []).map((l) => l.effort);
    assert.deepEqual(
      efforts,
      ['none', 'low', 'medium', 'high', 'max'],
      `${model.slug} advertised ${JSON.stringify(efforts)}`,
    );
  }
});

test('Codex catalog opts out of responses-lite', async () => {
  const catalog = await captureCatalog();
  // responses-lite makes Codex send an OpenAI-internal header that
  // non-OpenAI backends reject outright.
  for (const model of catalog.models) {
    assert.equal(model.use_responses_lite, false, model.slug);
  }
});

test('CODEX_MULTI_AGENT_VERSION overrides the catalog value', async () => {
  const catalog = await captureCatalog({ CODEX_MULTI_AGENT_VERSION: 'v1' });
  assert.equal(catalog.models[0].multi_agent_version, 'v1');
});

test('an empty CODEX_MULTI_AGENT_VERSION leaves multi-agent unset', async () => {
  const catalog = await captureCatalog({ CODEX_MULTI_AGENT_VERSION: '' });
  for (const model of catalog.models) {
    assert.equal(model.multi_agent_version, null, model.slug);
  }
});

test('Codex launch caps subagent concurrency with the documented key', async () => {
  // `agents.max_threads` is only a legacy alias, and Codex documents no
  // nesting-depth limit at all, so concurrency is the only real lever.
  const args = await captureArgs({ MAX_CONCURRENT_SUBAGENTS: '3' });
  assert.ok(
    args.includes('agents.max_concurrent_threads_per_session=3'),
    args.join(' '),
  );
  assert.ok(args.includes('agents.interrupt_message=true'), args.join(' '));
  assert.ok(
    !args.some((arg) => arg.startsWith('agents.max_depth=')),
    'agents.max_depth is not a real Codex key and must not be passed',
  );
});

test('Codex launch keeps subagents off the parent max reasoning effort', async () => {
  // A subagent turn is one uninterrupted think; inheriting max makes every
  // delegated subtask look like a hang.
  //
  // Low rather than medium: the gateway rounds medium up to high for GLM, and
  // at high a subagent given an open-ended task never writes the closing
  // `</think>`, so the turn returns as prose with no tool call and the agent
  // reports success having written nothing.
  const args = await captureArgs();
  assert.ok(
    args.includes('agents.default_subagent_reasoning_effort=low'),
    args.join(' '),
  );
});

test('CODEX_SUBAGENT_REASONING_EFFORT can be overridden or cleared', async () => {
  const high = await captureArgs({ CODEX_SUBAGENT_REASONING_EFFORT: 'high' });
  assert.ok(
    high.includes('agents.default_subagent_reasoning_effort=high'),
    high.join(' '),
  );

  const cleared = await captureArgs({ CODEX_SUBAGENT_REASONING_EFFORT: '' });
  assert.ok(
    !cleared.some((arg) => arg.startsWith('agents.default_subagent_reasoning_effort=')),
    cleared.join(' '),
  );
});

test('an empty CODEX_MULTI_AGENT_VERSION disables subagents outright', async () => {
  // Clearing the catalog field alone only downgrades Codex to multi-agent v1
  // (the `multi_agent_v1` namespace), which this gateway has never been
  // exercised against. `agents.enabled=false` is the real off switch.
  const args = await captureArgs({ CODEX_MULTI_AGENT_VERSION: '' });
  assert.ok(args.includes('agents.enabled=false'), args.join(' '));
  assert.ok(
    !args.some((arg) => arg.startsWith('agents.max_concurrent')),
    'concurrency bounds are meaningless with subagents off',
  );
});

test('Codex launch allows a silent think longer than five minutes', async () => {
  // The marathon models at max reasoning effort go quiet for longer than the
  // old 300s ceiling, and a subagent turn is one uninterrupted think, so the
  // stream was cut while work was still running.
  const args = await captureArgs();
  const timeout = args.find((arg) =>
    arg.startsWith('model_providers.subconscious.stream_idle_timeout_ms='),
  );
  assert.ok(timeout, args.join(' '));
  const ms = Number(timeout.split('=')[1]);
  assert.ok(ms > 300000, `expected more than 300000ms, got ${ms}`);
});

test('CODEX_STREAM_IDLE_TIMEOUT_MS overrides the stream idle timeout', async () => {
  const args = await captureArgs({ CODEX_STREAM_IDLE_TIMEOUT_MS: '1800000' });
  assert.ok(
    args.includes('model_providers.subconscious.stream_idle_timeout_ms=1800000'),
    args.join(' '),
  );
});

test('Codex launch no longer pins a legacy Codex for subagents', async () => {
  // Subagents used to require npx codex@0.132.0; current Codex handles them.
  const args = await captureArgs();
  assert.ok(!args.some((arg) => arg.includes('0.132.0')), args.join(' '));
  assert.ok(
    !args.some((arg) => arg === 'features.multi_agent=true'),
    args.join(' '),
  );
});
