import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { powershellCommand, runWindows } from './process.js';

const registry = JSON.parse(readFileSync(new URL('../registry.generated.json', import.meta.url), 'utf8'));
const repository = 'subconscious-systems/subconscious-code';

function npmInstall(command) {
  const match = /^npm (?:i|install) -g ([@a-zA-Z0-9/._-]+)$/.exec(command || '');
  return match ? { command: 'npm', args: ['install', '-g', match[1]] } : null;
}

export function windowsInstallSpec(id, env = process.env) {
  const install = registry.agents.find(agent => agent.id === id)?.install;
  const command = typeof install === 'object' ? install.win32 : undefined;
  if (id === 'subconscious-code') return { nativeRelease: true, display: 'subc sc install' };
  if (!command) return null; // Never fall back to a Linux installer.
  if (id === 'claude-code') {
    const primary = powershellCommand("$ErrorActionPreference = 'Stop'; Invoke-RestMethod 'https://claude.ai/install.ps1' | Invoke-Expression; if (-not $?) { exit 1 }", env);
    return { ...primary, display: command, fallback: npmInstall(install.fallback) };
  }
  const spec = npmInstall(command);
  if (!spec) throw new Error(`No safe Windows installer is defined for ${id}`);
  return { ...spec, display: command };
}

export function windowsReleaseAsset(release, arch = process.arch) {
  const target = { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' }[arch];
  if (!target) throw new Error(`Subconscious Code does not support Windows architecture ${arch}`);
  const names = [`sc-${target}.zip`, `sc-${target}.exe`];
  const asset = release.assets?.find(asset => names.includes(asset.name));
  if (!asset) throw new Error(`Subconscious Code ${release.tag_name || 'latest'} has no published native Windows ${arch} binary. The CLI can launch an installed sc.exe, but the upstream release must include a Windows build before subc sc install can install it.`);
  const checksum = release.assets.find(candidate => candidate.name === `${asset.name}.sha256`);
  if (!checksum) throw new Error(`The Windows release is missing ${asset.name}.sha256; refusing an unverified installation.`);
  return { asset, checksum };
}

export async function installWindowsSC(env, { fetchImpl = fetch, run = runWindows, home = os.homedir(), arch = process.arch, log = console.log } = {}) {
  const version = env.SC_CODE_VERSION?.replace(/^v/, '');
  const endpoint = version ? `tags/${encodeURIComponent('v' + version)}` : 'latest';
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/releases/${endpoint}`, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Could not find a Subconscious Code release (HTTP ${response.status}).`);
  const release = await response.json();
  const { asset, checksum } = windowsReleaseAsset(release, arch);
  const download = async asset => {
    const url = new URL(asset.browser_download_url);
    if (url.origin !== 'https://github.com' || !url.pathname.startsWith(`/${repository}/releases/download/`)) throw new Error('Unexpected release download URL');
    const response = await fetchImpl(url.href, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}): ${asset.name}`);
    return Buffer.from(await response.arrayBuffer());
  };
  log(`Downloading Subconscious Code ${release.tag_name} for Windows ${arch}...`);
  const [binary, checksumText] = await Promise.all([download(asset), download(checksum)]);
  const expected = checksumText.toString('utf8').trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/i.test(expected) || createHash('sha256').update(binary).digest('hex') !== expected.toLowerCase()) throw new Error('Subconscious Code checksum verification failed');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-sc-install-'));
  const installDir = path.resolve(env.SC_INSTALL_DIR || path.join(home, '.local', 'bin'));
  const destination = path.join(installDir, 'sc.exe');
  const staging = path.join(installDir, `sc-${randomUUID()}.tmp`);
  try {
    const extracted = path.join(dir, 'sc.exe');
    if (asset.name.endsWith('.zip')) {
      const archive = path.join(dir, 'release.zip');
      await fs.writeFile(archive, binary, { flag: 'wx' });
      // Extract only the exact root executable. No archive-controlled paths.
      const spec = powershellCommand("$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $z = [IO.Compression.ZipFile]::OpenRead($env:SUBC_ARCHIVE); try { $e = $z.GetEntry('sc.exe'); if ($null -eq $e) { throw 'Archive has no root sc.exe' }; [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $env:SUBC_EXTRACTED, $false) } finally { $z.Dispose() }", { ...env, SUBC_ARCHIVE: archive, SUBC_EXTRACTED: extracted });
      if (await run(spec.command, spec.args, { env: spec.env })) throw new Error('Could not extract the Windows release');
    } else await fs.writeFile(extracted, binary, { flag: 'wx' });
    const magic = (await fs.readFile(extracted)).subarray(0, 2).toString('ascii');
    if (magic !== 'MZ') throw new Error('Release is not a Windows executable');
    await fs.mkdir(installDir, { recursive: true });
    await fs.copyFile(extracted, staging);
    await fs.rename(staging, destination);
    log(`Installed ${destination}. Run subc sc to launch it.`);
    return 0;
  } finally {
    await fs.rm(staging, { force: true });
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export async function installWindowsAgent(id, env, run = runWindows) {
  const spec = windowsInstallSpec(id, env);
  if (!spec) throw new Error('Install this agent separately, then rerun subc.');
  if (spec.nativeRelease) return installWindowsSC(env, { run });
  let code;
  try { code = await run(spec.command, spec.args, { env: spec.env || env }); }
  catch (error) { if (!spec.fallback) throw error; code = 1; }
  if (code && spec.fallback) {
    console.error('Native installer failed; trying the npm package.');
    code = await run(spec.fallback.command, spec.fallback.args, { env });
  }
  return code;
}
