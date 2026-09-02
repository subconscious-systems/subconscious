#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TUI_DIR = path.join(CLI_DIR, 'tui');
const OUTPUT_DIR = path.join(CLI_DIR, 'bin', 'native');

const targets = [
  { platform: 'darwin', arch: 'amd64' },
  { platform: 'darwin', arch: 'arm64' },
  { platform: 'linux', arch: 'amd64' },
  { platform: 'linux', arch: 'arm64' },
  { platform: 'windows', arch: 'amd64' },
  { platform: 'windows', arch: 'arm64' },
];

function hostTarget() {
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
  if (!arch || !['darwin', 'linux', 'windows'].includes(platform)) {
    throw new Error(`Unsupported TUI build host: ${process.platform}/${process.arch}`);
  }
  return { platform, arch };
}

function filename(target) {
  const extension = target.platform === 'windows' ? '.exe' : '';
  return `subc-tui-${target.platform}-${target.arch}${extension}`;
}

const selectedTargets = process.argv.includes('--host') ? [hostTarget()] : targets;
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

for (const target of selectedTargets) {
  const output = path.join(OUTPUT_DIR, filename(target));
  console.log(`Building ${target.platform}/${target.arch} → ${path.relative(CLI_DIR, output)}`);
  execFileSync(
    'go',
    ['build', '-trimpath', '-ldflags=-s -w', '-o', output, './cmd/subc-tui'],
    {
      cwd: TUI_DIR,
      env: {
        ...process.env,
        CGO_ENABLED: '0',
        GOOS: target.platform,
        GOARCH: target.arch,
      },
      stdio: 'inherit',
    },
  );
  if (target.platform !== 'windows') fs.chmodSync(output, 0o755);
}
