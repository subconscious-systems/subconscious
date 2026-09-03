import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const testConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-profiles-test-'));
process.env.SUBC_CONFIG_DIR = testConfigDir;
process.env.NO_COLOR = '1';
process.env.SUBC_DISABLE_UPDATE_CHECK = '1';

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

test('agent actions support per-agent install, status, and leftover uninstall', () => {
  const cursor = agents.resolveAgent('cursor');
  const pi = agents.resolveAgent('pi');
  const claude = agents.resolveAgent('claude');
  const codex = agents.resolveAgent('codex');
  const sc = agents.resolveAgent('sc');

  const cursorInstall = agents.parseAgentAction(cursor, ['install']);
  assert.equal(cursorInstall.action, 'install');

  const piUninstall = agents.parseAgentAction(pi, ['uninstall']);
  assert.equal(piUninstall.action, 'uninstall');

  const codexStatus = agents.parseAgentAction(codex, ['status']);
  assert.equal(codexStatus.action, 'status');

  const claudeLaunch = agents.parseAgentAction(claude, ['--continue']);
  assert.equal(claudeLaunch.action, 'launch');

  const claudeUninstall = agents.parseAgentAction(claude, ['uninstall']);
  assert.equal(claudeUninstall.action, 'uninstall');

  assert.equal(sc.id, 'subconscious-code');
  assert.equal(agents.parseAgentAction(sc, []).action, 'launch');
  assert.equal(agents.parseAgentAction(sc, ['install']).action, 'install');

  assert.throws(
    () => agents.parseAgentAction(claude, ['install']),
    /launch-only/,
  );
  assert.throws(
    () => agents.parseAgentAction(codex, ['env']),
    /no longer supports/,
  );
});

