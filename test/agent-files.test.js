import assert from 'node:assert/strict';
import { accessSync, constants, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  AGENTS,
  agentInputs,
  RUNBOOK_DIR,
  validateAgent,
} from '../bin/agent-data.js';
import { launchPlan } from '../bin/agent-launch.js';

const SUBC_FLAGS = new Set(['--model', '-p', '--profile', '--help', '-h']);
// Set by the launcher itself rather than declared by an agent.
const LAUNCHER_ENV = new Set(['SUBC_CLAUDE_SETTINGS']);
const REF = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

const env = {
  GATEWAY_URL: 'https://gateway.example',
  API_KEY: 'sk-test',
  MODEL: 'subconscious/glm-5.3-marathon',
  SUBCONSCIOUS_MODELS: 'subconscious/glm-5.3-marathon',
  SUBC_CLAUDE_SETTINGS: '{}',
};

function readAgentFile(id) {
  return JSON.parse(
    readFileSync(path.join(RUNBOOK_DIR, id, 'agent.json'), 'utf8'),
  );
}

test('every agent file is listed once in shared.json, and nothing else is', () => {
  const withFiles = readdirSync(RUNBOOK_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((dir) =>
      readdirSync(path.join(RUNBOOK_DIR, dir)).includes('agent.json'),
    )
    .sort();
  const listed = AGENTS.map((agent) => agent.id);
  assert.deepEqual([...listed].sort(), withFiles);
  assert.equal(new Set(listed).size, listed.length);
});

test('every agent file passes validation and names scripts that exist', () => {
  for (const agent of AGENTS) {
    validateAgent(readAgentFile(agent.id), agent.id);
    const { script, setup_script } = agent.runbook;
    for (const file of [script, setup_script]) {
      if (!file) continue;
      accessSync(path.join(RUNBOOK_DIR, agent.id, file), constants.R_OK);
    }
  }
});

test('commands and aliases route to exactly one agent', () => {
  const names = AGENTS.flatMap((agent) => [
    agent.id,
    agent.command,
    ...agent.aliases,
  ]);
  const seen = new Map();
  for (const agent of AGENTS)
    for (const name of new Set([agent.id, agent.command, ...agent.aliases])) {
      assert.ok(!seen.has(name), `${name}: ${seen.get(name)} and ${agent.id}`);
      seen.set(name, agent.id);
    }
  assert.ok(names.length > 0);
});

test('flags are unique per agent and never shadow subc flags', () => {
  for (const agent of AGENTS) {
    const flags = agentInputs(agent)
      .map((input) => input.flag)
      .filter(Boolean);
    assert.equal(new Set(flags).size, flags.length, agent.id);
    for (const flag of flags) assert.ok(!SUBC_FLAGS.has(flag), flag);
  }
});

test('every env reference points at an input, env entry, or launcher value', () => {
  for (const agent of AGENTS) {
    const known = new Set([
      ...agentInputs(agent).map((input) => input.name),
      ...agent.env.map((entry) => entry.name),
      ...LAUNCHER_ENV,
    ]);
    const text = JSON.stringify(agent);
    for (const [, name] of text.matchAll(REF))
      assert.ok(known.has(name), `${agent.id}: \${${name}} is not declared`);
  }
});

test('every launch template renders, interactive and headless', () => {
  for (const agent of AGENTS.filter((item) => item.launch)) {
    const plan = launchPlan(agent, { env, args: ['--extra'] });
    assert.equal(plan.argv[0], agent.launch.argv[0], agent.id);
    assert.ok(plan.argv.includes('--extra'), agent.id);
    if (!agent.launch.headless_argv) continue;
    const headless = launchPlan(agent, { env, prompt: 'task' });
    assert.equal(headless.argv[0], agent.launch.headless_argv[0], agent.id);
  }
});

test('headless agents declare where they run; others declare nothing', () => {
  for (const agent of AGENTS) {
    const launch = agent.launch ?? {};
    assert.equal(
      Boolean(launch.headless_platforms),
      Boolean(launch.headless_argv),
      agent.id,
    );
  }
});

test('validation names the file and the problem', () => {
  const codex = readAgentFile('codex');
  const cases = [
    [{ ...codex, id: 'other' }, /codex\/agent\.json: id must be codex/],
    [{ ...codex, aliases: 'codex' }, /aliases must be a list/],
    [{ ...codex, runbook: { ...codex.runbook, mode: 'run' } }, /runbook\.mode/],
    [
      {
        ...codex,
        runbook: { mode: 'setup', setup_actions: ['install'] },
      },
      /setup actions need runbook\.setup_script/,
    ],
    [
      { ...codex, launch: { ...codex.launch, headless_platforms: ['beos'] } },
      /headless_platforms/,
    ],
    [{ ...codex, env: [{ name: 'X' }] }, /X has no value/],
    [{ ...codex, inputs: [{ name: 'X', flag: '-x' }] }, /bad flag -x/],
    [{ ...codex, inputs: [{ name: 'X', strict: true }] }, /X needs choices/],
    [{ ...codex, inputs: [{ name: 'lower' }] }, /bad name lower/],
  ];
  for (const [data, message] of cases)
    assert.throws(() => validateAgent(data, 'codex'), message);
});
