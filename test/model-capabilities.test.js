import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { DEFAULTS } from '../bin/agent-data.js';
import {
  modelSupportsVision,
  visionModelList,
  visionModelListFromMetadata,
} from '../bin/model-capabilities.js';
import { openCodeConfigFromEnv } from '../bin/opencode-provider.js';

const visionModel = 'subconscious/deepseek-v4.1-flash-marathon';
const cases = [
  [visionModel, true],
  ['subconscious/deepseek-v4-flash-marathon', false],
  [`${visionModel}-other`, false],
  ['deepseek-v4.1-flash-marathon', false],
  ['test-dsv4-vision', false],
  ['subconscious/glm-5.3-marathon', false],
  ['custom/model', false],
  ['__proto__', false],
  ['', false],
];

test('vision capabilities match only the exact gateway model ID', () => {
  for (const [id, expected] of cases)
    assert.equal(modelSupportsVision(id), expected, id);
  assert.ok(DEFAULTS.models.includes(visionModel));
  const config = openCodeConfigFromEnv({
    GATEWAY_URL: 'https://gateway.example',
    MODEL: visionModel,
    OPENCODE_CONTEXT_LIMIT: '1000',
    OPENCODE_OUTPUT_LIMIT: '100',
  });
  const model = config.provider.subconscious.models[visionModel];
  assert.equal('attachment' in model, false);
  assert.deepEqual(model.modalities, {
    input: ['text', 'image'],
    output: ['text'],
  });
});

test('the runbooks agree with Node on vision models, by exact ID', {
  skip: process.platform === 'win32',
}, () => {
  const lib = new URL('../bin/runbook/lib.sh', import.meta.url).pathname;
  for (const [id, expected] of cases) {
    const result = spawnSync(
      'bash',
      ['-c', 'source "$1"; subc_model_supports_vision "$2"', 'test', lib, id],
      {
        encoding: 'utf8',
        env: { ...process.env, SUBC_VISION_MODELS: visionModelList() },
      },
    );
    assert.equal(result.status, expected ? 0 : 1, `${id}: ${result.stderr}`);
  }
});

test('catalog metadata overrides the packaged vision map', () => {
  const entries = [
    {
      id: 'custom/new-vision-model',
      modalities: { input: ['text', 'image'], output: ['text'] },
    },
    {
      id: visionModel,
      modalities: { input: ['text'], output: ['text'] },
    },
    { id: 'subconscious/no-modality-data' },
  ];
  assert.equal(modelSupportsVision('custom/new-vision-model', entries), true);
  // The packaged map says this one has vision; the gateway says it does not.
  assert.equal(modelSupportsVision(visionModel, entries), false);
  assert.equal(
    modelSupportsVision('subconscious/no-modality-data', entries),
    false,
  );
  assert.equal(modelSupportsVision('unlisted/model', entries), false);
});

test('visionModelListFromMetadata prefers catalog entries and falls back to the packaged map', () => {
  const metadata = JSON.stringify([
    { id: 'subconscious/one', modalities: { input: ['text', 'image'] } },
    { id: 'subconscious/two', modalities: { input: ['text'] } },
  ]);
  assert.equal(visionModelListFromMetadata(metadata), 'subconscious/one');
  assert.equal(visionModelListFromMetadata('[]'), visionModelList());
  assert.equal(visionModelListFromMetadata('not json'), visionModelList());
  assert.equal(visionModelListFromMetadata(undefined), visionModelList());
});

test('opencode config takes per-model limits and vision from catalog metadata', () => {
  const config = openCodeConfigFromEnv({
    GATEWAY_URL: 'https://gateway.example',
    MODEL: 'subconscious/one',
    SUBCONSCIOUS_MODELS: 'subconscious/one\nsubconscious/two',
    OPENCODE_CONTEXT_LIMIT: '1000',
    OPENCODE_OUTPUT_LIMIT: '100',
    SUBC_MODEL_METADATA: JSON.stringify([
      {
        id: 'subconscious/one',
        limits: { context_length: 200000, max_output_tokens: 32000 },
        modalities: { input: ['text', 'image'], output: ['text'] },
      },
      { id: 'subconscious/two' },
    ]),
  });
  const one = config.provider.subconscious.models['subconscious/one'];
  assert.deepEqual(one.limit, { context: 200000, output: 32000 });
  assert.deepEqual(one.modalities, {
    input: ['text', 'image'],
    output: ['text'],
  });
  const two = config.provider.subconscious.models['subconscious/two'];
  assert.deepEqual(two.limit, { context: 1000, output: 100 });
  assert.equal('modalities' in two, false);
});
