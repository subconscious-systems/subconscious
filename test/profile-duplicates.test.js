import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const root = await fs.mkdtemp(
  path.join(os.tmpdir(), 'subc-profile-duplicates-'),
);
process.env.SUBC_CONFIG_DIR = root;
const { clearProfileApiKey, ensureProfile, loadProfile, updateProfile } =
  await import('../bin/profiles.js');
after(async () => fs.rm(root, { recursive: true, force: true }));

test('profile updates replace every duplicate definition while preserving other lines', async () => {
  const original = await ensureProfile('duplicates', 'sk-first');
  await fs.appendFile(
    original.path,
    '\n# Keep this comment\nexport API_KEY=sk-second\r\nAPI_KEY=sk-last\nexport GATEWAY_URL=https://old.example\nMODEL=subconscious/old\nCUSTOM_VALUE=keep-me\n',
  );
  const updated = await updateProfile('duplicates', {
    API_KEY: 'sk-new',
    GATEWAY_URL: 'https://new.example',
    MODEL: '',
  });
  assert.equal(updated.values.API_KEY, 'sk-new');
  assert.equal(updated.values.GATEWAY_URL, 'https://new.example');
  assert.equal(updated.values.MODEL, '');
  const text = await fs.readFile(updated.path, 'utf8');
  assert.match(text, /# Keep this comment/);
  assert.match(text, /CUSTOM_VALUE=keep-me/);
  assert.doesNotMatch(
    text,
    /sk-first|sk-second|sk-last|https:\/\/old\.example|subconscious\/old/,
  );
});

test('clearing a key removes its effective value from all duplicate definitions', async () => {
  const profile = await ensureProfile('logout-duplicates', 'sk-first');
  await fs.appendFile(
    profile.path,
    'export API_KEY=sk-second\nAPI_KEY=sk-last\n',
  );
  assert.equal(await clearProfileApiKey('logout-duplicates'), true);
  assert.equal((await loadProfile('logout-duplicates')).values.API_KEY, '');
  assert.equal(await clearProfileApiKey('logout-duplicates'), false);
});