test('config lists profiles by default and shows a named profile', async () => {
  await profiles.ensureProfile('work', 'shared-secret');
  const { spawnSync } = await import('node:child_process');
  const cli = new URL('../bin/cli.js', import.meta.url);
  const listed = spawnSync(process.execPath, [cli.pathname, 'config'], {
    encoding: 'utf-8',
    env: { ...process.env, SUBC_CONFIG_DIR: testConfigDir, NO_COLOR: '1' },
  });
  assert.equal(listed.status, 0);
  assert.match(listed.stdout, /work/);
  assert.match(listed.stdout, /Profiles/);
  assert.match(listed.stdout, /\.env/);
  assert.match(listed.stdout, new RegExp(profiles.profilePath('work').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const shown = spawnSync(process.execPath, [cli.pathname, '-p', 'work', 'config'], {
    encoding: 'utf-8',
    env: { ...process.env, SUBC_CONFIG_DIR: testConfigDir, NO_COLOR: '1' },
  });
  assert.equal(shown.status, 0);
  assert.match(shown.stdout, /Profile: work/);
  assert.match(shown.stdout, new RegExp(profiles.profilePath('work').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(shown.stdout, /GATEWAY_URL=/);
  assert.doesNotMatch(shown.stdout, /shared-secret/);
});

test('profiles are created securely and preserve agent-specific settings', async () => {
  const created = await profiles.ensureProfile('work', 'shared-secret');
  assert.equal(created.exists, true);
  assert.equal(created.values.API_KEY, 'shared-secret');
  assert.equal(created.values.MODEL, registry.defaults.model);
  assert.equal(created.values.CLAUDE_CODE_SUBAGENT_MODEL, '');
  assert.equal(created.values.GATEWAY_URL, 'https://api.subconscious.dev');
  assert.equal((await fs.stat(created.path)).mode & 0o777, 0o600);

  const updated = await profiles.updateProfile('work', {
    CODEX_API_KEY: 'codex secret with spaces',
    CODEX_REASONING_EFFORT: 'high',
    VSCODE_APP: 'Code - Insiders',
  });
  assert.equal(updated.values.CODEX_API_KEY, 'codex secret with spaces');
  assert.equal(updated.values.CODEX_REASONING_EFFORT, 'high');
  assert.equal(updated.values.VSCODE_APP, 'Code - Insiders');
  assert.ok((await profiles.listProfiles()).includes('work'));

  const profileText = await fs.readFile(updated.path, 'utf-8');
  for (const model of profiles.SUPPORTED_MODELS) {
    assert.match(profileText, new RegExp(`#   ${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }

  assert.equal(await profiles.clearProfileApiKey('work'), true);
  const cleared = await profiles.loadProfile('work');
  assert.equal(cleared.values.API_KEY, '');
  assert.equal(cleared.values.CODEX_API_KEY, 'codex secret with spaces');
});

test('subagent model can be saved independently or reset to follow the default', async () => {
  await profiles.configCommand(
    ['--subagent-model', 'subconscious/deepseek-v4-flash-marathon'],
    'subagents',
    { profileExplicit: true },
  );
  let profile = await profiles.loadProfile('subagents');
  assert.equal(
    profile.values.CLAUDE_CODE_SUBAGENT_MODEL,
    'subconscious/deepseek-v4-flash-marathon',
  );

  await profiles.configCommand(['--subagent-model', 'UNSET'], 'subagents', {
    profileExplicit: true,
  });
  profile = await profiles.loadProfile('subagents');
  assert.equal(profile.values.CLAUDE_CODE_SUBAGENT_MODEL, '');

  await profiles.configCommand(['--model', 'UNSET'], 'subagents', {
    profileExplicit: true,
  });
  profile = await profiles.loadProfile('subagents');
  assert.equal(profile.values.MODEL, '');

  const claudeSettings = profiles.PROFILE_SETTING_GROUPS.find(
    (group) => group.id === 'claude-code',
  ).settings;
  assert.ok(
    claudeSettings.some((setting) => setting.key === 'CLAUDE_CODE_SUBAGENT_MODEL'),
  );
});

test('config create makes a new profile and rejects duplicates', async () => {
  await profiles.configCommand(['create'], 'created-in-tui', { profileExplicit: true });
  const created = await profiles.loadProfile('created-in-tui');
  assert.equal(created.exists, true);
  assert.equal(created.values.MODEL, registry.defaults.model);
  assert.equal((await fs.stat(created.path)).mode & 0o777, 0o600);
  await assert.rejects(
    profiles.configCommand(['create'], 'created-in-tui', { profileExplicit: true }),
    /already exists/,
  );
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
  assert.equal(migrated.values.GATEWAY_URL, 'https://api.subconscious.dev');
  assert.equal(custom.values.GATEWAY_URL, 'https://gateway.example');
  assert.equal((await fs.stat(migrated.path)).mode & 0o777, 0o600);
});

test('undersized Copilot token defaults migrate while custom budgets are preserved', async () => {
  await fs.mkdir(profiles.PROFILES_DIR, { recursive: true });
  await fs.writeFile(
    profiles.profilePath('legacy-copilot'),
    'COPILOT_MAX_INPUT_TOKENS=12288\nCOPILOT_MAX_OUTPUT_TOKENS=4096\n',
    { mode: 0o600 },
  );
  await fs.writeFile(
    profiles.profilePath('custom-copilot'),
    'COPILOT_MAX_INPUT_TOKENS=10000\nCOPILOT_MAX_OUTPUT_TOKENS=2000\n',
    { mode: 0o600 },
  );

  const migrated = await profiles.loadProfile('legacy-copilot');
  const custom = await profiles.loadProfile('custom-copilot');
  assert.equal(migrated.values.COPILOT_MAX_INPUT_TOKENS, '5000000');
  assert.equal(migrated.values.COPILOT_MAX_OUTPUT_TOKENS, '65536');
  assert.equal(custom.values.COPILOT_MAX_INPUT_TOKENS, '10000');
  assert.equal(custom.values.COPILOT_MAX_OUTPUT_TOKENS, '2000');
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

test('extra profile keys survive known-field updates and appear in config show', async () => {
  const created = await profiles.ensureProfile('extras', 'secret-key-value');
  const text = `${await fs.readFile(created.path, 'utf-8')}ANTHROPIC_DEFAULT_OPUS_MODEL=subconscious/custom-opus\n`;
  await fs.writeFile(created.path, text, { encoding: 'utf-8', mode: 0o600 });

  const updated = await profiles.updateProfile('extras', { MODEL: registry.defaults.model });
  assert.equal(updated.values.ANTHROPIC_DEFAULT_OPUS_MODEL, 'subconscious/custom-opus');
  assert.equal(updated.values.MODEL, registry.defaults.model);

  const { spawnSync } = await import('node:child_process');
  const cli = new URL('../bin/cli.js', import.meta.url);
  const shown = spawnSync(process.execPath, [cli.pathname, '-p', 'extras', 'config'], {
    encoding: 'utf-8',
    env: { ...process.env, SUBC_CONFIG_DIR: testConfigDir, NO_COLOR: '1' },
  });
  assert.equal(shown.status, 0);
  assert.match(shown.stdout, /ANTHROPIC_DEFAULT_OPUS_MODEL=subconscious\/custom-opus/);
  assert.doesNotMatch(shown.stdout, /secret-key-value/);
});

test('config edit requires a terminal and rejects unknown editors', async () => {
  await profiles.ensureProfile('editme', 'edit-secret');
  const { spawnSync } = await import('node:child_process');
  const cli = new URL('../bin/cli.js', import.meta.url);
  const env = { ...process.env, SUBC_CONFIG_DIR: testConfigDir, NO_COLOR: '1' };

  const nonTty = spawnSync(process.execPath, [cli.pathname, '-p', 'editme', 'config', 'edit'], {
    encoding: 'utf-8',
    env,
  });
  assert.notEqual(nonTty.status, 0);
  assert.match(nonTty.stderr, /requires a terminal/);
  assert.match(nonTty.stderr, new RegExp(profiles.profilePath('editme').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const unknown = spawnSync(process.execPath, [cli.pathname, 'config', 'edit', 'emacs'], {
    encoding: 'utf-8',
    env,
  });
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /vim or nano/);
});

test('profile extras can remap Claude picker slots only to catalog models', () => {
  const previous = process.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
  delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
  try {
    const claude = agents.resolveAgent('claude');
    const catalog = ['subconscious/glm-5.2', 'subconscious/tim-qwen3.6-27b'];
    const remapped = agents.runbookEnv(
      'sk-test',
      catalog[0],
      undefined,
      {
        name: 'picker',
        path: '/profiles/picker.env',
        values: { ANTHROPIC_DEFAULT_OPUS_MODEL: catalog[1] },
      },
      claude,
      catalog,
    );
    assert.equal(remapped.ANTHROPIC_DEFAULT_OPUS_MODEL, catalog[1]);
    assert.equal(remapped.API_KEY, 'sk-test');
    assert.equal(remapped.MODEL, catalog[0]);

    const rejected = agents.runbookEnv(
      'sk-test',
      catalog[0],
      undefined,
      {
        name: 'picker',
        path: '/profiles/picker.env',
        values: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'subconscious/glm-5.3-marathon' },
      },
      claude,
      catalog,
    );
    assert.equal(rejected.ANTHROPIC_DEFAULT_OPUS_MODEL, catalog[0]);
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
    else process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = previous;
  }
});

test('Claude picker slots stay inside the live catalog', () => {
  const previousHaiku = process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
  const previousFable = process.env.ANTHROPIC_DEFAULT_FABLE_MODEL;
  const previousCustom = process.env.ANTHROPIC_CUSTOM_MODEL_OPTION;
  process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'subconscious/deepseek-v4-flash-marathon';
  process.env.ANTHROPIC_DEFAULT_FABLE_MODEL = 'subconscious/glm-5.3-marathon';
  process.env.ANTHROPIC_CUSTOM_MODEL_OPTION = 'subconscious/glm-5.3-marathon';
  try {
    const claude = agents.resolveAgent('claude');
    const catalog = ['subconscious/glm-5.2', 'subconscious/tim-qwen3.6-27b'];
    const env = agents.runbookEnv(
      'sk-test',
      catalog[0],
      undefined,
      { name: 'live', path: '/profiles/live.env', values: {} },
      claude,
      catalog,
    );

    assert.equal(env.ANTHROPIC_DEFAULT_OPUS_MODEL, catalog[0]);
    assert.equal(env.ANTHROPIC_DEFAULT_SONNET_MODEL, catalog[1]);
    assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, catalog[1]);
    assert.equal(env.ANTHROPIC_DEFAULT_FABLE_MODEL, catalog[1]);
    assert.equal(env.ANTHROPIC_CUSTOM_MODEL_OPTION, undefined);
    assert.equal(env.SUBCONSCIOUS_MODELS, catalog.join('\n'));
    assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME, catalog[1]);
    assert.equal(env.ANTHROPIC_DEFAULT_FABLE_MODEL_NAME, catalog[1]);
    assert.equal(env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME, undefined);
    assert.equal(env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, '0');
    const settings = JSON.parse(env.SUBC_CLAUDE_SETTINGS);
    assert.deepEqual(settings.availableModels, catalog);
    assert.equal(settings.modelPicker.replaceBuiltInOptions, true);
    assert.deepEqual(
      settings.modelPicker.options.map((option) => option.model),
      catalog,
    );
  } finally {
    if (previousHaiku === undefined) delete process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
    else process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = previousHaiku;
    if (previousFable === undefined) delete process.env.ANTHROPIC_DEFAULT_FABLE_MODEL;
    else process.env.ANTHROPIC_DEFAULT_FABLE_MODEL = previousFable;
    if (previousCustom === undefined) delete process.env.ANTHROPIC_CUSTOM_MODEL_OPTION;
    else process.env.ANTHROPIC_CUSTOM_MODEL_OPTION = previousCustom;
  }
});

test('live models flow into runbooks and all five Claude picker slots', () => {
  const claude = agents.resolveAgent('claude');
  const liveModels = [
    'subconscious/new-default',
    'subconscious/new-fast',
    'subconscious/new-small',
    'subconscious/new-extra',
    'subconscious/new-fifth',
  ];
  const env = agents.runbookEnv(
    'sk-test',
    liveModels[0],
    undefined,
    { name: 'live', path: '/profiles/live.env', values: {} },
    claude,
    liveModels,
  );

  assert.equal(env.SUBCONSCIOUS_MODELS, liveModels.join('\n'));
  assert.equal(env.ANTHROPIC_DEFAULT_OPUS_MODEL, liveModels[0]);
  assert.equal(env.ANTHROPIC_DEFAULT_SONNET_MODEL, liveModels[1]);
  assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, liveModels[2]);
  assert.equal(env.ANTHROPIC_DEFAULT_FABLE_MODEL, liveModels[3]);
  assert.equal(env.ANTHROPIC_DEFAULT_FABLE_MODEL_NAME, liveModels[3]);
  assert.equal(env.ANTHROPIC_CUSTOM_MODEL_OPTION, liveModels[4]);
  assert.equal(env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME, liveModels[4]);
  assert.equal(
    env.ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION,
    `Subconscious model ${liveModels[4]}`,
  );
  const settings = JSON.parse(env.SUBC_CLAUDE_SETTINGS);
  assert.deepEqual(settings.availableModels, liveModels);
  assert.equal(settings.modelPicker.replaceBuiltInOptions, true);
});

test('UNSET and legacy aliases clear model settings', () => {
  assert.equal(profiles.isUnsetSetting('UNSET'), true);
  assert.equal(profiles.isUnsetSetting('unset'), true);
  assert.equal(profiles.isUnsetSetting('follow-default'), true);
  assert.equal(profiles.isUnsetSetting('follow-gateway'), true);
  assert.equal(profiles.isUnsetSetting('subconscious/glm-5.2'), false);
  assert.equal(profiles.resolvedModelSetting('UNSET'), '');
  assert.equal(profiles.resolvedModelSetting('subconscious/glm-5.2'), 'subconscious/glm-5.2');
});

test('a blank profile model follows the first live catalog entry', () => {
  const previous = process.env.SUBCONSCIOUS_MODEL;
  delete process.env.SUBCONSCIOUS_MODEL;

  try {
    const extracted = agents.extractModel([], {
      name: 'blank',
      path: '/profiles/blank.env',
      values: { MODEL: 'UNSET' },
    });
    assert.equal(extracted.model, '');
    assert.equal(extracted.modelSource, 'catalog');
    assert.deepEqual(agents.extractModel(['--model', 'UNSET'], {
      name: 'blank',
      path: '/profiles/blank.env',
      values: { MODEL: 'subconscious/glm-5.2' },
    }), { model: '', modelSource: 'catalog', rest: [] });

    const catalog = {
      source: 'available',
      models: ['subconscious/glm-5.3-marathon', 'subconscious/glm-5.2'],
    };
    assert.equal(
      agents.selectLaunchModel('', 'catalog', catalog),
      'subconscious/glm-5.3-marathon',
    );
    assert.equal(
      agents.selectLaunchModel('subconscious/glm-5.2', 'profile', catalog),
      'subconscious/glm-5.2',
    );
  } finally {
    if (previous === undefined) delete process.env.SUBCONSCIOUS_MODEL;
    else process.env.SUBCONSCIOUS_MODEL = previous;
  }
});

test('a removed saved default yields to the first live model but explicit overrides do not', () => {
  for (const source of ['available', 'public']) {
    const catalog = {
      source,
      models: ['subconscious/live', 'subconscious/other'],
    };

    assert.equal(
      agents.selectLaunchModel('subconscious/removed', 'profile', catalog),
      'subconscious/live',
    );
    assert.equal(
      agents.selectLaunchModel('subconscious/removed', 'command', catalog),
      'subconscious/removed',
    );
    assert.equal(
      agents.selectLaunchModel('subconscious/other', 'profile', catalog),
      'subconscious/other',
    );
  }

  assert.equal(
    agents.selectLaunchModel(
      'subconscious/removed',
      'profile',
      { source: 'packaged', models: ['subconscious/live'] },
    ),
    'subconscious/removed',
  );
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
