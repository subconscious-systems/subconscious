import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const testConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-profiles-test-'));
process.env.SUBC_CONFIG_DIR = testConfigDir;
process.env.NO_COLOR = '1';

const profiles = await import('../bin/profiles.js');
const agents = await import('../bin/agents.js');
const registry = JSON.parse(
  await fs.readFile(new URL('../bin/registry.generated.json', import.meta.url), 'utf-8'),
);

after(async () => {
  await fs.rm(testConfigDir, { recursive: true, force: true });
});

test('profile sections stay in sync with every registered CLI agent', () => {
  const expectedAgentIds = registry.agents
    .filter((agent) => agent.cli !== false)
    .map((agent) => agent.id);
  const actualAgentIds = profiles.PROFILE_SETTING_GROUPS
    .filter((group) => group.id !== 'shared')
    .map((group) => group.id);

  assert.deepEqual(actualAgentIds, expectedAgentIds);
  for (const group of profiles.PROFILE_SETTING_GROUPS) {
    assert.ok(group.settings.length > 0, `${group.id} should expose settings`);
    assert.ok(group.settings.every((setting) => setting?.key));
  }
});

test('setup requests support aggregate and targeted agent actions', () => {
  const aggregate = agents.parseSetupRequest(['status']);
  assert.equal(aggregate.targeted, false);
  assert.equal(aggregate.action, 'status');
  assert.deepEqual(aggregate.args, ['status']);
  assert.equal(aggregate.agents.length, 6);

  const targeted = agents.parseSetupRequest(['codex', 'install', '--subagents']);
  assert.equal(targeted.targeted, true);
  assert.equal(targeted.action, 'install');
  assert.deepEqual(targeted.args, ['install', '--subagents']);
  assert.deepEqual(targeted.agents.map((agent) => agent.id), ['codex']);

  const implicitInstall = agents.parseSetupRequest(['claude', '--compact-window', '900000']);
  assert.equal(implicitInstall.action, 'install');
  assert.deepEqual(implicitInstall.args, ['--compact-window', '900000']);
  assert.deepEqual(implicitInstall.agents.map((agent) => agent.id), ['claude-code']);

  const persistentEnv = agents.parseSetupRequest(['codex', 'env']);
  assert.equal(persistentEnv.action, 'env');
  assert.deepEqual(persistentEnv.args, ['env']);

  assert.throws(
    () => agents.parseSetupRequest(['status', 'codex']),
    /require a target agent/,
  );
  assert.throws(() => agents.parseSetupRequest(['unknown']), /Unknown coding agent/);
  assert.throws(() => agents.parseSetupRequest(['pi', 'env']), /does not support/);
});

test('profiles are created securely and preserve agent-specific settings', async () => {
  const created = await profiles.ensureProfile('work', 'shared-secret');
  assert.equal(created.exists, true);
  assert.equal(created.values.API_KEY, 'shared-secret');
  assert.equal(created.values.MODEL, registry.defaults.model);
  assert.equal(created.values.GATEWAY_URL, 'https://api-dev.subconscious.dev');
  assert.equal((await fs.stat(created.path)).mode & 0o777, 0o600);

  const updated = await profiles.updateProfile('work', {
    CODEX_API_KEY: 'codex secret with spaces',
    CODEX_REASONING_EFFORT: 'high',
    VSCODE_APP: 'Code - Insiders',
  });
  assert.equal(updated.values.CODEX_API_KEY, 'codex secret with spaces');
  assert.equal(updated.values.CODEX_REASONING_EFFORT, 'high');
  assert.equal(updated.values.VSCODE_APP, 'Code - Insiders');
  assert.deepEqual(await profiles.listProfiles(), ['work']);

  const profileText = await fs.readFile(updated.path, 'utf-8');
  for (const model of profiles.SUPPORTED_MODELS) {
    assert.match(profileText, new RegExp(`#   ${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }

  assert.equal(await profiles.clearProfileApiKey('work'), true);
  const cleared = await profiles.loadProfile('work');
  assert.equal(cleared.values.API_KEY, '');
  assert.equal(cleared.values.CODEX_API_KEY, 'codex secret with spaces');
});

test('the former default gateway migrates while custom gateways are preserved', async () => {
  await fs.mkdir(profiles.PROFILES_DIR, { recursive: true });
  await fs.writeFile(
    profiles.profilePath('legacy-default'),
    'GATEWAY_URL=https://api.subconscious.dev\nAPI_KEY=test\n',
    { mode: 0o600 },
  );
  await fs.writeFile(
    profiles.profilePath('custom-gateway'),
    'GATEWAY_URL=https://gateway.example\nAPI_KEY=test\n',
    { mode: 0o600 },
  );

  const migrated = await profiles.loadProfile('legacy-default');
  const custom = await profiles.loadProfile('custom-gateway');
  assert.equal(migrated.values.GATEWAY_URL, 'https://api-dev.subconscious.dev');
  assert.equal(custom.values.GATEWAY_URL, 'https://gateway.example');
  assert.equal((await fs.stat(migrated.path)).mode & 0o777, 0o600);
});

test('profile parsing and validation reject unsafe names and invalid values', () => {
  assert.deepEqual(
    profiles.parseProfile('export API_KEY="a key"\nMODEL=subconscious/glm-5.2\n# ignored\n'),
    { API_KEY: 'a key', MODEL: 'subconscious/glm-5.2' },
  );
  assert.throws(() => profiles.validateProfileName('../escape'), /Invalid profile name/);

  const shared = profiles.PROFILE_SETTING_GROUPS.find((group) => group.id === 'shared');
  const gateway = shared.settings.find((setting) => setting.key === 'GATEWAY_URL');
  assert.equal(profiles.validateSettingValue(gateway, 'https://gateway.example'), null);
  assert.match(profiles.validateSettingValue(gateway, 'file:///tmp/gateway'), /valid http/);

  const claude = profiles.PROFILE_SETTING_GROUPS.find(
    (group) => group.id === 'claude-code',
  );
  const compactWindow = claude.settings.find(
    (setting) => setting.key === 'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
  );
  assert.equal(profiles.validateSettingValue(compactWindow, '100000'), null);
  assert.match(profiles.validateSettingValue(compactWindow, '99999'), /at least 100000/);
});

test('agent-specific credentials work without a shared profile key', async () => {
  const previousSpecific = process.env.CODEX_API_KEY;
  const previousShared = process.env.SUBCONSCIOUS_API_KEY;
  delete process.env.CODEX_API_KEY;
  delete process.env.SUBCONSCIOUS_API_KEY;

  try {
    const profile = {
      name: 'agent-only',
      path: '/profiles/agent-only.env',
      values: {
        API_KEY: '',
        CODEX_API_KEY: 'profile-codex-key',
      },
    };
    const codex = agents.resolveAgent('codex');

    assert.deepEqual(await agents.getAgentApiKey(profile, codex), {
      key: 'profile-codex-key',
      source: profile.path,
    });

    process.env.SUBCONSCIOUS_API_KEY = 'shared-env-key';
    assert.equal((await agents.getAgentApiKey(profile, codex)).key, 'shared-env-key');

    process.env.CODEX_API_KEY = 'codex-env-key';
    assert.equal((await agents.getAgentApiKey(profile, codex)).key, 'codex-env-key');
  } finally {
    if (previousSpecific === undefined) delete process.env.CODEX_API_KEY;
    else process.env.CODEX_API_KEY = previousSpecific;
    if (previousShared === undefined) delete process.env.SUBCONSCIOUS_API_KEY;
    else process.env.SUBCONSCIOUS_API_KEY = previousShared;
  }
});
