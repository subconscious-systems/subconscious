import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { test } from 'node:test';
import {
  PACKAGE_NAME,
  compareVersions,
  detectInstallCommand,
  installLatest,
  parseUpgradeArgs,
  printLoginUpgradeWarning,
  upgradeCommand,
} from '../bin/upgrade.js';

process.env.NO_COLOR = '1';

const cliPath = new URL('../bin/cli.js', import.meta.url);
const packageVersion = JSON.parse(
  await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'),
).version;

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath.pathname, ...args], {
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('parseUpgradeArgs accepts --latest and rejects unknown flags', () => {
  assert.deepEqual(parseUpgradeArgs([]), { latest: false });
  assert.deepEqual(parseUpgradeArgs(['--latest']), { latest: true });
  assert.throws(() => parseUpgradeArgs(['--force']), /Unknown argument: --force/);
});

test('detectInstallCommand picks the package manager from the install path', () => {
  assert.equal(
    detectInstallCommand('/Users/me/Library/pnpm/global/5/.pnpm/subconscious-cli@4.0.0/bin/upgrade.js'),
    `pnpm add -g ${PACKAGE_NAME}@latest`,
  );
  assert.equal(
    detectInstallCommand('/Users/me/.yarn/berry/global/node_modules/subconscious-cli/bin/upgrade.js'),
    `yarn global add ${PACKAGE_NAME}@latest`,
  );
  assert.equal(
    detectInstallCommand('/Users/me/.bun/install/global/node_modules/subconscious-cli/bin/upgrade.js'),
    `bun add -g ${PACKAGE_NAME}@latest`,
  );
  assert.equal(
    detectInstallCommand('/usr/local/lib/node_modules/subconscious-cli/bin/upgrade.js'),
    `npm install -g ${PACKAGE_NAME}@latest`,
  );
});

test('compareVersions orders semver-ish strings', () => {
  assert.equal(compareVersions('4.0.0', '0.3.1'), 1);
  assert.equal(compareVersions('0.3.1', '4.0.0'), -1);
  assert.equal(compareVersions('4.0.0', '4.0.0'), 0);
});

test('printLoginUpgradeWarning tells the user to run subc upgrade --latest', () => {
  const lines = [];
  const orig = console.error;
  console.error = (msg = '') => lines.push(String(msg));
  try {
    printLoginUpgradeWarning();
  } finally {
    console.error = orig;
  }
  const text = lines.join('\n');
  assert.match(text, /Upgrade to version 4\.0 to login/);
  assert.match(text, /subc upgrade --latest/);
});

test('subc upgrade prompts, and --latest skips the prompt', async () => {
  let asked = '';
  let installed = 0;

  await upgradeCommand([], {
    interactive: true,
    ask: async (question) => {
      asked = question;
      return true;
    },
    installLatest: async () => {
      installed += 1;
      return true;
    },
  });
  assert.match(asked, /Do you want to upgrade/);
  assert.equal(installed, 1);

  asked = '';
  await upgradeCommand(['--latest'], {
    interactive: true,
    ask: async (question) => {
      asked = question;
      return true;
    },
    installLatest: async () => {
      installed += 1;
      return true;
    },
  });
  assert.equal(asked, '');
  assert.equal(installed, 2);
});

test('subc upgrade without a TTY points at --latest', async () => {
  const errors = [];
  const orig = console.error;
  const prevExit = process.exitCode;
  console.error = (msg = '') => errors.push(String(msg));
  try {
    await upgradeCommand([], {
      interactive: false,
      installLatest: async () => {
        throw new Error('should not install');
      },
    });
    assert.equal(process.exitCode, 1);
    assert.match(errors.join('\n'), /subc upgrade --latest/);
  } finally {
    console.error = orig;
    process.exitCode = prevExit ?? 0;
  }
});

test('installLatest skips npm when this version is already newest', async () => {
  let installed = false;
  const logs = [];
  const orig = console.log;
  console.log = (msg = '') => logs.push(String(msg));
  try {
    const ok = await installLatest({
      currentVersion: '4.0.0',
      fetchLatest: async () => '0.3.1',
      install: async () => {
        installed = true;
        return true;
      },
    });
    assert.equal(ok, true);
    assert.equal(installed, false);
    assert.match(logs.join('\n'), /Already up to date/);
  } finally {
    console.log = orig;
  }
});

test('cli help lists upgrade and reports the package version', async () => {
  const help = await runCli(['help']);
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /upgrade/);
  assert.match(help.stdout, /subc upgrade --latest/);

  const upgradeHelp = await runCli(['upgrade', 'help']);
  assert.equal(upgradeHelp.code, 0, upgradeHelp.stderr);
  assert.match(upgradeHelp.stdout, /subc upgrade --latest/);

  const version = await runCli(['-v']);
  assert.equal(version.code, 0, version.stderr);
  assert.equal(version.stdout.trim(), packageVersion);
});
