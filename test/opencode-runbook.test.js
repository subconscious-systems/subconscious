import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { agentById } from '../bin/agent-data.js';
import { getAgentApiKey, runbookEnv } from '../bin/agents.js';
import {
  OPENCODE_PROVIDER_ID,
  OPENCODE_PROVIDER_NAME,
  opencodeModelDisplayName,
} from '../bin/opencode-provider.js';
import {
  launchCommand,
  runSync,
  setupCommand,
} from './helpers/agent-command.js';

const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-opencode-test-'));
const fakeOpenCode = path.join(testDir, 'opencode');
const capturedArgs = path.join(testDir, 'argv.txt');
await fs.writeFile(
  fakeOpenCode,
  '#!/bin/sh\n' +
    // Recording the argv is optional: tests that only care about the config
    // do not set CAPTURED_ARGS, and the stub must not fail them.
    '[ -n "$CAPTURED_ARGS" ] && : > "$CAPTURED_ARGS"\n' +
    'for arg in "$@"; do\n' +
    '  [ -n "$CAPTURED_ARGS" ] && printf \'%s\\n\' "$arg" >> "$CAPTURED_ARGS"\n' +
    'done\n' +
    'printf \'%s\' "$OPENCODE_CONFIG_CONTENT"\n',
  {
    mode: 0o755,
  },
);

after(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

test('OpenCode launch replaces the Subconscious catalog on every startup', () => {
  const models = [
    'subconscious/glm-5.2',
    'subconscious/deepseek-v4.1-flash-marathon',
    'subconscious/deepseek-v4.1-flash-marathon-other',
    'subconscious/deepseek-v4-flash-marathon',
    'subconscious/glm-5.3-marathon',
    'subconscious/tim-qwen3.6-27b',
  ];
  const result = runSync(
    launchCommand('opencode', {
      env: {
        ...process.env,
        PATH: `${testDir}:${process.env.PATH}`,
        GATEWAY_URL: 'https://gateway.example',
        API_KEY: 'sk-test',
        MODEL: models[0],
        SUBCONSCIOUS_MODELS: models.join('\n'),
      },
    }),
  );

  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.deepEqual(config.enabled_providers, [OPENCODE_PROVIDER_ID]);
  assert.deepEqual(config.disabled_providers, ['subconscious-cli']);
  assert.deepEqual(Object.keys(config.provider), [OPENCODE_PROVIDER_ID]);
  assert.equal(
    config.provider[OPENCODE_PROVIDER_ID].name,
    OPENCODE_PROVIDER_NAME,
  );
  assert.equal(
    config.provider[OPENCODE_PROVIDER_ID].options.modelsDiscovery.enabled,
    false,
  );
  assert.deepEqual(
    Object.keys(config.provider[OPENCODE_PROVIDER_ID].models),
    models,
  );
  assert.equal(config.model, `${OPENCODE_PROVIDER_ID}/${models[0]}`);
  assert.equal(
    config.provider[OPENCODE_PROVIDER_ID].models['gw-glm-5.2'],
    undefined,
  );
  assert.equal(
    config.provider[OPENCODE_PROVIDER_ID].models['subconscious/glm-5.2'].name,
    'Glm 5.2',
  );
  assert.equal(
    config.provider[OPENCODE_PROVIDER_ID].models['subconscious/tim-qwen3.6-27b']
      .name,
    'Tim Qwen3.6 27B',
  );
  assert.equal(
    config.provider[OPENCODE_PROVIDER_ID].models[
      'subconscious/deepseek-v4-flash-marathon'
    ].name,
    'Deepseek V4 Flash Marathon',
  );
  for (const [id, model] of Object.entries(
    config.provider[OPENCODE_PROVIDER_ID].models,
  )) {
    const vision = id === 'subconscious/deepseek-v4.1-flash-marathon';
    assert.equal('attachment' in model, false, id);
    assert.deepEqual(
      model.modalities,
      vision ? { input: ['text', 'image'], output: ['text'] } : undefined,
      id,
    );
  }
});

test('OpenCode enables vision for an explicitly selected model missing from the catalog', () => {
  const model = 'subconscious/deepseek-v4.1-flash-marathon';
  const result = runSync(
    launchCommand('opencode', {
      env: {
        ...process.env,
        PATH: `${testDir}:${process.env.PATH}`,
        GATEWAY_URL: 'https://gateway.example',
        API_KEY: 'sk-test',
        MODEL: model,
        SUBCONSCIOUS_MODELS: 'custom/model',
      },
    }),
  );
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.equal(config.model, `${OPENCODE_PROVIDER_ID}/${model}`);
  assert.deepEqual(
    config.provider[OPENCODE_PROVIDER_ID].models[model].modalities,
    { input: ['text', 'image'], output: ['text'] },
  );
});

test('OpenCode uninstall removes only the Subconscious provider left by older setups', async () => {
  const home = await fs.mkdtemp(path.join(testDir, 'uninstall-'));
  const file = path.join(home, '.opencode', 'opencode.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify({
      provider: { other: { models: { keep: {} } }, subconscious: {} },
      model: 'subconscious/subconscious/glm-5.2',
    }),
  );
  const result = runSync(
    setupCommand('opencode', ['uninstall'], {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
    }),
  );
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(config, { provider: { other: { models: { keep: {} } } } });
});

