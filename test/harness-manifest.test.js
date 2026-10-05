import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { AGENTS, agentInputs } from '../bin/agent-data.js';
import { MIN_CLAUDE_CODE_VERSION, MIN_CODEX_VERSION } from '../bin/agents.js';
import {
  HARNESS_MANIFEST_SCHEMA_VERSION,
  loadHarnessManifest,
} from '../bin/harness-manifest.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI = path.join(ROOT, 'bin', 'cli.js');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const manifest = loadHarnessManifest();

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: process.env,
  });
}

test('there is one harness per agent file, in shared.json order', () => {
  assert.deepEqual(
    Object.keys(manifest.harnesses),
    AGENTS.map((agent) => agent.id),
  );
});

test('each harness is its agent file, with references resolved', () => {
  for (const agent of AGENTS) {
    const harness = manifest.harnesses[agent.id];
    assert.deepEqual(harness.launch, agent.launch ?? null, agent.id);
    assert.deepEqual(harness.prerequisites, agent.prerequisites, agent.id);
    assert.equal(harness.install.method, agent.install.method, agent.id);
    assert.equal(harness.binary, agent.launch?.argv[0] ?? null, agent.id);
    const envNames = harness.env.map((entry) => entry.name);
    for (const entry of agent.env) assert.ok(envNames.includes(entry.name));
    for (const input of agentInputs(agent).filter((item) => item.export))
      assert.ok(envNames.includes(input.name), `${agent.id}: ${input.name}`);
  }
  const text = JSON.stringify(manifest.harnesses);
  const unresolved = [...text.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g)].map(
    ([, name]) => name,
  );
  assert.deepEqual([...new Set(unresolved)], ['SUBC_CLAUDE_SETTINGS']);
  assert.doesNotMatch(text, /\{package\}/);
  assert.doesNotMatch(text, new RegExp(ROOT.replaceAll('\\', '\\\\')));
});

test('compaction knobs carry the input defaults and where to change them', () => {
  const { claude, codex, pi } = {
    claude: manifest.harnesses['claude-code'].capabilities.compaction,
    codex: manifest.harnesses.codex.capabilities.compaction,
    pi: manifest.harnesses.pi.capabilities.compaction,
  };
  assert.equal(claude.threshold.value, '1000000');
  assert.deepEqual(claude.threshold.override, [
    'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
    'COMPACT_WINDOW',
    '--compact-window',
  ]);
  assert.deepEqual(
    { min: claude.threshold.range.min, max: claude.threshold.range.max },
    { min: 100000, max: 1000000 },
  );
  assert.equal(codex.threshold.value, 4500000);
  assert.equal(pi.threshold.value, 5000000);
});

test('the OpenCode config entry is the document the launch builds', () => {
  const entry = manifest.harnesses.opencode.config.find(
    (item) => item.name === 'OPENCODE_CONFIG_CONTENT',
  );
  const provider = entry.value.provider.subconscious;
  assert.deepEqual(provider.models['<id>'].limit, {
    context: 5000000,
    output: 65536,
  });
  assert.equal(provider.options.baseURL, '{baseUrl}/v1');
  assert.match(entry.value.plugin[0], /^<runbook>\/opencode\//);
});

test('the fields bench-runner reads are present for every harness', () => {
  assert.equal(manifest.schema_version, HARNESS_MANIFEST_SCHEMA_VERSION);
  for (const [id, harness] of Object.entries(manifest.harnesses)) {
    assert.ok('method' in harness.install, id);
    for (const entry of harness.env) {
      assert.equal(typeof entry.name, 'string', id);
      assert.equal(typeof entry.value, 'string', `${id}: ${entry.name}`);
    }
    for (const entry of harness.config) assert.ok(entry.kind, id);
    const { compaction, mcp } = harness.capabilities;
    assert.ok(['on', 'unknown'].includes(compaction.default), id);
    for (const mode of ['on', 'off', 'threshold']) {
      for (const field of ['set_by_subc', 'kind', 'name', 'value', 'verified'])
        assert.ok(field in compaction[mode], `${id}.${mode}.${field}`);
    }
    assert.equal(typeof mcp.configured_by_subc, 'boolean', id);
  }
  assert.deepEqual(manifest.harnesses.codex.launch.resume, [
    'resume',
    '{sessionId}',
  ]);
});

test('minimum versions come from the agent files', () => {
  assert.equal(
    manifest.harnesses['claude-code'].install.minimum_version,
    MIN_CLAUDE_CODE_VERSION,
  );
  assert.equal(
    manifest.harnesses.codex.install.minimum_version,
    MIN_CODEX_VERSION,
  );
});

test('every unverified value explains itself', () => {
  const missing = [];
  const walk = (value, where) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        walk(item, `${where}[${index}]`);
      });
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (value.verified === false && !value.note) missing.push(where);
    for (const [key, child] of Object.entries(value))
      walk(child, `${where}.${key}`);
  };
  walk(manifest.harnesses, 'harnesses');
  assert.deepEqual(missing, []);
});

test('harness-manifest prints the same manifest as JSON with the CLI version', () => {
  const result = runCli(['harness-manifest', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const printed = JSON.parse(result.stdout);
  assert.equal(printed.cli_version, pkg.version);
  assert.deepEqual(printed, manifest);
});

test('harness-manifest defaults to JSON when stdout is not a terminal', () => {
  const result = runCli(['harness-manifest']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    JSON.parse(result.stdout).schema_version,
    HARNESS_MANIFEST_SCHEMA_VERSION,
  );
});

test('harness-manifest rejects unknown arguments and prints help', () => {
  const bad = runCli(['harness-manifest', '--yaml']);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Unknown argument: --yaml/);
  const help = runCli(['harness-manifest', 'help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /subc harness-manifest \[--json\]/);
});
