import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkHarnessManifestChange,
  runbookChanges,
} from '../scripts/lib/harness-manifest-check.js';

const MANIFEST = 'bin/harness-manifest.generated.json';

test('runbook script changes are the files that matter', () => {
  assert.deepEqual(
    runbookChanges([
      'bin/runbook/codex/run.sh',
      'bin/runbook/pi/settings.json',
      'bin/runbook/README.md',
      'bin/runbook/model-capabilities.generated.sh',
      'bin/cli.js',
      'README.md',
    ]),
    ['bin/runbook/codex/run.sh', 'bin/runbook/pi/settings.json'],
  );
});

test('no runbook change passes', () => {
  const result = checkHarnessManifestChange({
    changedFiles: ['bin/cli.js', 'README.md'],
    messages: [],
  });
  assert.equal(result.ok, true);
});

test('a runbook change without a manifest change fails', () => {
  const result = checkHarnessManifestChange({
    changedFiles: ['bin/runbook/codex/run.sh'],
    messages: ['fix: tweak codex launch'],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.runbookFiles, ['bin/runbook/codex/run.sh']);
  assert.match(result.message, /bin\/runbook\/codex\/run\.sh/);
  assert.match(result.message, /Harness-Manifest: unchanged/);
});

test('a runbook change with a manifest change passes', () => {
  const result = checkHarnessManifestChange({
    changedFiles: [
      'bin/runbook/codex/run.sh',
      'agents/registry.json',
      MANIFEST,
    ],
    messages: [],
  });
  assert.equal(result.ok, true);
});

test('the opt-out trailer passes, in a commit or the PR body', () => {
  for (const text of [
    'fix: reword a log line\n\nHarness-Manifest: unchanged',
    'harness-manifest:   UNCHANGED',
  ]) {
    const result = checkHarnessManifestChange({
      changedFiles: ['bin/runbook/codex/run.sh'],
      messages: ['chore: other', text],
    });
    assert.equal(result.ok, true, text);
  }
});

test('the trailer must be on its own line', () => {
  const result = checkHarnessManifestChange({
    changedFiles: ['bin/runbook/codex/run.sh'],
    messages: ['fix: no Harness-Manifest: unchanged here'],
  });
  assert.equal(result.ok, false);
});
