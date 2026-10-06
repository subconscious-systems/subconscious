import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { AGENTS, agentById, installAdvice } from '../bin/agent-data.js';
import { loadHarnessManifest } from '../bin/harness-manifest.js';

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const PIPE_TO_SHELL =
  /\|\s*(?:ba|z)?sh\b|\|\s*iex\b|\birm\s+http|\bInvoke-Expression\b/i;
const DSH = agentById('deepseek-harness');

test('agent files link an official install page and pipe nothing into a shell', () => {
  for (const agent of AGENTS) {
    assert.match(agent.install.url, /^https:\/\//, agent.id);
    for (const [os, command] of Object.entries(agent.install.commands ?? {})) {
      assert.ok(['darwin', 'linux', 'win32'].includes(os), `${agent.id}.${os}`);
      assert.doesNotMatch(command, PIPE_TO_SHELL, `${agent.id}: ${command}`);
    }
    assert.equal(agent.runbook.binary_install_script, undefined, agent.id);
  }
});

test('install advice never gives Windows a Unix command', () => {
  assert.deepEqual(installAdvice(DSH, 'win32'), {
    command: 'npm i -g @deepseek-ai/dsh',
    url: 'https://www.deepseek.com/harness/en/',
  });
  const unixOnly = { install: { commands: { linux: 'x' }, url: 'https://a' } };
  assert.equal(installAdvice(unixOnly, 'win32').command, null);
  assert.equal(installAdvice(unixOnly, 'darwin').command, 'x');
  assert.equal(installAdvice(agentById('pi'), 'linux').command, null);
});

test('the harness manifest carries each install page', () => {
  const { harnesses } = loadHarnessManifest();
  for (const agent of AGENTS)
    assert.equal(harnesses[agent.id].install.url, agent.install.url);
});

async function fakeNpmDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-policy-'));
  const bin = path.join(dir, 'bin');
  await fs.mkdir(bin);
  const marker = path.join(dir, 'npm-install-ran');
  await fs.writeFile(
    path.join(bin, 'npm'),
    `#!/bin/sh\ncase " $* " in *" i "*|*" install "*) echo "$*" > '${marker}' ;; esac\nexit 0\n`,
    { mode: 0o755 },
  );
  const preload = path.join(dir, 'tty.mjs');
  await fs.writeFile(
    preload,
    'process.stdin.isTTY = true;\nprocess.stdout.isTTY = true;\n',
  );
  return { dir, bin, marker, preload };
}

const dshElsewhere = ['/opt/homebrew/bin/dsh', '/usr/local/bin/dsh'].some(
  existsSync,
);

test('a missing agent in an interactive terminal prints how to install it and exits 127', {
  skip: process.platform === 'win32' || dshElsewhere,
}, async () => {
  const { dir, bin, marker, preload } = await fakeNpmDir();
  const result = spawnSync(
    process.execPath,
    ['--import', preload, CLI, 'dsh'],
    {
      encoding: 'utf8',
      input: 'y\ny\n',
      timeout: 20000,
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        HOME: dir,
        SUBC_CONFIG_DIR: path.join(dir, 'subc'),
        SUBCONSCIOUS_API_KEY: 'sk-test',
        SUBCONSCIOUS_BASE_URL: 'http://127.0.0.1:9',
        SUBC_DISABLE_UPDATE_CHECK: '1',
      },
    },
  );
  assert.equal(result.status, 127, result.stderr);
  assert.match(result.stderr, /DeepSeek Harness isn't installed/);
  assert.match(result.stderr, /npm i -g @deepseek-ai\/dsh/);
  assert.match(result.stderr, /https:\/\/www\.deepseek\.com\/harness\/en\//);
  assert.doesNotMatch(result.stderr + result.stdout, /Install it now\?/);
  assert.equal(existsSync(marker), false, 'subc ran an installer');
});

test('Windows: a missing agent prints how to install it and exits 127', async () => {
  const { runWindowsAgent } = await import('../bin/windows/agents.js');
  const { extractModel, parseAgentAction } = await import('../bin/agents.js');
  const { dir } = await fakeNpmDir();
  const saved = {
    PATH: process.env.PATH,
    exitCode: process.exitCode,
    stdin: process.stdin.isTTY,
    stdout: process.stdout.isTTY,
  };
  const errors = [];
  const error = console.error;
  process.env.PATH = dir;
  process.stdin.isTTY = true;
  process.stdout.isTTY = true;
  console.error = (...parts) => errors.push(parts.join(' '));
  try {
    const code = await runWindowsAgent(DSH, [], {
      profile: { name: 'default', values: {} },
      parseAgentAction,
      extractModel,
      requireApiKey: async () => 'sk-test',
      resolvedModelsForLaunch: async () => ({
        models: ['subconscious/test'],
        source: 'packaged',
      }),
      selectLaunchModel: () => 'subconscious/test',
      runbookEnv: () => ({}),
    });
    assert.equal(code, 127);
  } finally {
    console.error = error;
    process.env.PATH = saved.PATH;
    process.exitCode = saved.exitCode;
    process.stdin.isTTY = saved.stdin;
    process.stdout.isTTY = saved.stdout;
  }
  const text = errors.join('\n');
  assert.match(text, /DeepSeek Harness isn't installed/);
  assert.match(text, /Install it with: npm i -g @deepseek-ai\/dsh/);
  assert.match(text, /Official install page: https:\/\/www\.deepseek\.com/);
});
