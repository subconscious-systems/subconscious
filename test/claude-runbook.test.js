import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { agentById } from '../bin/agent-data.js';
import { runbookEnv } from '../bin/agents.js';
import {
  launchCommand,
  runSync,
  setupCommand,
} from './helpers/agent-command.js';

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

test('Claude launch leaves the Claude config folder up to the user', async () => {
  const configBin = path.join(testDir, 'config-bin');
  await fs.mkdir(configBin, { recursive: true });
  await fs.writeFile(
    path.join(configBin, 'claude'),
    '#!/bin/sh\nprintf \'%s\' "$CLAUDE_CONFIG_DIR"\n',
    { mode: 0o755 },
  );
  const { CLAUDE_CONFIG_DIR: _shellConfigDir, ...shellEnv } = process.env;
  const base = {
    PATH: `${configBin}:${process.env.PATH}`,
    GATEWAY_URL: 'https://gateway.example',
    API_KEY: 'sk-test',
    MODEL: 'subconscious/main-model',
    SUBC_CONFIG_DIR: path.join(testDir, 'subc-config'),
  };

  const launched = runSync(
    launchCommand('claude-code', { env: { ...shellEnv, ...base } }),
  );
  assert.equal(launched.status, 0, launched.stderr);
  assert.equal(
    launched.stdout,
    '',
    'subc must not point Claude Code at a config dir of its own',
  );

  const own = runSync(
    launchCommand('claude-code', {
      env: { ...shellEnv, ...base, CLAUDE_CONFIG_DIR: '/custom/claude' },
    }),
  );
  assert.equal(own.status, 0, own.stderr);
  assert.equal(
    own.stdout,
    '/custom/claude',
    'a user-set CLAUDE_CONFIG_DIR passes through verbatim',
  );

  const flagBin = path.join(testDir, 'flag-bin');
  await fs.mkdir(flagBin, { recursive: true });
  await fs.writeFile(
    path.join(flagBin, 'claude'),
    '#!/bin/sh\nprintf \'%s\\n\' "$@"\n',
    { mode: 0o755 },
  );
  const forwarded = runSync(
    launchCommand('claude-code', {
      env: {
        ...shellEnv,
        ...base,
        PATH: `${flagBin}:${process.env.PATH}`,
      },
      args: ['--no-isolate'],
    }),
  );
  assert.equal(forwarded.status, 0, forwarded.stderr);
  assert.ok(
    forwarded.stdout.includes('--no-isolate'),
    'the retired --no-isolate flag is no longer intercepted: it passes through to the claude argv',
  );

  const staleSetting = runSync(
    launchCommand('claude-code', {
      env: {
        ...shellEnv,
        ...base,
        CLAUDE_CODE_ISOLATE: 'off',
      },
    }),
  );
  assert.equal(staleSetting.status, 0, staleSetting.stderr);
  assert.equal(
    staleSetting.stdout,
    '',
    'a stale CLAUDE_CODE_ISOLATE in a stored env file is ignored, not rejected',
  );
});

test('subc claude uninstall removes the leftover isolated config dir link-safely', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-claude-clean-'));
  try {
    const source = path.join(home, '.claude');
    await fs.mkdir(path.join(source, 'plans'), { recursive: true });
    await fs.writeFile(path.join(source, 'plans', 'plan.md'), 'keep');
    await fs.writeFile(path.join(source, 'CLAUDE.md'), '# user config');
    const dir = path.join(home, '.subconscious', 'claude-code');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, '.subc-written.json'), '{}');
    await fs.symlink(path.join(source, 'plans'), path.join(dir, 'plans'));
    await fs.symlink(
      path.join(source, 'CLAUDE.md'),
      path.join(dir, 'CLAUDE.md'),
    );
    await fs.writeFile(
      path.join(dir, 'settings.json'),
      '{"model":"subconscious/x"}',
    );
    await fs.mkdir(path.join(dir, 'plugins'));
    await fs.writeFile(path.join(dir, 'plugins', 'config.json'), '{}');

    const env = {
      ...process.env,
      HOME: home,
      SUBC_CONFIG_DIR: path.join(home, '.subconscious'),
    };
    const reported = runSync(setupCommand('claude-code', ['status'], env));
    assert.equal(reported.status, 0, reported.stderr);
    assert.match(reported.stdout, /present, subc-made/);

    const result = runSync(setupCommand('claude-code', ['uninstall'], env));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Removed .*claude-code/);

    await assert.rejects(fs.access(dir), 'the isolated dir is gone');
    assert.equal(
      await fs.readFile(path.join(home, '.claude', 'plans', 'plan.md'), 'utf8'),
      'keep',
      'a linked target survives the cleanup',
    );
    assert.equal(
      await fs.readFile(path.join(home, '.claude', 'CLAUDE.md'), 'utf8'),
      '# user config',
      'a linked file survives the cleanup',
    );
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('subc claude uninstall refuses a Claude config subc did not make', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-claude-foreign-'));
  try {
    const dir = path.join(home, '.subconscious', 'claude-code');
    await fs.mkdir(path.join(dir, 'projects'), { recursive: true });
    await fs.writeFile(path.join(dir, 'settings.json'), '{}');
    const env = {
      ...process.env,
      HOME: home,
      SUBC_CONFIG_DIR: path.join(home, '.subconscious'),
    };
    const result = runSync(setupCommand('claude-code', ['uninstall'], env));
    assert.notEqual(result.status, 0, 'a foreign config must be refused');
    assert.match(result.stderr, /Refusing to remove/);
    const kept = await fs.readFile(path.join(dir, 'settings.json'), 'utf8');
    assert.equal(kept, '{}', 'the refused dir keeps its files');
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
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
