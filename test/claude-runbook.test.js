import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { agentById } from '../bin/agent-data.js';
import { runbookEnv } from '../bin/agents.js';
import { launchCommand, runSync } from './helpers/agent-command.js';

const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-claude-test-'));
const fakeClaude = path.join(testDir, 'claude');

await fs.writeFile(
  fakeClaude,
  '#!/bin/sh\nprintf \'%s\\n%s\\n%s\' "$ENABLE_CLAUDEAI_MCP_SERVERS" "$CLAUDE_CODE_SUBAGENT_MODEL" "$CLAUDE_CODE_AUTO_MODE_SERVER"\n',
  { mode: 0o755 },
);

after(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

function launchClaude(env, binDir = testDir) {
  return runSync(
    launchCommand('claude-code', {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        GATEWAY_URL: 'https://gateway.example',
        API_KEY: 'sk-test',
        ...env,
      },
    }),
  );
}

test('Claude launch disables incompatible claude.ai connectors and the server-side classifier', () => {
  const result = launchClaude({
    MODEL: 'subconscious/main-model',
    CLAUDE_CODE_SUBAGENT_MODEL: '',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'false\nsubconscious/main-model\n0');
});

test('Claude launch passes an independently configured subagent model', () => {
  const result = launchClaude({
    MODEL: 'subconscious/main-model',
    CLAUDE_CODE_SUBAGENT_MODEL: 'subconscious/subagent-model',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'false\nsubconscious/subagent-model\n0');
});

test('an UNSET subagent model follows the launch model', () => {
  const result = launchClaude({
    MODEL: 'subconscious/main-model',
    CLAUDE_CODE_SUBAGENT_MODEL: 'UNSET',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'false\nsubconscious/main-model\n0');
});

test('Claude launch picker stays inside the live catalog', async () => {
  const pickerDir = path.join(testDir, 'picker-bin');
  await fs.mkdir(pickerDir, { recursive: true });
  await fs.writeFile(
    path.join(pickerDir, 'claude'),
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
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter, not a JS template
      '  "${ANTHROPIC_CUSTOM_MODEL_OPTION:-}" \\',
      '  "$settings"',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  const models = [
    'subconscious/glm-5.3-marathon',
    'subconscious/tim-qwen3.6-27b',
  ];
  const profile = {
    values: {
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'subconscious/deepseek-v4-flash-marathon',
      ANTHROPIC_DEFAULT_FABLE_MODEL: 'subconscious/glm-5.2',
      ANTHROPIC_CUSTOM_MODEL_OPTION: 'subconscious/glm-5.2',
    },
  };
  const env = runbookEnv(
    'sk-test',
    models[0],
    pickerDir,
    profile,
    agentById('claude-code'),
    models,
  );
  const result = runSync(launchCommand('claude-code', { env }));

  assert.equal(result.status, 0, result.stderr);
  const [opus, sonnet, haiku, fable, custom, settingsJson] =
    result.stdout.split('\n');
  assert.equal(opus, 'subconscious/glm-5.3-marathon');
  assert.equal(sonnet, 'subconscious/tim-qwen3.6-27b');
  assert.equal(haiku, 'subconscious/tim-qwen3.6-27b');
  assert.equal(fable, 'subconscious/tim-qwen3.6-27b');
  assert.equal(custom, '');
  const settings = JSON.parse(settingsJson);
  assert.deepEqual(settings.availableModels, models);
  assert.equal(settings.modelPicker.replaceBuiltInOptions, true);
  assert.equal(settingsJson.includes('glm-5.2'), false);
  assert.equal(settingsJson.includes('deepseek-v4-flash-marathon'), false);
});
