import { BRAND_ORANGE, colorEnabled } from './colors.js';

// Pre-rendered from assets/imgs/logo.png as portable, 7-bit ASCII art.
const LOGO = [
  '       #####        #####',
  '      #######      #######',
  '     ########      ########',
  '      ########    ########',
  '             ######',
  '               ##',
  ' ######       ####       ######',
  '##########  ########  ##########',
  '##########  ########  ##########',
  ' ######       ####       ######',
  '               ##',
  '             ######',
  '       #######    #######',
  '      #######      #######',
  '      #######      #######',
  '      ######        #####',
].join('\n');

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

  const logo = color ? `${BRAND_ORANGE}${LOGO}${RESET}` : LOGO;
  return `${logo}\n\n  ${title}`;
}
