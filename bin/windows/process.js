// Windows process handling. Unix callers keep using their existing launch paths.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';

export function windowsEnv(...sources) {
  const result = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source || {})) {
      if (value !== undefined && value !== null) result[key.toUpperCase()] = String(value);
    }
  }
  return result;
}

export function windowsBinDirs(environment = process.env, home = os.homedir()) {
  const env = windowsEnv(environment);
  return [...new Set([
    env.APPDATA && path.win32.join(env.APPDATA, 'npm'),
    env.USERPROFILE && path.win32.join(env.USERPROFILE, '.local', 'bin'),
    home && path.win32.join(home, '.local', 'bin'),
    env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'),
    env.SYSTEMROOT && path.win32.join(env.SYSTEMROOT, 'System32', 'config', 'systemprofile', '.local', 'bin'),
    env.SYSTEMROOT && path.win32.join(env.SYSTEMROOT, 'System32'),
    env.SYSTEMROOT && path.win32.join(env.SYSTEMROOT, 'System32', 'WindowsPowerShell', 'v1.0'),
    path.dirname(process.execPath),
  ].filter(Boolean))];
}

export function windowsPath(extraDirs, currentPath = '') {
  const seen = new Set();
  return [...extraDirs, ...currentPath.split(';')].filter(dir => {
    const key = dir.replace(/^"|"$/g, '').replace(/[\\/]+$/, '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(dir => dir.replace(/^"|"$/g, '')).join(';');
}

export function resolveWindowsExecutable(command, options = {}) {
  const env = windowsEnv(options.env || process.env);
  const pathApi = options.pathApi || path.win32;
  const isFile = options.isFile || (file => { try { return fs.statSync(file).isFile(); } catch { return false; } });
  const extensions = [...new Set(['.exe', '.com', ...(env.PATHEXT || '.CMD;.BAT').split(';').map(x => x.toLowerCase()), ''])];
  const hasExtension = extensions.some(ext => ext && command.toLowerCase().endsWith(ext));
  const dirs = /[\\/]/.test(command) ? [''] : [
    ...(options.preferredDirs || []),
    ...(env.PATH || '').split(';').filter(Boolean),
    ...windowsBinDirs(env, options.home),
  ];
  for (const dir of dirs) {
    for (const ext of hasExtension ? [''] : extensions) {
      const candidate = dir ? pathApi.join(dir.replace(/^"|"$/g, ''), command + ext) : command + ext;
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

// npm shims pass %* through cmd.exe, which reinterprets quotes, JSON, %, &,
// newlines, etc. Resolve their quoted entry point and run it with Node directly.
// This also supports npm/npx and VS Code's code.cmd without invoking a shell.
export function windowsInvocation(command, args = [], environment = process.env, options = {}) {
  const env = windowsEnv(environment);
  const resolve = options.resolve || resolveWindowsExecutable;
  const executable = resolve(command, { env, ...options });
  if (!executable) throw new Error(`Could not find ${command} on the Windows PATH.`);
  if (!/\.(cmd|bat)$/i.test(executable)) return { command: executable, args, env };
  const readFile = options.readFile || (file => fs.readFileSync(file, 'utf8'));
  const pathApi = options.pathApi || path.win32;
  const contents = readFile(executable);
  const candidates = [...contents.matchAll(/%(?:dp0%|~dp0)[\\/]?([^"\r\n]+)"/gi)];
  const name = pathApi.basename(executable).replace(/\.(cmd|bat)$/i, '').toLowerCase();
  let electron;
  if (/ELECTRON_RUN_AS_NODE\s*=\s*1/i.test(contents)) {
    electron = candidates.map(match => pathApi.resolve(pathApi.dirname(executable), match[1])).find(target => /\.exe$/i.test(target) && !/node\.exe$/i.test(target) && fs.existsSync(target));
  }
  for (const match of candidates) {
    const target = pathApi.resolve(pathApi.dirname(executable), match[1]);
    // A shim's first executable is often node.exe, not the agent entry point.
    if (/\.(exe|com)$/i.test(target)) {
      if (!electron && !/node\.exe$/i.test(target) && fs.existsSync(target)) return { command: target, args, env };
      continue;
    }
    if (['npm', 'npx'].includes(name) && pathApi.basename(target) !== `${name}-cli.js`) continue;
    let source;
    try { source = readFile(target); } catch { continue; }
    if (!/\.[cm]?js$/i.test(target) && !/^#![^\r\n]*\bnode\b/.test(source)) continue;
    return { command: electron || process.execPath, args: [target, ...args], env: electron ? { ...env, ELECTRON_RUN_AS_NODE: '1' } : env };
  }
  throw new Error(`Cannot safely launch the custom batch wrapper ${executable}. Install the native executable or standard npm package for ${command}.`);
}

export function spawnWindows(command, args, options = {}) {
  const invocation = windowsInvocation(command, args, options.env || process.env);
  return spawn(invocation.command, invocation.args, { ...options, env: invocation.env, shell: false });
}

export function spawnWindowsSync(command, args, options = {}) {
  try {
    const invocation = windowsInvocation(command, args, options.env || process.env);
    return spawnSync(invocation.command, invocation.args, { ...options, env: invocation.env, shell: false });
  } catch (error) { return { error, status: null, stdout: '', stderr: '' }; }
}

export function runWindows(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnWindows(command, args, { stdio: 'inherit', ...options });
    const forward = signal => { try { child.kill(signal); } catch { /* already exited */ } };
    const interrupt = () => forward('SIGINT');
    const terminate = () => forward('SIGTERM');
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    const cleanup = () => {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', (code, signal) => {
      cleanup();
      resolve(code ?? (signal === 'SIGINT' ? 130 : 143));
    });
  });
}

export function readWindowsVersion(command, env) {
  try {
    const invocation = windowsInvocation(command, ['--version'], env);
    return execFileSync(invocation.command, invocation.args, {
      env: invocation.env, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch { return ''; }
}

export function powershellCommand(source, env = process.env) {
  // Only fixed application source is encoded here. Dynamic data uses env vars.
  return { command: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], env: windowsEnv(env) };
}

export function openWindowsBrowser(url) {
  const invocation = powershellCommand('Start-Process -FilePath $env:SUBC_BROWSER_URL', { ...process.env, SUBC_BROWSER_URL: url });
  return runWindows(invocation.command, invocation.args, { env: invocation.env, stdio: 'ignore' });
}

export function windowsEditor(requested, environment = process.env) {
  const env = windowsEnv(environment);
  const text = requested || env.VISUAL?.trim() || env.EDITOR?.trim() || 'notepad.exe';
  // An existing full path may contain spaces without quotes. Otherwise accept
  // double-quoted argv, preserving Windows backslashes and rejecting shell use.
  const parts = fs.existsSync(text) ? [text] : text.match(/"[^"]*"|[^\s"]+/g) || [];
  if ((text.match(/"/g) || []).length % 2) throw new Error('Unmatched quote in VISUAL / EDITOR');
  const [command, ...args] = parts.map(part => part.replace(/^"|"$/g, ''));
  if (!command) throw new Error('Editor is empty');
  if (/^(code|code-insiders)(\.cmd|\.exe)?$/i.test(path.win32.basename(command)) && !args.includes('--wait')) args.unshift('--wait');
  return { command, args };
}
