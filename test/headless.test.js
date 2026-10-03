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

const PROMPT = 'fix the "bug"\nthen run -p --model trick';
const EXTRA = ['--extra-flag'];
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
await fs.mkdir(binDir, { recursive: true });
for (const bin of ['claude', 'codex', 'opencode', 'pi', 'marathon', 'dsh']) {
  await fs.writeFile(
    path.join(binDir, bin),
    `#!/usr/bin/env bash\nprintf '%s\\0' "$@" >"$HEADLESS_ARGV_FILE"\n`,
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
      },
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
    const argv = manifest.harnesses[id].launch.headless_argv;
    assert.ok(argv, `${id}: manifest has no headless_argv`);
    await fs.rm(argsFile, { force: true });
    const result = runRunbook(agent, ['headless', PROMPT, ...EXTRA]);
    assert.equal(result.status, 0, `${id}: ${result.stderr}`);
    // The stub writes nothing to stdout, so anything here is runbook noise.
    assert.equal(result.stdout, '', `${id} wrote to stdout`);
    const actual = [argv[0], ...(await recordedArgv())];
    matchArgv(argv, actual);
  }
});

test('headless without a prompt fails before launching', async () => {
  for (const id of HEADLESS_AGENTS) {
    await fs.rm(argsFile, { force: true });
    const result = runRunbook(agentById(id), ['headless']);
    assert.equal(result.status, 2, `${id}: ${result.stderr}`);
    assert.match(result.stderr, /headless PROMPT/, id);
    await assert.rejects(fs.access(argsFile), `${id} launched anyway`);
  }
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
  assert.throws(
    () => parseAgentAction(agentById('cursor'), ['headless', 'go']),
    /does not support headless/,
  );
});
