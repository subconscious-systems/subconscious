import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const extensionUrl = new URL(
  '../bin/runbook/pi/subconscious-compaction.ts',
  import.meta.url,
).href;

test('Pi compaction loads credentials from PI_CODING_AGENT_DIR', {
  skip: Number(process.versions.node.split('.')[0]) < 22,
}, async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'subc-pi-compact-'),
  );
  try {
    await fs.writeFile(
      path.join(directory, 'subconscious.env'),
      [
        "export SUBCONSCIOUS_GATEWAY_URL='https://custom-pi.example'",
        "export SUBCONSCIOUS_API_KEY='sk-custom-pi-test'",
      ].join('\n'),
    );
    const script = path.join(directory, 'check.mjs');
    await fs.writeFile(
      script,
      `
const handlers = {};
const calls = [];
globalThis.fetch = async (url, options) => {
  calls.push({ url, authorization: options.headers.authorization, body: JSON.parse(options.body) });
  return {};
};
const { default: extension } = await import(${JSON.stringify(extensionUrl)});
extension({ on: (event, handler) => { handlers[event] = handler; } });
const context = { sessionManager: { getSessionId: () => 'session-test' } };
await handlers.session_before_compact({}, context);
await handlers.session_compact({}, context);
process.stdout.write(JSON.stringify(calls));
`,
    );
    const environment = {
      ...process.env,
      HOME: directory,
      USERPROFILE: directory,
      PI_CODING_AGENT_DIR: directory,
    };
    for (const key of [
      'SUBCONSCIOUS_GATEWAY_URL',
      'SUBCONSCIOUS_API_KEY',
      'GATEWAY_URL',
      'API_KEY',
      'PI_API_KEY',
    ])
      delete environment[key];
    for (const overrides of [
      {},
      { SUBCONSCIOUS_API_KEY: 'sk-override-test' },
      {
        SUBCONSCIOUS_API_KEY: 'sk-override-test',
        SUBCONSCIOUS_GATEWAY_URL: 'https://override.example/',
      },
    ]) {
      const { stdout } = await execute(
        process.execPath,
        ['--experimental-strip-types', script],
        { env: { ...environment, ...overrides } },
      );
      const calls = JSON.parse(stdout);
      assert.equal(calls.length, 2);
      for (const call of calls) {
        assert.equal(
          call.url,
          `${(overrides.SUBCONSCIOUS_GATEWAY_URL || 'https://custom-pi.example').replace(/\/+$/, '')}/v1/agent-hooks`,
        );
        assert.equal(
          call.authorization,
          `Bearer ${overrides.SUBCONSCIOUS_API_KEY || 'sk-custom-pi-test'}`,
        );
        assert.equal(call.body.conversation_id, 'session-test');
      }
      assert.deepEqual(
        calls.map((call) => call.body.phase),
        ['start', 'end'],
      );
    }
    await fs.rm(path.join(directory, 'subconscious.env'));
    const missing = await execute(
      process.execPath,
      ['--experimental-strip-types', script],
      { env: environment },
    );
    assert.deepEqual(JSON.parse(missing.stdout), []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