test('OpenCode uninstall removes the old compaction plugin and env file, and keeps the user', async () => {
  const home = await fs.mkdtemp(path.join(testDir, 'uninstall-plugin-'));
  const plugins = path.join(home, '.config', 'opencode', 'plugins');
  await fs.mkdir(plugins, { recursive: true });
  await fs.mkdir(path.join(home, '.opencode'));
  await fs.writeFile(path.join(plugins, 'subconscious-compaction.ts'), '');
  await fs.writeFile(path.join(plugins, 'mine.ts'), '');
  await fs.writeFile(path.join(home, '.opencode', 'subconscious.env'), '');
  const result = runSync(
    setupCommand('opencode', ['uninstall'], {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
    }),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await fs.readdir(plugins), ['mine.ts']);
  assert.deepEqual(await fs.readdir(path.join(home, '.opencode')), []);
});

// The gateway labels a conversation's coding agent from this header; without
// it, OpenCode conversations show no agent.
test('OpenCode launch names the client with x-subconscious-client', () => {
  const result = runSync(
    launchCommand('opencode', {
      env: {
        ...process.env,
        PATH: `${testDir}:${process.env.PATH}`,
        GATEWAY_URL: 'https://gateway.example',
        API_KEY: 'sk-test',
        MODEL: 'subconscious/glm-5.3-marathon',
      },
    }),
  );
  assert.equal(result.status, 0, result.stderr);
  const { options } = JSON.parse(result.stdout).provider.subconscious;
  assert.deepEqual(options.headers, { 'x-subconscious-client': 'opencode' });
  assert.equal(options.baseURL, 'https://gateway.example/v1');
  assert.equal(options.apiKey, '{env:SUBCONSCIOUS_API_KEY}');
});

test('OpenCode model display names are capitalized from the id', () => {
  assert.equal(
    opencodeModelDisplayName('subconscious/glm-5.3-marathon'),
    'Glm 5.3 Marathon',
  );
  assert.equal(
    opencodeModelDisplayName('subconscious/tim-qwen3.6-27b'),
    'Tim Qwen3.6 27B',
  );
  assert.equal(
    opencodeModelDisplayName('subconscious/deepseek-v4.1-flash-marathon'),
    'Deepseek V4.1 Flash Marathon',
  );
  assert.equal(
    opencodeModelDisplayName('subconscious/custom-model'),
    'Custom Model',
  );
  assert.equal(
    opencodeModelDisplayName('subconscious/gpt-oss-20b'),
    'GPT OSS 20B',
  );
});

// OpenCode resends every screenshot each turn; the plugin trims the upload to
// the newest images. Loaded from a directory by path, nothing written.
test('OpenCode launch loads the Subconscious plugin directory', async () => {
  const result = runSync(
    launchCommand('opencode', {
      env: {
        ...process.env,
        PATH: `${testDir}:${process.env.PATH}`,
        GATEWAY_URL: 'https://gateway.example',
        API_KEY: 'sk-test',
        MODEL: 'subconscious/deepseek-v4.1-flash-marathon',
      },
    }),
  );
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.equal(config.plugins.length, 1);
  assert.match(config.plugins[0], /opencode\/plugin$/);
  // OpenCode 2.x loads plugins from directories and skips single files.
  const stat = await fs.stat(config.plugins[0]);
  assert.ok(stat.isDirectory());
  await fs.access(path.join(config.plugins[0], 'server.ts'));
});

