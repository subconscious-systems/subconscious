import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOGO_ART_SMALL,
  LOGO_GLYPH,
  renderBanner,
} from '../bin/branding.js';

test('terminal banner uses the compact Subconscious Code logo', () => {
  const banner = renderBanner({ isTTY: true, term: 'xterm-256color', color: false });

  assert.match(banner, /▄██▄▄ ▄██▄ ▄▄██▄/);
  assert.match(banner, /▀███▀ ▀██▀ ▀███▀/);
  assert.ok(banner.startsWith(LOGO_ART_SMALL));
  assert.equal(LOGO_GLYPH, '✻');
});

test('non-interactive banner remains compact', () => {
  assert.equal(
    renderBanner({ isTTY: false, color: false }),
    '  Subconscious CLI',
  );
});
