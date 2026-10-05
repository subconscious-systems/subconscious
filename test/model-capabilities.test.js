import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { DEFAULTS } from '../bin/agent-data.js';
import {
  modelSupportsVision,
  visionModelList,
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
  assert.equal(model.attachment, true);
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
