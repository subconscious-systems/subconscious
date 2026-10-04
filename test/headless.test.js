import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseAgentAction } from '../bin/agents.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const registry = JSON.parse(
  await fs.readFile(path.join(ROOT, 'agents/registry.json'), 'utf8'),
);
const manifest = JSON.parse(
  await fs.readFile(
    path.join(ROOT, 'bin/harness-manifest.generated.json'),
    'utf8',
  ),
);

const PROMPTS = [
  'fix the "bug"\nthen run -p --model trick',
  '- start with a markdown bullet',
  '--looks-like-a-flag',
  '@file-looking prompt',
];
let PROMPT = PROMPTS[0];
const EXTRA = ['--extra-flag', 'value'];
// Each runbook drops the separator, so the agent sees the same options.
const EXTRA_FORMS = [EXTRA, ['--', ...EXTRA]];
const MODEL = 'subconscious/glm-5.3-marathon';
const HEADLESS_AGENTS = [
  'claude-code',
  'codex',
  'opencode',
  'pi',
  'subconscious-code',
  'deepseek-harness',
];

const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-headless-'));
const binDir = path.join(testDir, 'bin');
const argsFile = path.join(testDir, 'argv');
const stdinFile = path.join(testDir, 'stdin');
const CALLER_STDIN = 'caller input that a headless run must not read';
await fs.mkdir(binDir, { recursive: true });
for (const bin of ['claude', 'codex', 'opencode', 'pi', 'marathon', 'dsh']) {
  await fs.writeFile(
    path.join(binDir, bin),
    `#!/usr/bin/env bash\nprintf '%s\\0' "$(basename "$0")" "$@" >"$HEADLESS_ARGV_FILE"\ncat >"$HEADLESS_STDIN_FILE"\n`,
    { mode: 0o755 },
  );
}

after(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

function agentById(id) {
  return registry.agents.find((agent) => agent.id === id);
}

function runRunbook(agent, args) {
  const piDir = path.join(testDir, 'pi-agent');
  return spawnSync(
    'bash',
    [path.join(ROOT, 'bin/runbook', agent.runbook.script), ...args],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        TMPDIR: testDir,
        GATEWAY_URL: 'https://gateway.example',
        API_KEY: 'sk-test',
        MODEL,
        SUBCONSCIOUS_MODELS: MODEL,
        SUBC_ENV_FILE: os.devNull,
        CLAUDE_CODE_SUBAGENT_MODEL: '',
        CODEX_DIR: path.join(testDir, '.codex'),
        PI_CODING_AGENT_DIR: piDir,
        HEADLESS_ARGV_FILE: argsFile,
        HEADLESS_STDIN_FILE: stdinFile,
      },
      input: CALLER_STDIN,
    },
  );
}

async function recordedArgv() {
  const raw = await fs.readFile(argsFile, 'utf8');
  return raw.split('\0').slice(0, -1);
}

// Placeholders: {args} is the pass-through list, {prompt} and {model} are
// exact, `-c {configOverrides}` is one or more `-c` pairs, and any other
// whole-token placeholder is a single generated value such as a temp file.
function matchArgv(expected, actual) {
  const out = [];
  let j = 0;
  for (let i = 0; i < expected.length; i++) {
    const part = expected[i];
    if (part === '-c' && expected[i + 1] === '{configOverrides}') {
      assert.equal(actual[j], '-c', `expected -c at ${j}: ${actual}`);
      while (actual[j] === '-c') {
        out.push(actual[j], actual[j + 1]);
        j += 2;
      }
      i++;
      continue;
    }
    if (part === '{args}') {
      out.push(...actual.slice(j, j + EXTRA.length));
      assert.deepEqual(actual.slice(j, j + EXTRA.length), EXTRA);
      j += EXTRA.length;
      continue;
    }
    const literal = part
      .replaceAll('{prompt}', PROMPT)
      .replaceAll('{model}', MODEL);
    if (/^\{[A-Za-z]+\}$/.test(literal)) {
      assert.ok(actual[j], `missing value for ${part}`);
    } else {
      assert.equal(actual[j], literal, `argv[${j}] for ${part}`);
    }
    out.push(actual[j]);
    j++;
  }
  assert.equal(j, actual.length, `unexpected trailing argv: ${actual}`);
  return out;
}

