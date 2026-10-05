import { execFileSync, spawn } from 'node:child_process';
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
  installCommands,
} from './agent-data.js';
import { runbookScriptPath } from './agent-spawn.js';
import { c } from './colors.js';
import { compareVersions } from './update-check.js';

/**
 * The install command for this OS, falling back to the Linux one, then any
 * command present; plus the optional fallback command.
 */
export function resolveInstall(agent) {
  const commands = installCommands(agent);
  if (!commands) return { command: undefined, fallback: undefined };
  const command =
    commands[process.platform] ||
    commands.linux ||
    Object.entries(commands).find(([os]) => os !== 'fallback')?.[1];
  return { command, fallback: commands.fallback };
}

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

/** Ask a yes/no question on the TTY. Empty answer counts as yes. */
function askYesNo(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === '' || a === 'y' || a === 'yes');
    });
  });
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

/** Run the agent's packaged binary installer, or its shell install command. */
function runInstaller(
  agent,
  install = resolveInstall(agent).command,
  usePackagedScript = true,
) {
  return new Promise((resolve) => {
    const installScript =
      usePackagedScript && agent.runbook.binary_install_script;
    const child = installScript
      ? spawn('bash', [runbookScriptPath(agent, installScript), 'install'], {
          stdio: 'inherit',
        })
      : spawn(install, { shell: true, stdio: 'inherit' });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

/** Print the resolved install command (plus any fallback) for an agent. */
function printInstallCommands(agent) {
  const { command, fallback } = resolveInstall(agent);
  console.error(`    ${c.cyan}${command}${c.reset}`);
  if (fallback) {
    console.error(`  ${c.dim}or, as a fallback:${c.reset}`);
    console.error(`    ${c.cyan}${fallback}${c.reset}`);
  }
  console.error('');
}

/**
 * Ensure the agent's binary is resolvable. If missing:
 *   - interactive TTY: offer to run the per-OS installer (with fallback), then
 *     re-resolve against PATH + candidate dirs.
 *   - non-interactive: print the resolved install command (+ fallback) and
 *     exit 127 without running anything.
 *
 * Returns the directory containing the bin (to prepend to the child's PATH) on
 * success. May exit the process on failure or when manual action is needed.
 */
export async function ensureInstalled(agent, { mayPrompt = true } = {}) {
  const bin = agentBinary(agent);
  const { command: install, fallback } = resolveInstall(agent);
  const preferredDirs = preferredBinDirsForAgent(agent);
  const existing = await resolveBinPath(bin, preferredDirs);
  if (existing) return existing;

  // Agents without an installer are launch-only. Their setup integration may
  // configure the provider, but `subc <agent>` must never install the binary.
  if (!install) {
    console.error(
      `\n  ${c.red}${agent.name} isn't installed${c.reset} ${c.dim}(\`${bin}\` not found on PATH).${c.reset}`,
    );
    console.error(
      `  Install ${agent.name} separately, then re-run ${c.cyan}subc ${agentCommandName(agent)}${c.reset}.\n`,
    );
    process.exit(127);
  }

  const interactive = mayPrompt && process.stdin.isTTY && process.stdout.isTTY;

  if (!interactive) {
    console.error(
      `\n  ${c.red}${agent.name} isn't installed${c.reset} ${c.dim}(\`${bin}\` not found on PATH).${c.reset}`,
    );
    console.error(`  Install it with:\n`);
    printInstallCommands(agent);
    process.exit(127);
  }

  console.error(`\n  ${c.bold}${agent.name}${c.reset} isn't installed.`);
  const ok = await askYesNo(`  Install it now? ${c.dim}[Y/n]${c.reset} `);
  if (!ok) {
    console.error(`\n  No problem. Install it yourself with:\n`);
    printInstallCommands(agent);
    process.exit(127);
  }

  console.error(
    `\n  ${c.dim}Running ${c.reset}${c.cyan}${install}${c.reset}\n`,
  );
  let installed = await runInstaller(agent);

  // Primary failed and a fallback exists — try it once.
  if (!installed && fallback) {
    console.error(
      `\n  ${c.dim}That didn't work. Trying the fallback: ${c.reset}${c.cyan}${fallback}${c.reset}\n`,
    );
    installed = await runInstaller(agent, fallback, false);
  }

  if (!installed) {
    console.error(`\n  ${c.red}Install failed.${c.reset} Try it manually:\n`);
    printInstallCommands(agent);
    process.exit(127);
  }

  // PATH hardening: the freshly-installed binary is often not on the current
  // process's PATH. Re-resolve against PATH + candidate dirs.
  const found = await resolveBinPath(bin, preferredDirs);
  if (found) return found;

  console.error(
    `\n  ${c.dim}Installed ${agent.name}, but it isn't on this shell's PATH yet. ` +
      `Open a new terminal (or add a bin dir to PATH) and re-run \`subc ${agentCommandName(agent)}\`.${c.reset}\n`,
  );
  process.exit(0);
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
  const { command, fallback } = resolveInstall(agent);
  console.error(`  Upgrade it with:`);
  console.error(`    ${c.cyan}${command}${c.reset}`);
  if (fallback) {
    console.error(`  or`);
    console.error(`    ${c.cyan}${fallback}${c.reset}`);
  }
  console.error('');
  if (
    mayPrompt &&
    process.stdin.isTTY === true &&
    process.stdout.isTTY === true
  ) {
    await waitForEnter(`  ${c.dim}Press Enter to continue.${c.reset} `);
    console.error('');
  }
}
