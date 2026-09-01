import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { c } from './colors.js';

export const PACKAGE_NAME = 'subconscious-cli';
export const UPDATE_CHECK_TIMEOUT_MS = 1500;
const UPDATE_ACTIONS = ['Update now', 'Skip for now'];

function parseVersion(version) {
  const match = String(version)
    .trim()
    .match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    core: match.slice(1, 4).map(Number),
    prerelease: match[4]?.split('.') || [],
  };
}

function comparePrerelease(a, b) {
  if (!a.length && !b.length) return 0;
  if (!a.length) return 1;
  if (!b.length) return -1;

  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if (a[index] === undefined) return -1;
    if (b[index] === undefined) return 1;
    if (a[index] === b[index]) continue;

    const aNumber = /^\d+$/.test(a[index]) ? Number(a[index]) : null;
    const bNumber = /^\d+$/.test(b[index]) ? Number(b[index]) : null;
    if (aNumber !== null && bNumber !== null) return Math.sign(aNumber - bNumber);
    if (aNumber !== null) return -1;
    if (bNumber !== null) return 1;
    return a[index].localeCompare(b[index]);
  }
  return 0;
}

export function compareVersions(a, b) {
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);
  if (!parsedA || !parsedB) return 0;

  for (let index = 0; index < parsedA.core.length; index++) {
    if (parsedA.core[index] !== parsedB.core[index]) {
      return Math.sign(parsedA.core[index] - parsedB.core[index]);
    }
  }
  return comparePrerelease(parsedA.prerelease, parsedB.prerelease);
}

export async function currentVersion() {
  const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf-8'));
  return pkg.version;
}

export async function fetchLatestVersion(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? UPDATE_CHECK_TIMEOUT_MS;
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  try {
    const response = await fetchImpl(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache, no-store',
        Pragma: 'no-cache',
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`npm returned HTTP ${response.status}`);
    const payload = await response.json();
    if (!parseVersion(payload?.version)) throw new Error('npm returned an invalid version');
    return payload.version;
  } finally {
    clearTimeout(timeout);
  }
}

export function renderUpdateNotice(installedVersion, latestVersion) {
  const title = 'Subconscious CLI update available';
  const versions = `${installedVersion} -> ${latestVersion}`;
  const width = Math.max(title.length, versions.length);
  const border = `+${'-'.repeat(width + 2)}+`;
  const row = (text, style = '') =>
    `${c.yellow}|${c.reset} ${style}${text.padEnd(width)}${c.reset} ${c.yellow}|${c.reset}`;

  return [
    `  ${c.yellow}${border}${c.reset}`,
    `  ${row(title, c.bold)}`,
    `  ${row(versions, c.cyan)}`,
    `  ${c.yellow}${border}${c.reset}`,
  ].join('\n');
}

export function renderUpdateOptions(selectedIndex = 0, versions = {}) {
  const descriptions = [
    `Runs \`npm install -g ${PACKAGE_NAME}@latest\``,
    versions.installedVersion
      ? `Continue this command with version ${versions.installedVersion}`
      : 'Continue this command without updating',
  ];

  return UPDATE_ACTIONS.map((label, index) => {
    const active = index === selectedIndex;
    const pointer = active ? `${c.cyan}>${c.reset}` : ' ';
    const option = active
      ? `${c.inverse}${c.bold} ${label} ${c.reset}`
      : ` ${label} `;
    const descriptionStyle = active ? c.cyan : c.dim;
    return `  ${pointer} ${option}\n      ${descriptionStyle}${descriptions[index]}${c.reset}`;
  }).join('\n');
}

export function moveUpdateSelection(selectedIndex, keyName) {
  if (keyName === 'up') {
    return (selectedIndex - 1 + UPDATE_ACTIONS.length) % UPDATE_ACTIONS.length;
  }
  if (keyName === 'down') return (selectedIndex + 1) % UPDATE_ACTIONS.length;
  return selectedIndex;
}

export async function selectUpdateAction(options = {}) {
  const input = options.input || process.stdin;
  const output = options.output || process.stderr;
  const initiallyRaw = input.isRaw === true;
  let selectedIndex = options.selectedIndex ?? 0;
  const instructions = `  ${c.dim}Use ↑/↓ to select • Enter to confirm${c.reset}`;
  const render = () =>
    `${renderUpdateOptions(selectedIndex, {
      installedVersion: options.installedVersion,
      latestVersion: options.latestVersion,
    })}\n\n${instructions}`;
  const renderedLineCount = render().split('\n').length;

  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  output.write(`\x1b[?25l${render()}`);

  return new Promise((resolve) => {
    const finish = (action) => {
      input.off('keypress', onKeypress);
      if (!initiallyRaw) input.setRawMode(false);
      input.pause();
      output.write('\n\x1b[?25h');
      resolve(action);
    };

    const onKeypress = (_character, key = {}) => {
      if (key.ctrl && key.name === 'c') {
        process.exitCode = 130;
        finish('cancel');
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        finish(selectedIndex === 0 ? 'update' : 'skip');
        return;
      }

      const nextIndex = moveUpdateSelection(selectedIndex, key.name);
      if (nextIndex === selectedIndex) return;
      selectedIndex = nextIndex;
      output.write(`\r\x1b[${renderedLineCount - 1}A\x1b[0J${render()}`);
    };

    input.on('keypress', onKeypress);
  });
}

export async function installLatest(options = {}) {
  const spawnImpl = options.spawnImpl || spawn;
  return new Promise((resolve) => {
    const child = spawnImpl('npm', ['install', '-g', `${PACKAGE_NAME}@latest`], {
      stdio: 'inherit',
    });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

export async function showUpdateNotice(options = {}) {
  const disabled =
    options.disabled ?? process.env.SUBC_DISABLE_UPDATE_CHECK?.trim() === '1';
  if (disabled) return null;

  try {
    const installedVersion = options.currentVersion || (await currentVersion());
    const latestVersion =
      options.latestVersion ||
      (await fetchLatestVersion({
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      }));
    if (compareVersions(latestVersion, installedVersion) <= 0) return null;

    const notice = renderUpdateNotice(installedVersion, latestVersion);
    const write = options.write || ((text) => process.stderr.write(text));
    write(`\n${notice}\n\n`);

    const interactive =
      options.interactive ?? (process.stdin.isTTY === true && process.stderr.isTTY === true);
    if (!interactive) return { installedVersion, latestVersion, action: 'skip' };

    const select = options.select || selectUpdateAction;
    const action = await select({ installedVersion, latestVersion });
    if (action === 'cancel') return { installedVersion, latestVersion, action };
    if (action === 'skip') {
      write(`\n  ${c.dim}Skipping update.${c.reset}\n\n`);
      return { installedVersion, latestVersion, action };
    }

    write(`\n  ${c.cyan}Updating ${PACKAGE_NAME} to ${latestVersion}...${c.reset}\n\n`);
    const install = options.install || installLatest;
    const installed = await install();
    if (installed) {
      write(
        `\n  ${c.green}${c.bold}Update complete.${c.reset} Re-run your subc command.\n\n`,
      );
      return { installedVersion, latestVersion, action: 'updated' };
    }

    write(`\n  ${c.red}Update failed.${c.reset} Try it manually:\n\n`);
    write(`    ${c.cyan}npm install -g ${PACKAGE_NAME}@latest${c.reset}\n\n`);
    return { installedVersion, latestVersion, action: 'failed' };
  } catch {
    // Update discovery must never prevent the requested command from running.
    return null;
  }
}