test('every headless runbook runs exactly the manifest headless_argv', async () => {
  for (const id of HEADLESS_AGENTS) {
    const agent = agentById(id);
    const { headless_argv: argv, headless_stdin: stdin } =
      manifest.harnesses[id].launch;
    assert.ok(argv, `${id}: manifest has no headless_argv`);
    for (const [prompt, extra] of PROMPTS.flatMap((p) =>
      EXTRA_FORMS.map((form) => [p, form]),
    )) {
      PROMPT = prompt;
      await fs.rm(argsFile, { force: true });
      const result = runRunbook(agent, ['headless', PROMPT, ...extra]);
      assert.equal(result.status, 0, `${id}: ${result.stderr}`);
      // The stub writes nothing to stdout, so anything here is runbook noise.
      assert.equal(result.stdout, '', `${id} wrote to stdout`);
      matchArgv(argv, await recordedArgv());
      assert.equal(
        await fs.readFile(stdinFile, 'utf8'),
        stdin ? stdin.replaceAll('{prompt}', PROMPT) : '',
        `${id}: stdin for ${JSON.stringify(PROMPT)} ${extra.join(' ')}`,
      );
    }
  }
});

test('headless without a prompt fails before launching', async () => {
  for (const id of HEADLESS_AGENTS) {
    await fs.rm(argsFile, { force: true });
    for (const args of [['headless'], ['headless', '--help']]) {
      const result = runRunbook(agentById(id), args);
      assert.equal(result.status, 2, `${id}: ${result.stderr}`);
      assert.match(result.stderr, /headless PROMPT/, id);
      await assert.rejects(fs.access(argsFile), `${id} launched anyway`);
    }
  }
});

test('help inside a headless run is refused instead of exiting 0', async () => {
  await fs.rm(argsFile, { force: true });
  const result = runRunbook(agentById('claude-code'), ['headless', 'go', '-h']);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout, '');
  await assert.rejects(fs.access(argsFile));
});

test('the registry and the manifest agree on which agents run headless', () => {
  const declared = registry.agents
    .filter((agent) => agent.runbook?.headless)
    .map((agent) => agent.id)
    .sort();
  assert.deepEqual(declared, [...HEADLESS_AGENTS].sort());
  for (const [id, harness] of Object.entries(manifest.harnesses)) {
    assert.equal(
      Boolean(harness.launch?.headless_argv),
      declared.includes(id),
      `${id}: headless_argv vs runbook.headless`,
    );
    if (!declared.includes(id)) continue;
    const windows = agentById(id).runbook.headless.windows;
    assert.deepEqual(
      harness.launch.headless_platforms,
      windows ? ['darwin', 'linux', 'win32'] : ['darwin', 'linux'],
      id,
    );
  }
});

test('parseAgentAction recognizes headless only where it is supported', () => {
  assert.deepEqual(parseAgentAction(agentById('codex'), ['headless', 'go']), {
    action: 'headless',
    args: ['headless', 'go'],
  });
  assert.throws(
    () => parseAgentAction(agentById('codex'), ['headless']),
    /headless PROMPT/,
  );
  assert.throws(
    () => parseAgentAction(agentById('codex'), ['headless', '']),
    /headless PROMPT/,
  );
  for (const help of ['-h', '--help']) {
    assert.throws(
      () => parseAgentAction(agentById('codex'), ['headless', help]),
      /headless PROMPT/,
    );
  }
  assert.throws(
    () => parseAgentAction(agentById('cursor'), ['headless', 'go']),
    /does not support headless/,
  );
});

test('Windows dsh headless reports a missing binary without prompting or crashing', async () => {
  const { runWindowsAgent } = await import('../bin/windows/agents.js');
  const { extractModel } = await import('../bin/agents.js');
  const emptyDir = await fs.mkdtemp(path.join(testDir, 'empty-path-'));
  const saved = { PATH: process.env.PATH, exitCode: process.exitCode };
  const stdout = [];
  const log = console.log;
  process.env.PATH = emptyDir;
  console.log = (...parts) => stdout.push(parts.join(' '));
  try {
    const code = await runWindowsAgent(
      agentById('deepseek-harness'),
      ['headless', 'go'],
      {
        profile: { name: 'default', values: {} },
        parseAgentAction,
        extractModel,
        requireApiKey: async () => 'sk-test',
        resolvedModelsForLaunch: async () => ({
          models: [MODEL],
          source: 'packaged',
        }),
        selectLaunchModel: () => MODEL,
        runbookEnv: () => ({}),
      },
    );
    assert.equal(code, 127);
  } finally {
    console.log = log;
    process.env.PATH = saved.PATH;
    process.exitCode = saved.exitCode;
  }
  assert.deepEqual(stdout, []);
});

