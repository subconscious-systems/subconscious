import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import {
  buildHandoffPrompt,
  discoverSessions,
  handoffLaunchArgs,
  nativeResumeArgs,
  readSessionMessages,
} from '../bin/sessions.js';

let root;
let roots;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-sessions-test-'));
  roots = Object.fromEntries(
    ['claude', 'codex', 'pi', 'sc'].map((harness) => [
      harness,
      path.join(root, harness),
    ]),
  );
  await Promise.all(
    Object.values(roots).map((directory) =>
      fs.mkdir(directory, { recursive: true }),
    ),
  );

  await fs.writeFile(
    path.join(roots.claude, 'claude-id.jsonl'),
    [
      {
        type: 'ai-title',
        aiTitle: 'Repair the parser',
        sessionId: 'claude-id',
      },
      {
        type: 'user',
        cwd: '/work/parser',
        sessionId: 'claude-id',
        message: { role: 'user', content: 'Fix parser edge cases' },
      },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          model: 'subconscious/test',
          content: [
            { type: 'text', text: 'I added the failing test.' },
            { type: 'tool_use', input: { secret: true } },
          ],
        },
      },
    ]
      .map(JSON.stringify)
      .join('\n'),
  );
  await fs.writeFile(
    path.join(roots.codex, 'rollout-codex-id.jsonl'),
    [
      { type: 'session_meta', payload: { id: 'codex-id', cwd: '/work/codex' } },
      { type: 'turn_context', payload: { model: 'subconscious/codex' } },
      {
        type: 'response_item',
        payload: {
          role: 'user',
          content: [{ type: 'input_text', text: 'Review the patch' }],
        },
      },
      {
        type: 'response_item',
        payload: {
          role: 'assistant',
          content: [{ type: 'output_text', text: 'The patch is clean.' }],
        },
      },
    ]
      .map(JSON.stringify)
      .join('\n'),
  );
  await fs.writeFile(
    path.join(roots.pi, 'pi-id.jsonl'),
    [
      { type: 'session', id: 'pi-id', cwd: '/work/pi' },
      { type: 'message', message: { role: 'user', content: 'Build the UI' } },
      {
        type: 'message',
        message: {
          role: 'assistant',
          model: 'subconscious/pi',
          content: [{ type: 'text', text: 'UI built.' }],
        },
      },
    ]
      .map(JSON.stringify)
      .join('\n'),
  );
  await fs.writeFile(
    path.join(roots.sc, 'session-sc-id.jsonl'),
    [
      { id: 'session-sc-id', cwd: '/work/sc', model: 'subconscious/sc' },
      { type: 'user', content: 'Run the tests' },
      {
        type: 'assistant',
        text: 'Tests pass.',
        reasoning: 'hidden chain of thought',
      },
    ]
      .map(JSON.stringify)
      .join('\n'),
  );
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function fakeOpenCode(command, args) {
  assert.equal(command, 'opencode');
  const query = args.at(-1);
  if (query.includes('from session where')) {
    return {
      status: 0,
      stdout: JSON.stringify([
        {
          id: 'open-id',
          title: 'OpenCode migration',
          directory: '/work/open',
          time_created: 100,
          time_updated: 200,
          model: JSON.stringify({ id: 'subconscious/open' }),
        },
      ]),
    };
  }
  return {
    status: 0,
    stdout: JSON.stringify([
      { role: 'user', text: 'Migrate the endpoint' },
      { role: 'assistant', text: 'Endpoint migrated.' },
    ]),
  };
}

test('discovers supported native sessions with stable harness keys', async () => {
  const sessions = await discoverSessions({
    roots,
    execute: fakeOpenCode,
    max: 20,
  });
  assert.deepEqual(
    new Set(sessions.map((session) => session.key)),
    new Set([
      'claude:claude-id',
      'codex:codex-id',
      'opencode:open-id',
      'pi:pi-id',
      'sc:sc-id',
    ]),
  );
  const claude = sessions.find((session) => session.harness === 'claude');
  assert.equal(claude.title, 'Repair the parser');
  assert.equal(claude.cwd, '/work/parser');
  assert.equal(claude.model, 'subconscious/test');
});

