import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-claude-test-'));
const fakeClaude = path.join(testDir, 'claude');

await fs.writeFile(
  fakeClaude,
  '#!/bin/sh\nprintf \'%s\\n%s\' "$ENABLE_CLAUDEAI_MCP_SERVERS" "$CLAUDE_CODE_SUBAGENT_MODEL"\n',
  { mode: 0o755 },
);

after(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

test('Claude launch disables incompatible claude.ai connectors', () => {
  const runbook = new URL('../bin/runbook/claude-code/run.sh', import.meta.url);
  const result = spawnSync('bash', [runbook.pathname], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${testDir}:${process.env.PATH}`,
      GATEWAY_URL: 'https://gateway.example',
      API_KEY: 'sk-test',
      MODEL: 'subconscious/main-model',
      CLAUDE_CODE_SUBAGENT_MODEL: '',
      SUBC_ENV_FILE: os.devNull,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'false\nsubconscious/main-model');
});

test('Claude launch picker stays inside SUBCONSCIOUS_MODELS', async () => {
  const pickerDir = path.join(testDir, 'picker-bin');
  const pickerClaude = path.join(pickerDir, 'claude');
  await fs.mkdir(pickerDir, { recursive: true });
  await fs.writeFile(
    pickerClaude,
    [
      '#!/bin/sh',
      'settings=""',
      'while [ $# -gt 0 ]; do',
      '  if [ "$1" = "--settings" ]; then settings="$2"; shift 2; continue; fi',
      '  shift',
      'done',
      "printf '%s\\n%s\\n%s\\n%s\\n%s\\n%s' \\",
      '  "$ANTHROPIC_DEFAULT_OPUS_MODEL" \\',
      '  "$ANTHROPIC_DEFAULT_SONNET_MODEL" \\',
      '  "$ANTHROPIC_DEFAULT_HAIKU_MODEL" \\',
      '  "$ANTHROPIC_DEFAULT_FABLE_MODEL" \\',
      '  "${ANTHROPIC_CUSTOM_MODEL_OPTION:-}" \\',
      '  "$settings"',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  const runbook = new URL('../bin/runbook/claude-code/run.sh', import.meta.url);
  const result = spawnSync('bash', [runbook.pathname], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${pickerDir}:${process.env.PATH}`,
      GATEWAY_URL: 'https://gateway.example',
      API_KEY: 'sk-test',
      MODEL: 'subconscious/glm-5.2',
      SUBCONSCIOUS_MODELS: 'subconscious/glm-5.2\nsubconscious/tim-qwen3.6-27b',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'subconscious/deepseek-v4-flash-marathon',
      ANTHROPIC_DEFAULT_FABLE_MODEL: 'subconscious/glm-5.3-marathon',
      ANTHROPIC_CUSTOM_MODEL_OPTION: 'subconscious/glm-5.3-marathon',
      SUBC_ENV_FILE: os.devNull,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const [opus, sonnet, haiku, fable, custom, settingsJson] = result.stdout.split('\n');
  assert.equal(opus, 'subconscious/glm-5.2');
  assert.equal(sonnet, 'subconscious/tim-qwen3.6-27b');
  assert.equal(haiku, 'subconscious/tim-qwen3.6-27b');
  assert.equal(fable, 'subconscious/tim-qwen3.6-27b');
  assert.equal(custom, '');
  const settings = JSON.parse(settingsJson);
  assert.deepEqual(settings.availableModels, [
    'subconscious/glm-5.2',
    'subconscious/tim-qwen3.6-27b',
  ]);
  assert.equal(settings.modelPicker.replaceBuiltInOptions, true);
  assert.equal(settingsJson.includes('glm-5.3-marathon'), false);
  assert.equal(settingsJson.includes('deepseek-v4-flash-marathon'), false);
});

test('Claude launch passes an independently configured subagent model', () => {
  const runbook = new URL('../bin/runbook/claude-code/run.sh', import.meta.url);
  const result = spawnSync('bash', [runbook.pathname], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${testDir}:${process.env.PATH}`,
      GATEWAY_URL: 'https://gateway.example',
      API_KEY: 'sk-test',
      MODEL: 'subconscious/main-model',
      CLAUDE_CODE_SUBAGENT_MODEL: 'subconscious/subagent-model',
      SUBC_ENV_FILE: os.devNull,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'false\nsubconscious/subagent-model');
});