async function runSubc(args) {
  const home = await fs.mkdtemp(path.join(testDir, 'home-'));
  const fetchLog = path.join(home, 'fetches');
  const preload = path.join(home, 'record-fetch.mjs');
  await fs.writeFile(
    preload,
    `import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url) => {
  appendFileSync(process.env.FETCH_LOG, String(url) + '\\n');
  throw new Error('network disabled in test');
};
`,
  );
  await fs.rm(argsFile, { force: true });
  const result = spawnSync(
    process.execPath,
    ['--import', preload, path.join(ROOT, 'bin/cli.js'), ...args],
    {
      encoding: 'utf8',
      input: CALLER_STDIN,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        HOME: home,
        SUBC_CONFIG_DIR: path.join(home, 'subc'),
        SUBCONSCIOUS_API_KEY: 'sk-test',
        SUBCONSCIOUS_BASE_URL: 'http://127.0.0.1:9',
        SUBCONSCIOUS_MODEL: MODEL,
        SUBC_DISABLE_UPDATE_CHECK: '',
        FETCH_LOG: fetchLog,
        HEADLESS_ARGV_FILE: argsFile,
        HEADLESS_STDIN_FILE: stdinFile,
      },
    },
  );
  const fetched = await fs.readFile(fetchLog, 'utf8').catch(() => '');
  return { ...result, fetched };
}

function assertHeadlessLaunch(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Launching.*Codex/);
  assert.doesNotMatch(result.fetched, /registry\.npmjs\.org/);
}

test('subc headless keeps stdout clean, skips npm, and leaves args after -- alone', async () => {
  const result = await runSubc([
    'codex',
    'headless',
    'do it',
    '--model',
    'subconscious/glm-5.2',
    '--',
    '--model',
    'agent-side-model',
  ]);
  assertHeadlessLaunch(result);
  const argv = await recordedArgv();
  assert.ok(argv.includes('model=subconscious/glm-5.2'), argv.join(' '));
  assert.deepEqual(argv.slice(-5), [
    'exec',
    '--model',
    'agent-side-model',
    '--',
    'do it',
  ]);
  assert.equal(await fs.readFile(stdinFile, 'utf8'), '');
});

test('subc flags before headless still get headless behaviour', async () => {
  const result = await runSubc([
    'codex',
    '--model',
    'subconscious/glm-5.2',
    'headless',
    'do it',
  ]);
  assertHeadlessLaunch(result);
  const argv = await recordedArgv();
  assert.ok(argv.includes('model=subconscious/glm-5.2'), argv.join(' '));
  assert.deepEqual(argv.slice(-3), ['exec', '--', 'do it']);
});

test('a prompt that looks like a subc flag reaches the agent unchanged', async () => {
  for (const prompt of ['--model', '-p', '--profile=x', '--model=y']) {
    const result = await runSubc(['codex', 'headless', prompt]);
    assertHeadlessLaunch(result);
    const argv = await recordedArgv();
    assert.ok(argv.includes(`model=${MODEL}`), `${prompt}: ${argv.join(' ')}`);
    assert.deepEqual(argv.slice(-3), ['exec', '--', prompt]);
  }
});

test('a blank prompt is refused before launching', async () => {
  assert.throws(
    () => parseAgentAction(agentById('pi'), ['headless', ' \n ']),
    /headless PROMPT/,
  );
  for (const id of HEADLESS_AGENTS) {
    await fs.rm(argsFile, { force: true });
    const result = runRunbook(agentById(id), ['headless', ' \t\n']);
    assert.equal(result.status, 2, `${id}: ${result.stderr}`);
    await assert.rejects(fs.access(argsFile), `${id} launched anyway`);
  }
});

test('help flags after the prompt are refused instead of exiting 0', () => {
  for (const args of [
    ['headless', 'go', '-h'],
    ['headless', 'go', '--', '--help'],
  ]) {
    assert.throws(
      () => parseAgentAction(agentById('codex'), args),
      /help is not available in a headless run/,
    );
  }
});

