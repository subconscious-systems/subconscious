import { execFileSync } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {
  agentBinary,
  agentById,
  agentCommandName,
  agentInstallDirs,
  installAdvice,
} from './agent-data.js';
import { c } from './colors.js';
import { compareVersions } from './update-check.js';

/**
 * Common locations a freshly-installed coding-agent binary lands in but which
 * are often NOT on the current process's PATH (e.g. aider/claude install into
 * `~/.local/bin`; npm globals into the npm prefix bin). Best-effort, deduped.
 */
export function candidateBinDirs() {
  const home = os.homedir();
  const dirs = [];

  if (process.platform === 'win32') {
    if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, 'npm'));
    if (process.env.USERPROFILE) {
      dirs.push(path.join(process.env.USERPROFILE, '.local', 'bin'));
    }
    if (home) dirs.push(path.join(home, '.local', 'bin'));
  } else {
    dirs.push(path.join(home, '.local', 'bin'));
    dirs.push(path.join(home, '.cargo', 'bin'));
    dirs.push('/opt/homebrew/bin');
    dirs.push('/usr/local/bin');
  }

  // npm global bin (best-effort — npm may be absent).
  try {
    const prefix = execFileSync('npm', ['prefix', '-g'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (prefix) {
      dirs.push(
        process.platform === 'win32' ? prefix : path.join(prefix, 'bin'),
      );
    }
  } catch {
    // npm not available — skip.
  }

  // Dedupe, drop empties.
  return [...new Set(dirs.filter(Boolean))];
}

/** The binary directory the agent's own installer uses, if it declares one. */
export function preferredBinDirsForAgent(
  agent,
  environment = process.env,
  home = os.homedir(),
) {
  return agentInstallDirs(agent, environment, home);
}

/** Executable extensions to probe (Windows uses PATHEXT). */
function binExts() {
  return process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];
}

/**
 * Resolve `bin` against PATH plus the candidate bin dirs. Returns the directory
 * containing the executable if found, otherwise null. Searching the candidate
 * dirs lets us find binaries installed this session that aren't on PATH yet.
 */
async function resolveBinPath(bin, preferredDirs = []) {
  const pathDirs = (process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean);
  const dirs = [
    ...new Set([...preferredDirs, ...pathDirs, ...candidateBinDirs()]),
  ];
  const exts = binExts();
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, bin + ext);
      try {
        await fs.access(candidate, fsConstants.F_OK);
        return dir;
      } catch {
        // keep scanning
      }
    }
  }
  return null;
}

/**
 * Build a PATH string with `extraDirs` prepended (deduped against PATH).
 * Returns the augmented PATH value for use in a child env.
 */
export function augmentPath(
  extraDirs,
  preferredDir,
  currentPath = process.env.PATH || '',
) {
  const current = currentPath.split(path.delimiter).filter(Boolean);
  const seen = new Set(current);
  const prepend = extraDirs.filter(
    (dir, index) =>
      dir &&
      dir !== preferredDir &&
      !seen.has(dir) &&
      extraDirs.indexOf(dir) === index,
  );
  const remaining = current.filter((dir) => dir !== preferredDir);
  return [
    ...(preferredDir ? [preferredDir] : []),
    ...prepend,
    ...remaining,
  ].join(path.delimiter);
}

function waitForEnter(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

/** Print the install command and official install page; subc runs neither. */
function printInstallAdvice(agent) {
  const { command, url } = installAdvice(agent);
  if (command) console.error(`    ${c.cyan}${command}${c.reset}`);
  console.error(
    `  ${c.dim}Official install page:${c.reset} ${c.cyan}${url}${c.reset}\n`,
  );
}

/**
 * Return the directory that holds the agent's binary. subc never installs a
 * third-party agent: when the binary is missing it prints how to install it
 * and exits 127, in every shell.
 */
export async function ensureInstalled(agent) {
  const bin = agentBinary(agent);
  const existing = await resolveBinPath(bin, preferredBinDirsForAgent(agent));
  if (existing) return existing;

  console.error(
    `\n  ${c.red}${agent.name} isn't installed${c.reset} ${c.dim}(\`${bin}\` not found on PATH).${c.reset}`,
  );
  console.error(
    `  subc doesn't install ${agent.name}. Install it yourself, then re-run ${c.cyan}subc ${agentCommandName(agent)}${c.reset}.\n`,
  );
  printInstallAdvice(agent);
  process.exit(127);
}

export function parseClaudeVersion(text) {
  const match = String(text ?? '').match(/v?(\d+\.\d+\.\d+)/);
  return match?.[1] ?? null;
}

export const MIN_CLAUDE_CODE_VERSION =
  agentById('claude-code').install.minimum_version;
export const MIN_CODEX_VERSION = agentById('codex').install.minimum_version;

export function claudeVersionNeedsUpgrade(
  installed,
  minimum = MIN_CLAUDE_CODE_VERSION,
) {
  return versionNeedsUpgrade(installed, minimum);
}

export function versionNeedsUpgrade(installed, minimum) {
  return Boolean(
    installed && minimum && compareVersions(installed, minimum) < 0,
  );
}

export function readClaudeVersion(bin, binDir, options = {}) {
  const execFile = options.execFileSync || execFileSync;
  try {
    const stdout = execFile(bin, ['--version'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: augmentPath(
          [binDir, ...candidateBinDirs()].filter(Boolean),
          binDir,
        ),
      },
      timeout: options.timeoutMs ?? 3000,
    });
    return parseClaudeVersion(
      typeof stdout === 'string' ? stdout : stdout?.toString?.(),
    );
  } catch {
    return null;
  }
}

/** Warn, without blocking, when the agent is older than its minimum version. */
export async function ensureMinimumVersion(
  agent,
  binDir,
  { mayPrompt = true } = {},
) {
  const minimum = agent.install.minimum_version;
  if (!minimum) return;
  const version = readClaudeVersion(agentBinary(agent), binDir);
  if (!versionNeedsUpgrade(version, minimum)) return;

  console.error(
    `\n  Minimum supported ${agent.name} version is ${minimum}. Your version is ${version}. Upgrade to get the best experience.\n`,
  );
  console.error(`  Upgrade it with:`);
  printInstallAdvice(agent);
  if (
    mayPrompt &&
    process.stdin.isTTY === true &&
    process.stdout.isTTY === true
  ) {
    await waitForEnter(`  ${c.dim}Press Enter to continue.${c.reset} `);
    console.error('');
  }
}
