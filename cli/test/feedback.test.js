import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildFeedbackPayload,
  FEEDBACK_API_PATH,
  parseFeedbackArgs,
  submitFeedback,
} from '../bin/feedback.js';

test('parseFeedbackArgs reads short and long flags', () => {
  assert.deepEqual(parseFeedbackArgs(['-s', 'Bug', '-m', 'Playground stuck']), {
    subject: 'Bug',
    message: 'Playground stuck',
  });
  assert.deepEqual(
    parseFeedbackArgs(['--subject=Bug', '--message=Playground stuck']),
    { subject: 'Bug', message: 'Playground stuck' },
  );
});

test('parseFeedbackArgs trims and tolerates empty input', () => {
  assert.deepEqual(parseFeedbackArgs([]), { subject: '', message: '' });
  assert.deepEqual(parseFeedbackArgs(['-s', '  ', '-m', ' hi ']), {
    subject: '',
    message: 'hi',
  });
});

test('parseFeedbackArgs rejects unknown options', () => {
  assert.throws(() => parseFeedbackArgs(['--nope']), /Unknown option: --nope/);
});

test('buildFeedbackPayload defaults the subject and drops empty context', () => {
  assert.deepEqual(
    buildFeedbackPayload({
      subject: '',
      message: 'hello',
      context: { 'CLI version': '1.2.3', OS: '', Node: '  ' },
    }),
    { subject: 'CLI feedback', message: 'hello', context: { 'CLI version': '1.2.3' } },
  );
});

test('submitFeedback posts JSON with the bearer key', async () => {
  const calls = [];
  const res = { ok: true, status: 200, json: async () => ({ ok: true }) };
  const fetchImpl = (url, init) => {
    calls.push({ url, init });
    return res;
  };

  const out = await submitFeedback('sk-test', 'https://platform.example.com/', {
    subject: 'Bug',
    message: 'Playground stuck',
    context: {},
  }, fetchImpl);

  assert.equal(out, res);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://platform.example.com${FEEDBACK_API_PATH}`);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-test');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    subject: 'Bug',
    message: 'Playground stuck',
    context: {},
  });
});