test('a prompt of exactly -- reaches the agent', async () => {
  const result = await runSubc([
    'codex',
    'headless',
    '--',
    '--model',
    'subconscious/glm-5.2',
  ]);
  assertHeadlessLaunch(result);
  const argv = await recordedArgv();
  // The prompt "--" is not a separator, so the --model after it is subc's.
  assert.ok(argv.includes('model=subconscious/glm-5.2'), argv.join(' '));
  assert.deepEqual(argv.slice(-3), ['exec', '--', '--']);
});

test('the word headless later in a normal launch changes nothing', async () => {
  const { extractModel } = await import('../bin/agents.js');
  const parsed = extractModel(
    ['--resume', 'headless', '--model', 'subconscious/glm-5.2'],
    { values: {} },
  );
  assert.equal(parsed.model, 'subconscious/glm-5.2');
  assert.deepEqual(parsed.rest, ['--resume', 'headless']);
  const { isHeadlessRequest } = await import('../bin/agents.js');
  assert.equal(
    isHeadlessRequest(agentById('claude-code'), ['--model', 'x', 'install']),
    false,
  );
  const result = await runSubc([
    'codex',
    '--resume',
    'headless',
    '-p',
    'missing-profile',
  ]);
  assert.match(result.stderr, /Profile 'missing-profile' does not exist/);
});

test('subc and the runbook agree on whether a run is headless', async () => {
  const { extractModel } = await import('../bin/agents.js');
  const { headlessPromptIndex } = await import('../bin/headless-args.js');
  const forms = [
    ['headless', 'P'],
    ['--model', 'm', 'headless', 'P'],
    ['--model=m', 'headless', 'P'],
    ['--model', '', 'headless', 'P'],
    ['--model=', 'headless', 'P'],
    ['--model', '-x', 'headless', 'P'],
    ['--model', '--', 'headless', 'P'],
    ['--model', '--model', 'x', 'headless', 'P'],
    ['--resume', 'headless', 'P'],
    ['--model'],
  ];
  for (const argv of forms) {
    const runbookSeesHeadless =
      extractModel(argv, { values: {} }).rest[0] === 'headless';
    assert.equal(
      headlessPromptIndex(argv) >= 0,
      runbookSeesHeadless,
      JSON.stringify(argv),
    );
  }
  // An empty --model value means "use the catalog", not a missing value.
  assert.ok(headlessPromptIndex(['--model', '', 'headless', 'P']) >= 0);
});

