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
