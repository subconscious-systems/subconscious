/**
 * Self-update for the Subconscious CLI (`subc upgrade`).
 *
 *   subc upgrade           Interactive confirm, then install @latest
 *   subc upgrade --latest  Skip the prompt and install @latest
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { c } from './colors.js';

export const PACKAGE_NAME = 'subconscious-cli';
export const MIN_LOGIN_VERSION = '4.0';

export function parseUpgradeArgs(argv = []) {
  const latest = argv.includes('--latest');
  const unknown = argv.filter((arg) => arg !== '--latest');
  if (unknown.length) {
    throw new Error(`Unknown argument: ${unknown[0]}\nUsage: subc upgrade [--latest]`);
  }
  return { latest };
}

export function detectInstallCommand(here = fileURLToPath(import.meta.url)) {
  const normalized = here.replace(/\\/g, '/');
  if (normalized.includes('/.pnpm/') || normalized.includes('/pnpm/global/')) {
    return `pnpm add -g ${PACKAGE_NAME}@latest`;
  }
  if (normalized.includes('/.yarn/') || normalized.includes('/yarn/global/')) {
    return `yarn global add ${PACKAGE_NAME}@latest`;
  }
  if (normalized.includes('/.bun/install/global/')) {
    return `bun add -g ${PACKAGE_NAME}@latest`;
  }
  return `npm install -g ${PACKAGE_NAME}@latest`;
}

export async function currentCliVersion() {
  const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf-8'));
  return pkg.version;
}

export function compareVersions(a, b) {
  const pa = String(a).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const pb = String(b).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

export async function fetchLatestVersion(fetchImpl = fetch) {
  const res = await fetchImpl(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`Could not look up ${PACKAGE_NAME} on npm (${res.status}).`);
  }
  const data = await res.json();
  if (!data?.version) throw new Error(`npm did not return a version for ${PACKAGE_NAME}.`);
  return data.version;
}

export function printLoginUpgradeWarning() {
  console.error();
  console.error(
    `  ${c.yellow}Upgrade to version ${MIN_LOGIN_VERSION} to login.${c.reset}`,
  );
  console.error(`  This login URL is no longer available (404).`);
  console.error();
  console.error(`  Run ${c.cyan}subc upgrade --latest${c.reset}`);
  console.error();
}

function askYesNo(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === '' || a === 'y' || a === 'yes');
    });
  });
}

function runInstall(command) {
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, stdio: 'inherit' });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

export async function installLatest(options = {}) {
  const install = options.install || runInstall;
  const fetchLatest = options.fetchLatest || fetchLatestVersion;
  const current = options.currentVersion || (await currentCliVersion());
  const command = options.command || detectInstallCommand();

  let latest;
  try {
    latest = await fetchLatest();
  } catch (error) {
    console.error(`  ${c.yellow}${error.message}${c.reset}`);
    console.error(`  ${c.dim}Installing @latest anyway.${c.reset}\n`);
  }

  if (latest && compareVersions(current, latest) >= 0) {
    console.log(`\n  ${c.green}Already up to date${c.reset} ${c.dim}(${current}).${c.reset}\n`);
    return true;
  }

  if (latest) {
    console.log(
      `\n  Upgrading ${c.cyan}${PACKAGE_NAME}${c.reset} ${c.dim}${current}${c.reset} → ${c.cyan}${latest}${c.reset}`,
    );
  } else {
    console.log(`\n  Upgrading ${c.cyan}${PACKAGE_NAME}${c.reset} ${c.dim}${current}${c.reset} → latest`);
  }
  console.log(`  ${c.dim}Running${c.reset} ${c.cyan}${command}${c.reset}\n`);

  const ok = await install(command);
  if (!ok) {
    console.error(`\n  ${c.red}Upgrade failed.${c.reset} Try it manually:\n`);
    console.error(`    ${c.cyan}${command}${c.reset}\n`);
    return false;
  }

  console.log(`\n  ${c.green}${c.bold}✓ Upgraded.${c.reset} Re-run ${c.cyan}subc login${c.reset} if you were signing in.\n`);
  return true;
}

export async function upgradeCommand(argv = [], options = {}) {
  const { latest } = parseUpgradeArgs(argv);
  const interactive = options.interactive ?? (process.stdin.isTTY && process.stdout.isTTY);
  const ask = options.ask || askYesNo;
  const installLatestFn = options.installLatest || installLatest;

  if (!latest) {
    if (!interactive) {
      console.error(
        `\n  ${c.yellow}Do you want to upgrade?${c.reset} requires a TTY.`,
      );
      console.error(`  Run ${c.cyan}subc upgrade --latest${c.reset} instead.\n`);
      process.exitCode = 1;
      return;
    }

    const ok = await ask(`  Do you want to upgrade? ${c.dim}[Y/n]${c.reset} `);
    if (!ok) {
      console.log(`\n  ${c.dim}Upgrade cancelled.${c.reset}\n`);
      return;
    }
  }

  const succeeded = await installLatestFn();
  if (!succeeded) process.exitCode = 1;
}
