// ANSI color helpers shared across the CLI. Keep redirected output machine
// readable and honor the standard NO_COLOR opt-out.
const noColor = Object.prototype.hasOwnProperty.call(process.env, 'NO_COLOR');
const forceColor =
  process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '0';

export const colorEnabled =
  !noColor &&
  process.env.TERM !== 'dumb' &&
  (forceColor || process.stdout.isTTY === true);

const ansi = (code) => (colorEnabled ? `\x1b[${code}m` : '');
const rgb = (red, green, blue) =>
  colorEnabled ? `\x1b[38;2;${red};${green};${blue}m` : '';
const bgRgb = (red, green, blue) =>
  colorEnabled ? `\x1b[48;2;${red};${green};${blue}m` : '';
// Match the Subconscious Code brand palette exactly (#FF5C27).
export const BRAND_ORANGE = '\x1b[38;2;255;92;39m';

export const c = {
  reset: ansi(0),
  bold: ansi(1),
  dim: ansi(2),
  cyan: ansi(36),
  green: ansi(32),
  red: ansi(31),
  yellow: ansi(33),
  magenta: ansi(35),
  black: ansi(30),
  orange: colorEnabled ? BRAND_ORANGE : '',
  orangeSoft: rgb(184, 74, 30),
  bgOrange: bgRgb(255, 92, 39),
  underline: ansi(4),
  inverse: ansi(7),
};
