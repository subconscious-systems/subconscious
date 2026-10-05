import { agentById, installCommands } from '../agent-data.js';
import { powershellCommand, runWindows } from './process.js';

function npmInstall(command) {
  const match = /^npm (?:i|install) -g ([@a-zA-Z0-9/._-]+)$/.exec(
    command || '',
  );
  return match ? { command: 'npm', args: ['install', '-g', match[1]] } : null;
}

export function windowsInstallSpec(id, env = process.env) {
  const install = installCommands(agentById(id)) || {};
  const command = install.win32;
  if (!command) return null; // Never fall back to a Linux installer.
  if (id === 'claude-code') {
    const primary = powershellCommand(
      "$ErrorActionPreference = 'Stop'; Invoke-RestMethod 'https://claude.ai/install.ps1' | Invoke-Expression; if (-not $?) { exit 1 }",
      env,
    );
    return {
      ...primary,
      display: command,
      fallback: npmInstall(install.fallback),
    };
  }
  const spec = npmInstall(command);
  if (!spec) throw new Error(`No safe Windows installer is defined for ${id}`);
  return { ...spec, display: command };
}

export async function installWindowsAgent(id, env, run = runWindows) {
  const spec = windowsInstallSpec(id, env);
  if (!spec) throw new Error('Install this agent separately, then rerun subc.');
  let code;
  try {
    code = await run(spec.command, spec.args, { env: spec.env || env });
  } catch (error) {
    if (!spec.fallback) throw error;
    code = 1;
  }
  if (code && spec.fallback) {
    console.error('Native installer failed; trying the npm package.');
    code = await run(spec.fallback.command, spec.fallback.args, { env });
  }
  return code;
}
