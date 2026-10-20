import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AGENTS } from '../bin/agent-data.js';
import {
  formatDoctorReport,
  prerequisiteUsers,
  runDoctor,
} from '../bin/doctor.js';

const KEY = 'subc-test-key-1234567890';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function catalogResponse(ids) {
  return jsonResponse({ object: 'list', data: ids.map((id) => ({ id })) });
}

/** A fetch that answers the platform and gateway routes doctor calls. */
function fakeFetch({
  whoami = () => jsonResponse({ organization: 'Acme' }),
  available = () => catalogResponse(['subconscious/one', 'subconscious/two']),
  models = () => catalogResponse(['subconscious/public']),
} = {}) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const { pathname } = new URL(url);
    if (pathname === '/api/cli/whoami') return whoami(options);
    if (pathname === '/v1/models/available') return available(options);
    if (pathname === '/v1/models') return models(options);
    throw new Error(`unexpected request: ${url}`);
  };
  impl.calls = calls;
  return impl;
}

function profile(values = {}, overrides = {}) {
  return {
    name: 'default',
    path: '/home/test/.subconscious/profiles/default.env',
    exists: true,
    values: { GATEWAY_URL: 'https://gateway.test', ...values },
    ...overrides,
  };
}

/** Every check passes unless a test overrides one dependency. */
function healthy(overrides = {}) {
  return {
    profile: profile({ API_KEY: KEY }),
    profileName: 'default',
    env: {},
    platform: 'darwin',
    cliVersion: '6.2.1',
    nodeVersion: 'v22.0.0',
    latestVersion: async () => '6.2.1',
    fetch: fakeFetch(),
    getApiKey: async (p) =>
      p.values.API_KEY ? { key: p.values.API_KEY, source: p.path } : null,
    findBinary: async () => '/usr/local/bin',
    readVersion: () => '999.0.0',
    onPath: async () => true,
    ...overrides,
  };
}

function byId(report, id) {
  const found = report.checks.find((item) => item.id === id);
  assert.ok(found, `missing check ${id}`);
  return found;
}

test('a healthy setup passes every check', async () => {
  const report = await runDoctor(healthy());
  assert.equal(report.ok, true);
  assert.equal(report.summary.fail, 0);
  assert.equal(report.summary.warn, 0);
  assert.equal(byId(report, 'api-key').label, 'API key is valid (Acme)');
  assert.match(byId(report, 'gateway').label, /2 models for your key/);
});

test('the report never contains the API key', async () => {
  const report = await runDoctor(healthy());
  const text = JSON.stringify(report) + formatDoctorReport(report);
  assert.equal(text.includes(KEY), false);
});

test('a missing API key fails and points at login', async () => {
  const report = await runDoctor(
    healthy({ profile: profile(), profileName: 'default' }),
  );
  const auth = byId(report, 'api-key');
  assert.equal(auth.status, 'fail');
  assert.equal(auth.fix, 'subc login');
  assert.equal(report.ok, false);
});

test('a revoked key fails with the profile flag in the fix', async () => {
  const report = await runDoctor(
    healthy({
      profile: profile({ API_KEY: KEY }, { name: 'staging' }),
      profileName: 'staging',
      fetch: fakeFetch({ whoami: () => jsonResponse({}, 401) }),
    }),
  );
  const auth = byId(report, 'api-key');
  assert.equal(auth.status, 'fail');
  assert.equal(auth.fix, 'subc -p staging logout && subc -p staging login');
});

test('a platform error warns instead of blaming the key', async () => {
  const report = await runDoctor(
    healthy({ fetch: fakeFetch({ whoami: () => jsonResponse({}, 503) }) }),
  );
  assert.equal(byId(report, 'api-key').status, 'warn');
  assert.equal(report.ok, true);
});

test('a named profile that does not exist fails', async () => {
  const report = await runDoctor(
    healthy({
      profile: profile({}, { name: 'ghost', exists: false, values: {} }),
      profileName: 'ghost',
    }),
  );
  const check = byId(report, 'profile');
  assert.equal(check.status, 'fail');
  assert.equal(check.fix, 'subc -p ghost config --api-key KEY');
});

test('an unreachable gateway fails', async () => {
  const down = () => {
    throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
  };
  const report = await runDoctor(
    healthy({ fetch: fakeFetch({ available: down, models: down }) }),
  );
  const gateway = byId(report, 'gateway');
  assert.equal(gateway.status, 'fail');
  assert.match(gateway.detail, /https:\/\/gateway\.test: ECONNREFUSED/);
  assert.equal(byId(report, 'model').status, 'ok');
});

