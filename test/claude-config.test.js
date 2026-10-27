import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { claudeSourceDir } from '../bin/claude-config.js';

const roots = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function tempHome(prefix) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(home);
  return home;
}

/** A folder plain claude has used: it holds a settings.json. */
function claudeConfigFolder(home) {
  const folder = path.join(home, 'claude-personal');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'settings.json'), '{}');
  return folder;
}

test('claudeSourceDir is ~/.claude unless the user set a Claude config folder', () => {
  const home = tempHome('subc-claude-source-');
  assert.equal(claudeSourceDir({ env: {}, home }), path.join(home, '.claude'));
  assert.equal(
    claudeSourceDir({ env: { CLAUDE_CONFIG_DIR: 'relative/claude' }, home }),
    path.join(home, '.claude'),
    'a relative CLAUDE_CONFIG_DIR still means ~/.claude',
  );
  const stranger = path.join(home, 'not-a-claude-dir');
  fs.mkdirSync(stranger);
  assert.equal(
    claudeSourceDir({ env: { CLAUDE_CONFIG_DIR: stranger }, home }),
    path.join(home, '.claude'),
    'a folder Claude Code has never used still means ~/.claude',
  );
});

test('claudeSourceDir uses a user-set CLAUDE_CONFIG_DIR that names a Claude config', () => {
  const home = tempHome('subc-claude-own-');
  const own = claudeConfigFolder(home);
  assert.equal(claudeSourceDir({ env: { CLAUDE_CONFIG_DIR: own }, home }), own);
});

test('the retired SUBC_CLAUDE_CONFIG_SOURCE override no longer redirects', () => {
  const home = tempHome('subc-claude-source-env-');
  const own = claudeConfigFolder(home);
  assert.equal(
    claudeSourceDir({
      env: { SUBC_CLAUDE_CONFIG_SOURCE: own },
      home,
    }),
    path.join(home, '.claude'),
    'a 6.3-era shell still carrying the source env reads ~/.claude',
  );
});
