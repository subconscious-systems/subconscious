import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { modelSupportsVision } from '../bin/model-capabilities.js';

const visionModel = 'subconscious/deepseek-v4.1-flash-marathon';
const registry = JSON.parse(
  readFileSync(
    new URL('../bin/registry.generated.json', import.meta.url),
    'utf8',
  ),
);
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
  assert.ok(registry.defaults.models.includes(visionModel));
  const opencode = registry.agents.find((agent) => agent.id === 'opencode');
  const models =
    opencode.env.OPENCODE_CONFIG_CONTENT.$json.provider.subconscious.models;
  assert.equal(models[visionModel].attachment, true);
  assert.deepEqual(models[visionModel].modalities, {
    input: ['text', 'image'],
    output: ['text'],
  });
});

test('generated capability data matches the registry source', () => {
  const source = JSON.parse(
    readFileSync(new URL('../agents/registry.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(registry.modelCapabilities, source.modelCapabilities);
  assert.deepEqual(registry.defaults, source.defaults);
});

test('Unix capability lookup agrees with Windows for exact IDs', {
  skip: process.platform === 'win32',
}, () => {
  const helper = new URL(
    '../bin/runbook/model-capabilities.generated.sh',
    import.meta.url,
  ).pathname;
  for (const [id, expected] of cases) {
    const result = spawnSync(
      'bash',
      [
        '-c',
        'source "$1"; subc_model_supports_vision "$2"',
        'test',
        helper,
        id,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, expected ? 0 : 1, `${id}: ${result.stderr}`);
  }
});
