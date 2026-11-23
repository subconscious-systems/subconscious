import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';
import {
  isolateLaunchEnv,
  LAUNCHER_SHEBANG,
  launcherScript,
  T3_LAUNCHER_NAME,
} from '../bin/t3-launch.js';
import { encodePlan, SHELL_STARTUP_ENV } from '../bin/t3-plan.js';
import {
  CLAUDE_PROVIDER,
  CODEX_PROVIDER,
  providerByKey,
  T3_PROVIDER_KEYS,
  T3_PROVIDERS,
} from '../bin/t3-providers.js';
import { T3_DISPLAY_NAME, T3_INSTANCE_ID } from '../bin/t3-settings.js';

test('the provider table is frozen and has a fixed order', () => {
  assert.ok(Object.isFrozen(T3_PROVIDERS));
  assert.deepEqual(
    T3_PROVIDERS.map((provider) => provider.id),
    ['codex', 'claude'],
  );
  assert.deepEqual(T3_PROVIDER_KEYS, ['codex', 'claude', 'opencode']);
  for (const provider of T3_PROVIDERS) {
    assert.ok(Object.isFrozen(provider), provider.id);
    assert.ok(T3_PROVIDER_KEYS.includes(provider.id), provider.id);
    assert.equal(providerByKey(provider.id), provider);
    // binaryPath decides ownership, so every provider must write it.
    const config = provider.managedConfig({
      launcherPath: '/x/launcher',
      homePath: '/x/home',
    });
    assert.equal(config.binaryPath, '/x/launcher', provider.id);
  }
  assert.equal(providerByKey('opencode'), null);
  assert.equal(providerByKey('cursor'), null);
});

test('the Codex exports keep their values', () => {
  assert.equal(CODEX_PROVIDER, providerByKey('codex'));
  assert.equal(T3_INSTANCE_ID, 'subconscious-codex');
  assert.equal(T3_DISPLAY_NAME, 'Subconscious (Codex)');
  assert.equal(T3_LAUNCHER_NAME, 'subc-t3-codex');
  assert.equal(CODEX_PROVIDER.driver, 'codex');
  assert.equal(CODEX_PROVIDER.watchdog, false);
});

const FIXTURE_INPUTS = {
  node: '/opt/node 22/bin/node',
  adapter: "/opt/it's subc/bin/t3-codex.js",
  binary: '/usr/local/bin/codex',
  configDir: '/home/dev/.subconscious',
  version: '8.2.0',
};

test('the Codex launcher is the 78f67a8 launcher plus the BASH_ENV fix', async () => {
  // Written by launcherScript at 78f67a8 (subc 8.2.0) for FIXTURE_INPUTS.
  const fixture = await fs.readFile(
    new URL('./fixtures/t3-codex-launcher-78f67a8.sh', import.meta.url),
    'utf8',
  );
  const expected = fixture
    .replace('#!/usr/bin/env bash\n', `${LAUNCHER_SHEBANG}\n`)
    .replace('\nset -u\n', '\nunset BASH_ENV ENV\nset -u\n');
  assert.equal(expected.split('\n').length, fixture.split('\n').length + 1);
  assert.equal(launcherScript(FIXTURE_INPUTS), expected);
  assert.equal(
    launcherScript({ ...FIXTURE_INPUTS, provider: CODEX_PROVIDER }),
    expected,
  );
});

test('the launcher refuses descriptor names that are not safe shell words', () => {
  for (const change of [
    { binaryName: 'codex; rm -rf' },
    { launcherName: "subc-t3-'x" },
    { binaryFlag: '--codex $(id)' },
  ])
    assert.throws(
      () =>
        launcherScript({
          ...FIXTURE_INPUTS,
          provider: { ...CODEX_PROVIDER, ...change },
        }),
      /unsafe launcher names/,
    );
});

function decode(text) {
  const fields = text.split('\0');
  const records = [];
  for (let i = 0; i + 1 < fields.length; i += 2)
    records.push([fields[i], fields[i + 1]]);
  return records;
}

