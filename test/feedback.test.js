import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  buildFeedbackPayload,
  FEEDBACK_API_PATH,
  loadFeedbackImages,
  parseFeedbackArgs,
  submitFeedback,
} from '../bin/feedback.js';

test('parseFeedbackArgs reads short and long flags', () => {
  assert.deepEqual(parseFeedbackArgs(['-s', 'Bug', '-m', 'Playground stuck']), {
    subject: 'Bug',
    message: 'Playground stuck',
    images: [],
  });
  assert.deepEqual(
    parseFeedbackArgs([
      '--subject=Bug',
      '--message=Playground stuck',
      '--image=shot.png',
    ]),
    { subject: 'Bug', message: 'Playground stuck', images: ['shot.png'] },
  );
});

test('parseFeedbackArgs trims and tolerates empty input', () => {
  assert.deepEqual(parseFeedbackArgs([]), {
    subject: '',
    message: '',
    images: [],
  });
  assert.deepEqual(parseFeedbackArgs(['-s', '  ', '-m', ' hi ']), {
    subject: '',
    message: 'hi',
    images: [],
  });
});

test('parseFeedbackArgs rejects unknown options', () => {
  assert.throws(() => parseFeedbackArgs(['--nope']), /Unknown option: --nope/);
});

test('parseFeedbackArgs rejects missing option values and subsequent flags', () => {
  for (const flag of ['-s', '--subject', '-m', '--message', '--image']) {
    for (const next of [
      undefined,
      '-m',
      '--subject=Bug',
      '--image',
      '--unknown',
    ]) {
      const argv = next === undefined ? [flag] : [flag, next];
      assert.throws(() => parseFeedbackArgs(argv), {
        message: `${flag} requires a value`,
      });
    }
  }
});

test('parseFeedbackArgs preserves text values and explicit option-like values', () => {
  assert.deepEqual(
    parseFeedbackArgs([
      '-s',
      '',
      '-m',
      '- Fix this\nUnicode: \u00e9',
      '--image',
      '-shot.png',
    ]),
    {
      subject: '',
      message: '- Fix this\nUnicode: \u00e9',
      images: ['-shot.png'],
    },
  );
  assert.deepEqual(
    parseFeedbackArgs([
      '--subject=--message',
      '--message=--image=shot.png',
      '--image=--shot.png',
    ]),
    {
      subject: '--message',
      message: '--image=shot.png',
      images: ['--shot.png'],
    },
  );
});

test('buildFeedbackPayload defaults the subject and drops empty context', () => {
  assert.deepEqual(
    buildFeedbackPayload({
      subject: '',
      message: 'hello',
      context: { 'CLI version': '1.2.3', OS: '', Node: '  ' },
    }),
    {
      subject: 'CLI feedback',
      message: 'hello',
      context: { 'CLI version': '1.2.3' },
    },
  );
});

test('loadFeedbackImages includes a JPEG and omits images when none were given', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-feedback-'));
  const file = path.join(dir, 'shot.jpg');
  await fs.writeFile(file, Buffer.from([0xff, 0xd8, 0xff, 0x00]));
  const attachments = await loadFeedbackImages([file]);
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].contentType, 'image/jpeg');
  const withImages = buildFeedbackPayload({
    subject: 'Bug',
    message: 'hello',
    context: {},
    attachments,
  });
  assert.equal(withImages.attachments[0].contentType, 'image/jpeg');
  const without = buildFeedbackPayload({
    subject: 'Bug',
    message: 'hello',
    context: {},
  });
  assert.equal(without.attachments, undefined);
  await fs.rm(dir, { recursive: true, force: true });
});

test('submitFeedback posts JSON with the bearer key', async () => {
  const calls = [];
  const res = { ok: true, status: 200, json: async () => ({ ok: true }) };
  const fetchImpl = (url, init) => {
    calls.push({ url, init });
    return res;
  };

  const out = await submitFeedback(
    'sk-test',
    'https://platform.example.com/',
    {
      subject: 'Bug',
      message: 'Playground stuck',
      context: {},
    },
    fetchImpl,
  );

  assert.equal(out, res);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `https://platform.example.com${FEEDBACK_API_PATH}`,
  );
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-test');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    subject: 'Bug',
    message: 'Playground stuck',
    context: {},
  });
});