// OpenCode's long-lived background service keeps the model registry it started
// with, so the per-launch provider config only ever reaches a private server.
// run.sh puts --standalone in the one place each command form accepts it.
test('OpenCode always launches on a private server', async () => {
  const baseEnv = {
    ...process.env,
    PATH: `${testDir}:${process.env.PATH}`,
    GATEWAY_URL: 'https://gateway.example',
    API_KEY: 'sk-test',
    MODEL: 'subconscious/glm-5.3-marathon',
    CAPTURED_ARGS: capturedArgs,
  };
  const launch = (args, prompt) =>
    runSync(launchCommand('opencode', { env: baseEnv, args, prompt }));
  const launched = async (args, prompt) => {
    const result = launch(args, prompt);
    assert.equal(result.status, 0, result.stderr);
    return (await fs.readFile(capturedArgs, 'utf8')).split('\n').slice(0, -1);
  };

  // The stub records "$@", so the binary name is not part of each list.
  // The TUI takes the flag on the root command.
  assert.deepEqual(await launched([]), ['--standalone']);
  assert.deepEqual(await launched(['--auto']), ['--standalone', '--auto']);
  // The run subcommand takes it after the subcommand word, wherever the word
  // came from: subc's own headless template or a pass-through argument.
  assert.deepEqual(await launched([], 'summarize'), ['run', '--standalone']);
  assert.deepEqual(await launched(['run', 'fix it']), [
    'run',
    '--standalone',
    'fix it',
  ]);
  // An explicit private or shared server is the caller's choice.
  assert.deepEqual(await launched(['--standalone']), ['--standalone']);
  assert.deepEqual(await launched(['--server', 'http://x']), [
    '--server',
    'http://x',
  ]);
  assert.deepEqual(await launched(['run', '--standalone', 'x']), [
    'run',
    '--standalone',
    'x',
  ]);
  // Subcommands that take no --standalone at the root position pass through.
  assert.deepEqual(await launched(['models']), ['models']);
});

// OpenCode 2.x sends OPENCODE_API_KEY to opencode.ai as the key for its own
// models, so the Subconscious key must reach OpenCode under no other name
// than SUBCONSCIOUS_API_KEY, which only the Subconscious provider reads.
test('OpenCode gets the key only as SUBCONSCIOUS_API_KEY', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-opencode-env-'));
  try {
    await fs.writeFile(
      path.join(dir, 'opencode'),
      '#!/bin/sh\n' +
        'show() {\n' +
        '  if [ "$2" = unset ]; then echo "$1=unset";\n' +
        '  elif [ "$2" = "$EXPECTED_KEY" ]; then echo "$1=key";\n' +
        '  else echo "$1=other"; fi\n' +
        '}\n' +
        `show OPENCODE_API_KEY "\${OPENCODE_API_KEY-unset}"\n` +
        `show SUBC_OPENCODE_API_KEY "\${SUBC_OPENCODE_API_KEY-unset}"\n` +
        `show SUBCONSCIOUS_API_KEY "\${SUBCONSCIOUS_API_KEY-unset}"\n`,
      { mode: 0o755 },
    );
    const key = 'sk-subc-test-key';
    const env = {
      ...runbookEnv(
        key,
        'subconscious/glm-5.3-marathon',
        dir,
        { values: {} },
        agentById('opencode'),
        ['subconscious/glm-5.3-marathon'],
      ),
      PATH: `${dir}:${process.env.PATH}`,
      EXPECTED_KEY: key,
    };
    // A real launch env carries the agent's own key name, and the user's
    // own opencode.ai key when the shell exports one.
    assert.equal(env.SUBC_OPENCODE_API_KEY, key);
    env.OPENCODE_API_KEY = 'opencode-ai-key';

    for (const prompt of [undefined, 'summarize']) {
      const result = runSync(launchCommand('opencode', { env, prompt }));
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(result.stdout.trim().split('\n'), [
        'OPENCODE_API_KEY=unset',
        'SUBC_OPENCODE_API_KEY=unset',
        'SUBCONSCIOUS_API_KEY=key',
      ]);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the OpenCode key setting is read from the profile under its old name, never from the env', async () => {
  const opencode = agentById('opencode');
  const names = [
    'SUBC_OPENCODE_API_KEY',
    'OPENCODE_API_KEY',
    'SUBCONSCIOUS_API_KEY',
  ];
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  for (const name of names) delete process.env[name];
  const keyFor = async (values) =>
    (
      await getAgentApiKey(
        {
          name: 'k',
          path: '/profiles/k.env',
          values: { API_KEY: 'shared', ...values },
        },
        opencode,
      )
    ).key;
  try {
    // A profile saved before the rename keeps working.
    assert.equal(
      await keyFor({ OPENCODE_API_KEY: 'legacy-key' }),
      'legacy-key',
    );
    assert.equal(
      await keyFor({
        SUBC_OPENCODE_API_KEY: 'new-key',
        OPENCODE_API_KEY: 'old',
      }),
      'new-key',
    );
    // A user's own opencode.ai key in the shell is not a Subconscious key.
    process.env.OPENCODE_API_KEY = 'opencode-ai-key';
    assert.equal(await keyFor({}), 'shared');
    process.env.SUBC_OPENCODE_API_KEY = 'env-specific-key';
    assert.equal(await keyFor({}), 'env-specific-key');
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