test('a plan unsets the names in plan.unset even when the env lacks them', () => {
  const original = { PATH: '/bin', DROPPED: '1', KEPT: 'a' };
  const plan = { argv: ['bash', 'run.sh'], env: { PATH: '/bin', KEPT: 'b' } };
  assert.deepEqual(decode(encodePlan(plan, original)), [
    ['unset', 'DROPPED'],
    ['env', 'KEPT=b'],
    ['arg', 'bash'],
    ['arg', 'run.sh'],
    ['ok', ''],
  ]);
  assert.deepEqual(
    decode(
      encodePlan(
        { ...plan, unset: [...SHELL_STARTUP_ENV, 'DROPPED', 'KEPT'] },
        original,
      ),
    ),
    [
      ['unset', 'DROPPED'],
      ['unset', 'BASH_ENV'],
      ['unset', 'ENV'],
      ['env', 'KEPT=b'],
      ['arg', 'bash'],
      ['arg', 'run.sh'],
      ['ok', ''],
    ],
  );
});

test('isolateLaunchEnv uses the agent inputs and extraIsolatedEnv', () => {
  const env = () => ({
    PATH: '/bin',
    SUBC_PROFILE: 'x',
    SUBCONSCIOUS_API_KEY: 'sk-fake',
    CODEX_API_KEY: 'sk-fake',
    ANTHROPIC_BASE_URL: 'http://evil',
    OPENCODE_CONFIG: '/evil.json',
  });
  const codex = isolateLaunchEnv(env(), '/nowhere');
  assert.deepEqual(Object.keys(codex).sort(), [
    'ANTHROPIC_BASE_URL',
    'OPENCODE_CONFIG',
    'PATH',
    'SUBC_CONFIG_DIR',
  ]);
  const other = isolateLaunchEnv(env(), '/nowhere', {
    ...CODEX_PROVIDER,
    id: 'test-extra',
    extraIsolatedEnv: ['ANTHROPIC_*', 'OPENCODE_CONFIG'],
  });
  assert.deepEqual(Object.keys(other).sort(), ['PATH', 'SUBC_CONFIG_DIR']);
});

test('the Claude descriptor writes no homePath and keeps T3 Code protocol names', () => {
  const claude = providerByKey('claude');
  assert.equal(claude, CLAUDE_PROVIDER);
  assert.equal(claude.instanceId, 'subconscious-claude');
  assert.equal(claude.driver, 'claudeAgent');
  assert.equal(claude.displayName, 'Subconscious (Claude)');
  assert.equal(claude.homeDir, null);
  assert.deepEqual(claude.managedConfig({ launcherPath: '/x/launcher' }), {
    binaryPath: '/x/launcher',
  });
  assert.deepEqual(claude.clearedFields, ['launchArgs']);
  assert.equal(claude.watchdog, false);
  assert.equal(claude.hooks, false);
  const env = isolateLaunchEnv(
    {
      PATH: '/bin',
      CLAUDE_CONFIG_DIR: '/t3/claude-home',
      CLAUDE_CODE_ENTRYPOINT: 't3-code',
      CLAUDE_AGENT_SDK_VERSION: '0.3.321',
      CLAUDE_CODE_SDK_READS_SESSION_STATE: '1',
      T3CODE_THREAD_ID: 'thread',
      MISE_OFFLINE: '1',
      ANTHROPIC_API_KEY: 'sk-fake',
      OTEL_EXPORTER_OTLP_HEADERS: 'x-api-key=sk-fake',
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-fake',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_GATEWAY_URL: 'http://evil',
      CLAUDE_CODE_ENABLE_TELEMETRY: '0',
      COMPACT_WINDOW: '1',
      MAX_CONTEXT_TOKENS: '1',
      API_KEY: 'sk-fake',
      GATEWAY_URL: 'http://evil',
      MODEL: 'x',
    },
    '/nowhere',
    claude,
  );
  assert.deepEqual(Object.keys(env).sort(), [
    'CLAUDE_AGENT_SDK_VERSION',
    'CLAUDE_CODE_ENTRYPOINT',
    'CLAUDE_CODE_SDK_READS_SESSION_STATE',
    'CLAUDE_CONFIG_DIR',
    'MISE_OFFLINE',
    'PATH',
    'SUBC_CONFIG_DIR',
    'T3CODE_THREAD_ID',
  ]);
});
