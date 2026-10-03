import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { MIN_CLAUDE_CODE_VERSION, MIN_CODEX_VERSION } from '../bin/agents.js';
import {
  buildHarnessManifest,
  HARNESS_MANIFEST_SCHEMA_VERSION,
} from '../scripts/lib/harness-manifest.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RUNBOOK_DIR = path.join(ROOT, 'bin', 'runbook');
const CLI = path.join(ROOT, 'bin', 'cli.js');

function readJson(relative) {
  return JSON.parse(readFileSync(path.join(ROOT, relative), 'utf8'));
}

const registry = readJson('agents/registry.json');
const generated = readJson('bin/harness-manifest.generated.json');
const pkg = readJson('package.json');

function runbookFile(dir, file) {
  return readFileSync(path.join(RUNBOOK_DIR, dir, file), 'utf8');
}

function harnessSources(harness, files) {
  return files
    .filter((file) =>
      readdirSync(path.join(RUNBOOK_DIR, harness.runbook.dir)).includes(file),
    )
    .map((file) => runbookFile(harness.runbook.dir, file))
    .join('\n');
}

function allHarnessFiles(harness) {
  const dir = path.join(RUNBOOK_DIR, harness.runbook.dir);
  return readdirSync(dir)
    .map((file) => readFileSync(path.join(dir, file), 'utf8'))
    .join('\n');
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: process.env,
  });
}

test('generated manifest matches what the registry builds', () => {
  assert.deepEqual(generated, buildHarnessManifest(registry));
  assert.equal(generated.schema_version, HARNESS_MANIFEST_SCHEMA_VERSION);
});

test('manifest build is deterministic', () => {
  assert.equal(
    JSON.stringify(buildHarnessManifest(registry)),
    JSON.stringify(buildHarnessManifest(registry)),
  );
});

test('every packaged agent with a runbook has a manifest entry', () => {
  const launchable = registry.agents
    .filter((agent) => agent.cli !== false && agent.runbook)
    .map((agent) => agent.id);
  assert.deepEqual(Object.keys(generated.harnesses), launchable);
  const runbookDirs = readdirSync(RUNBOOK_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((dir) =>
      readdirSync(path.join(RUNBOOK_DIR, dir)).some((file) =>
        /^(run|install)\.sh$/.test(file),
      ),
    )
    .sort();
  const manifestDirs = Object.values(generated.harnesses)
    .map((harness) => harness.runbook.dir)
    .sort();
  assert.deepEqual(manifestDirs, runbookDirs);
});

test('registry.generated.json does not carry harness data', () => {
  const cliData = readJson('bin/registry.generated.json');
  assert.equal(cliData.runbookEnv, undefined);
  for (const agent of cliData.agents) assert.equal(agent.harness, undefined);
});

test('manifest minimum versions match the launcher gates', () => {
  assert.equal(
    generated.harnesses['claude-code'].install.minimum_version,
    MIN_CLAUDE_CODE_VERSION,
  );
  assert.equal(
    generated.harnesses.codex.install.minimum_version,
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
  walk(generated.harnesses, 'harnesses');
  assert.deepEqual(missing, []);
});

test('drift: manifest env and inputs appear in each run.sh or install.sh', () => {
  for (const harness of Object.values(generated.harnesses)) {
    const scripts = harnessSources(harness, ['run.sh', 'install.sh']);
    for (const entry of [...harness.env, ...harness.inputs]) {
      assert.match(
        scripts,
        new RegExp(`\\b${entry.name}\\b`),
        `${harness.id}: ${entry.name} is not in run.sh or install.sh`,
      );
    }
    for (const entry of harness.env) {
      assert.match(
        runbookFile(harness.runbook.dir, entry.source),
        new RegExp(`\\b${entry.name}\\b`),
        `${harness.id}: ${entry.name} is not in ${entry.source}`,
      );
    }
  }
});

test('drift: compaction knobs subc sets appear in the runbook', () => {
  for (const harness of Object.values(generated.harnesses)) {
    const sources = allHarnessFiles(harness);
    for (const [mode, knob] of Object.entries(
      harness.capabilities.compaction,
    )) {
      if (!knob?.set_by_subc || !knob.name) continue;
      const leaf = knob.name.split('.').at(-1);
      assert.ok(
        sources.includes(leaf),
        `${harness.id}: compaction ${mode} knob ${knob.name} is not in the runbook`,
      );
    }
  }
});

test('drift: headers, hooks, and config files appear in the runbook', () => {
  for (const harness of Object.values(generated.harnesses)) {
    const sources = allHarnessFiles(harness);
    for (const header of harness.capabilities.headers) {
      if (!header.set_by_subc) continue;
      assert.ok(
        sources.includes(header.name),
        `${harness.id}: header ${header.name}`,
      );
      if (header.name === 'x-subconscious-client') {
        assert.ok(
          sources.includes(`x-subconscious-client: ${header.value}`) ||
            sources.includes(`"x-subconscious-client":"${header.value}"`) ||
            sources.includes(`"x-subconscious-client": "${header.value}"`),
          `${harness.id}: x-subconscious-client value ${header.value}`,
        );
      }
    }
    for (const hook of harness.capabilities.hooks) {
      assert.ok(sources.includes(hook.event), `${harness.id}: ${hook.event}`);
    }
    for (const file of harness.config.filter(
      (entry) => entry.kind === 'file',
    )) {
      const base = path.basename(file.path).replace('XXXXXX', '');
      const stem = base.split('..')[0];
      assert.ok(sources.includes(stem), `${harness.id}: ${file.path}`);
    }
  }
});

test('harness-manifest prints valid JSON with the schema version', () => {
  const result = runCli(['harness-manifest', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(result.stdout);
  assert.equal(manifest.schema_version, HARNESS_MANIFEST_SCHEMA_VERSION);
  assert.equal(manifest.cli_version, pkg.version);
  assert.equal(manifest._generated, undefined);
  assert.deepEqual(manifest.harnesses, generated.harnesses);
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