for (const agentName of ['codex', 'dsh']) {
  test(`stopping subc stops the ${agentName} agent it launched`, async () => {
    const { spawn } = await import('node:child_process');
    const sleeperDir = await fs.mkdtemp(path.join(testDir, 'sleeper-'));
    const tmp = await fs.mkdtemp(path.join(testDir, 'tmp-'));
    const pidFile = path.join(sleeperDir, 'pid');
    await fs.writeFile(
      path.join(sleeperDir, agentName),
      // subc checks the version before launching; only the launch sleeps.
      `#!/usr/bin/env bash\n[ "$1" = --version ] && { echo "codex-cli 0.200.0"; exit 0; }\necho $$ >"${pidFile}"\nexec sleep 60\n`,
      { mode: 0o755 },
    );
    const home = await fs.mkdtemp(path.join(testDir, 'home-'));
    const child = spawn(
      process.execPath,
      [path.join(ROOT, 'bin/cli.js'), agentName, 'headless', 'wait'],
      {
        stdio: 'ignore',
        env: {
          ...process.env,
          PATH: `${sleeperDir}:${process.env.PATH}`,
          TMPDIR: tmp,
          HOME: home,
          SUBC_CONFIG_DIR: path.join(home, 'subc'),
          SUBCONSCIOUS_API_KEY: 'sk-test',
          SUBCONSCIOUS_BASE_URL: 'http://127.0.0.1:9',
          SUBCONSCIOUS_MODEL: MODEL,
        },
      },
    );
    const exited = new Promise((resolve) =>
      child.on('exit', (code, signal) => resolve({ code, signal })),
    );
    let agentPid;
    for (let i = 0; i < 100 && !agentPid; i++) {
      agentPid = Number(await fs.readFile(pidFile, 'utf8').catch(() => 0));
      if (!agentPid) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(agentPid, 'agent never started');
    child.kill('SIGTERM');
    const { code, signal } = await exited;
    assert.ok(signal === 'SIGTERM' || code === 143, `${code} ${signal}`);
    let alive = true;
    for (let i = 0; i < 30 && alive; i++) {
      try {
        process.kill(agentPid, 0);
        await new Promise((r) => setTimeout(r, 100));
      } catch {
        alive = false;
      }
    }
    if (alive) process.kill(agentPid, 'SIGKILL');
    assert.equal(alive, false, 'agent kept running after subc was stopped');
    let leftovers = [];
    for (let i = 0; i < 40; i++) {
      leftovers = (await fs.readdir(tmp)).filter((name) =>
        name.startsWith('subc-dsh.'),
      );
      if (leftovers.length === 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.deepEqual(leftovers, [], 'dsh overlay was not removed');
  });
}

test('an agent killed by a signal subc cannot re-raise is not reported as success', async () => {
  const pipeDir = await fs.mkdtemp(path.join(testDir, 'pipe-'));
  await fs.writeFile(
    path.join(pipeDir, 'codex'),
    '#!/usr/bin/env bash\n[ "$1" = --version ] && { echo "codex-cli 0.200.0"; exit 0; }\nkill -PIPE $$\n',
    { mode: 0o755 },
  );
  const home = await fs.mkdtemp(path.join(testDir, 'home-'));
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, 'bin/cli.js'), 'codex', 'headless', 'go'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${pipeDir}:${process.env.PATH}`,
        HOME: home,
        SUBC_CONFIG_DIR: path.join(home, 'subc'),
        SUBCONSCIOUS_API_KEY: 'sk-test',
        SUBCONSCIOUS_BASE_URL: 'http://127.0.0.1:9',
        SUBCONSCIOUS_MODEL: MODEL,
      },
    },
  );
  assert.equal(result.status, 128 + os.constants.signals.SIGPIPE);
});

test('profile flags do not change whether subc sees a headless run', async () => {
  // Without -p this is "--model headless": a normal launch with model
  // "headless". Both subc and the runbook must agree on that.
  const result = await runSubc([
    'codex',
    '--model',
    '-p',
    'default',
    'headless',
    'do it',
  ]);
  const argv = await recordedArgv();
  const runbookHeadless = argv.includes('exec');
  assert.equal(runbookHeadless, false, argv.join(' '));
  assert.match(result.stdout, /Launching/);
  assert.match(result.fetched, /registry\.npmjs\.org/);
  // Not headless, so a later --profile= is subc's profile flag.
  const profiled = await runSubc([
    'codex',
    '--model',
    '-p',
    'default',
    'headless',
    '--profile=nope',
  ]);
  assert.match(profiled.stderr, /Profile 'nope' does not exist/);
});

test('the dsh overlay is removed when the whole process group is stopped', async () => {
  const { spawn } = await import('node:child_process');
  const groupDir = await fs.mkdtemp(path.join(testDir, 'group-'));
  const tmp = await fs.mkdtemp(path.join(testDir, 'tmp-'));
  const pidFile = path.join(groupDir, 'pid');
  await fs.writeFile(
    path.join(groupDir, 'dsh'),
    `#!/usr/bin/env bash\necho $$ >"${pidFile}"\nexec sleep 60\n`,
    { mode: 0o755 },
  );
  const runbook = spawn(
    'bash',
    [path.join(ROOT, 'bin/runbook/deepseek-harness/run.sh'), 'headless', 'go'],
    {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        PATH: `${groupDir}:${process.env.PATH}`,
        TMPDIR: tmp,
        GATEWAY_URL: 'https://gateway.example',
        API_KEY: 'sk-test',
        MODEL,
        SUBCONSCIOUS_MODELS: MODEL,
        SUBC_ENV_FILE: os.devNull,
      },
    },
  );
  const exited = new Promise((resolve) => runbook.on('exit', resolve));
  let started = false;
  for (let i = 0; i < 100 && !started; i++) {
    started = Boolean(await fs.readFile(pidFile, 'utf8').catch(() => ''));
    if (!started) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(started, 'dsh never started');
  process.kill(-runbook.pid, 'SIGTERM');
  await exited;
  let leftovers = [];
  for (let i = 0; i < 40; i++) {
    leftovers = (await fs.readdir(tmp)).filter((name) =>
      name.startsWith('subc-dsh.'),
    );
    if (leftovers.length === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.deepEqual(leftovers, [], 'dsh overlay leaked after a group stop');
});
