import { BRAND_ORANGE, colorEnabled } from './colors.js';

// The compact terminal raster used by Subconscious Code. It preserves the
// proportions of logo.svg while remaining crisp in an 8-row terminal cell.
export const LOGO_GLYPH = '✻';
export const LOGO_ART_SMALL_LINES = [
  '   ███▄  ▄███',
  '   ████  ████',
  '       ██',
  '▄██▄▄ ▄██▄ ▄▄██▄',
  '▀███▀ ▀██▀ ▀███▀',
  '       ██',
  '   ████  ████',
  '   ███▀  ▀███',
];
export const LOGO_ART_SMALL = LOGO_ART_SMALL_LINES.join('\n');

const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export function renderBanner(options = {}) {
  const isTTY = options.isTTY ?? process.stdout.isTTY === true;
  const term = options.term ?? process.env.TERM;
  const color = options.color ?? colorEnabled;
  const title = color ? `${BOLD}Subconscious CLI${RESET}` : 'Subconscious CLI';

  // Avoid multi-line art in logs and pipes. Interactive NO_COLOR sessions
  // still get the same logo without ANSI styling.
  if (!isTTY || term === 'dumb') return `  ${title}`;

  const logo = color ? `${BRAND_ORANGE}${LOGO_ART_SMALL}${RESET}` : LOGO_ART_SMALL;
  return `${logo}\n\n  ${title}`;
}