test('builds a bounded text-only handoff without tools or hidden reasoning', async () => {
  const sessions = await discoverSessions({
    roots,
    execute: fakeOpenCode,
    max: 20,
  });
  const claude = sessions.find((session) => session.harness === 'claude');
  const messages = await readSessionMessages(claude);
  const prompt = buildHandoffPrompt(claude, messages);
  assert.match(prompt, /originally run in Claude Code/);
  assert.match(prompt, /Fix parser edge cases/);
  assert.match(prompt, /I added the failing test/);
  assert.doesNotMatch(prompt, /secret|tool_use|reasoning/);
  assert.ok(prompt.length <= 25_500);

  const openCode = sessions.find((session) => session.harness === 'opencode');
  const openMessages = await readSessionMessages(openCode, {
    execute: fakeOpenCode,
  });
  assert.deepEqual(openMessages, [
    { role: 'user', text: 'Migrate the endpoint' },
    { role: 'assistant', text: 'Endpoint migrated.' },
  ]);

  const sc = sessions.find((session) => session.harness === 'sc');
  assert.match(
    buildHandoffPrompt(sc, await readSessionMessages(sc)),
    /Run the tests/,
  );
});

test('maps native resumes and portable launches to each harness CLI', () => {
  assert.deepEqual(nativeResumeArgs({ harness: 'claude', id: 'abc' }), [
    '--resume',
    'abc',
  ]);
  assert.deepEqual(nativeResumeArgs({ harness: 'codex', id: 'abc' }), [
    'resume',
    'abc',
  ]);
  assert.deepEqual(nativeResumeArgs({ harness: 'opencode', id: 'abc' }), [
    '--session',
    'abc',
  ]);
  assert.deepEqual(
    nativeResumeArgs({ harness: 'pi', id: 'abc', sourcePath: '/tmp/pi.jsonl' }),
    ['--session', '/tmp/pi.jsonl'],
  );
  assert.deepEqual(
    nativeResumeArgs({ harness: 'sc', id: 'abc', sourcePath: '/tmp/sc.jsonl' }),
    ['--resume', '/tmp/sc.jsonl'],
  );
  assert.deepEqual(handoffLaunchArgs('codex', 'context'), ['context']);
  assert.deepEqual(handoffLaunchArgs('opencode', 'context'), [
    '--prompt',
    'context',
  ]);
});

test('session discovery ignores non-object JSONL records in history indexes', async () => {
  const indexes = {
    claude: path.join(root, 'claude-history.jsonl'),
    codex: path.join(root, 'codex-index.jsonl'),
  };
  const junk = [null, false, 123, 'unexpected record', []];
  await fs.writeFile(
    indexes.claude,
    [
      ...junk,
      { sessionId: 'claude-id', display: 'Indexed Claude', timestamp: 1 },
    ]
      .map(JSON.stringify)
      .join('\n'),
  );
  await fs.writeFile(
    indexes.codex,
    [
      ...junk,
      {
        id: 'codex-id',
        thread_name: 'Indexed Codex',
        updated_at: '2026-01-01',
      },
    ]
      .map(JSON.stringify)
      .join('\n'),
  );
  const sessions = await discoverSessions({
    roots,
    indexes,
    execute: () => ({ status: 1 }),
  });
  assert.equal(
    sessions.find((session) => session.key === 'claude:claude-id')?.title,
    'Indexed Claude',
  );
  assert.equal(
    sessions.find((session) => session.key === 'codex:codex-id')?.title,
    'Indexed Codex',
  );
});

test('transcript readers ignore non-object JSONL records without losing messages', async () => {
  const records = [
    null,
    false,
    123,
    'unexpected record',
    [],
    { type: 'user', content: 'Keep this message' },
  ];
  for (const harness of ['claude', 'codex', 'pi', 'sc']) {
    const sourcePath = path.join(root, `mixed-${harness}.jsonl`);
    const message =
      harness === 'codex'
        ? {
            type: 'event_msg',
            payload: { type: 'user_message', message: 'Keep this message' },
          }
        : harness === 'pi'
          ? {
              type: 'message',
              message: { role: 'user', content: 'Keep this message' },
            }
          : records.at(-1);
    await fs.writeFile(
      sourcePath,
      [...records.slice(0, -1), message].map(JSON.stringify).join('\n'),
    );
    assert.deepEqual(await readSessionMessages({ harness, sourcePath }), [
      { role: 'user', text: 'Keep this message' },
    ]);
  }
});