test('SUBCONSCIOUS_BASE_URL overrides the profile gateway', async () => {
  const fetch = fakeFetch();
  await runDoctor(
    healthy({ fetch, env: { SUBCONSCIOUS_BASE_URL: 'https://other.test' } }),
  );
  assert.ok(
    fetch.calls.some(({ url }) => url.startsWith('https://other.test/v1/')),
  );
  assert.ok(
    !fetch.calls.some(({ url }) => url.startsWith('https://gateway.test')),
  );
});

test('falling back to the public catalog warns when a key is set', async () => {
  const report = await runDoctor(
    healthy({
      fetch: fakeFetch({ available: () => jsonResponse({}, 500) }),
    }),
  );
  const gateway = byId(report, 'gateway');
  assert.equal(gateway.status, 'warn');
  assert.match(gateway.label, /public list/);
});

test('a model the gateway does not serve warns', async () => {
  const report = await runDoctor(
    healthy({ profile: profile({ API_KEY: KEY, MODEL: 'subconscious/gone' }) }),
  );
  const model = byId(report, 'model');
  assert.equal(model.status, 'warn');
  assert.match(model.detail, /subconscious\/one, subconscious\/two/);
});

test('a served model passes, and UNSET names the first catalog model', async () => {
  const served = await runDoctor(
    healthy({ profile: profile({ API_KEY: KEY, MODEL: 'subconscious/two' }) }),
  );
  assert.equal(byId(served, 'model').status, 'ok');

  const unset = await runDoctor(
    healthy({ profile: profile({ API_KEY: KEY, MODEL: 'UNSET' }) }),
  );
  assert.match(byId(unset, 'model').detail, /subconscious\/one/);
});

test('a newer CLI release warns and suggests subc upgrade', async () => {
  const report = await runDoctor(
    healthy({ latestVersion: async () => '7.0.0' }),
  );
  const cli = byId(report, 'cli-version');
  assert.equal(cli.status, 'warn');
  assert.equal(cli.fix, 'subc upgrade');
});

test('an npm registry failure does not fail the report', async () => {
  const report = await runDoctor(
    healthy({
      latestVersion: async () => {
        throw new Error('offline');
      },
    }),
  );
  assert.equal(byId(report, 'cli-version').status, 'info');
  assert.equal(report.ok, true);
});

test('an old Node.js fails', async () => {
  const report = await runDoctor(healthy({ nodeVersion: 'v16.20.0' }));
  assert.equal(byId(report, 'node-version').status, 'fail');
});

test('subc missing from PATH warns', async () => {
  const report = await runDoctor(healthy({ onPath: async () => false }));
  assert.equal(byId(report, 'cli-path').status, 'warn');
});

test('agents report missing, outdated, and current installs', async () => {
  const report = await runDoctor(
    healthy({
      findBinary: async (bin) => (bin === 'opencode' ? null : '/usr/local/bin'),
      readVersion: (bin) => (bin === 'codex' ? '0.1.0' : '999.0.0'),
    }),
  );

  const opencode = byId(report, 'agent:opencode');
  assert.equal(opencode.status, 'info');
  assert.equal(opencode.fix, 'npm i -g opencode-ai');

  const codex = byId(report, 'agent:codex');
  assert.equal(codex.status, 'warn');
  assert.match(codex.label, /0\.1\.0 is older than/);

  assert.equal(byId(report, 'agent:claude-code').status, 'ok');
  // A missing agent is not a problem until the user runs it.
  assert.equal(report.ok, true);
});

test('setup-only agents such as Cursor are not checked for a binary', async () => {
  const report = await runDoctor(healthy());
  assert.equal(
    report.checks.some((item) => item.id === 'agent:cursor'),
    false,
  );
});

test('Windows skips version reads that would need a shell', async () => {
  let reads = 0;
  const report = await runDoctor(
    healthy({
      platform: 'win32',
      readVersion: () => {
        reads += 1;
        return '0.0.1';
      },
    }),
  );
  assert.equal(reads, 0);
  assert.equal(byId(report, 'agent:codex').status, 'ok');
});

test('a missing required tool warns and names the agents that need it', async () => {
  const report = await runDoctor(
    healthy({
      findBinary: async (bin) => (bin === 'jq' ? null : '/usr/local/bin'),
    }),
  );
  const jq = byId(report, 'tool:jq');
  assert.equal(jq.status, 'warn');
  assert.match(jq.detail, /Required for Pi/);
});

test('prerequisiteUsers groups every agent that declares a tool', () => {
  const users = prerequisiteUsers(AGENTS);
  const jq = users.get('jq').map((user) => user.agent.id);
  assert.ok(jq.includes('pi'));
  assert.ok(jq.includes('codex'));
});

test('formatDoctorReport prints fixes and a summary', async () => {
  const report = await runDoctor(
    healthy({ profile: profile(), profileName: 'default' }),
  );
  const text = formatDoctorReport(report);
  assert.match(text, /No API key/);
  assert.match(text, /→ subc login/);
  assert.match(text, /1 failed/);
});
