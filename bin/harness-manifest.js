import { readFileSync } from 'node:fs';
import { c } from './colors.js';

const MANIFEST_URL = new URL(
  './harness-manifest.generated.json',
  import.meta.url,
);
const PACKAGE_URL = new URL('../package.json', import.meta.url);

function readJson(url) {
  return JSON.parse(readFileSync(url, 'utf-8'));
}

// The version is added here rather than at generate time: Release Please bumps
// package.json without regenerating, so a baked-in copy would go stale.
export function loadHarnessManifest() {
  const { _generated, schema_version, ...rest } = readJson(MANIFEST_URL);
  return {
    schema_version,
    cli_version: readJson(PACKAGE_URL).version,
    ...rest,
  };
}

export function printHarnessManifestHelp() {
  console.log(`
Usage:
  subc harness-manifest [--json]
  subc harness-manifest help

Print how this subc version installs, configures, and launches each coding
harness: install source, binary, env vars, config files, compaction knobs,
MCP, headers, and hooks.

  --json   Print the full manifest as JSON. This is the default when stdout
           is not a terminal; in a terminal, a summary table is printed.
`);
}

function compactionSummary(compaction) {
  const supported = ['on', 'off', 'threshold'].filter(
    (mode) => compaction[mode]?.set_by_subc,
  );
  return supported.length ? supported.join(',') : '-';
}

function tableRows(manifest) {
  return Object.values(manifest.harnesses).map((harness) => [
    harness.id,
    harness.binary || '-',
    harness.install.package || harness.install.repository || '-',
    String(harness.env.length),
    compactionSummary(harness.capabilities.compaction),
    String(harness.capabilities.hooks.length),
  ]);
}

function printTable(manifest) {
  const header = ['harness', 'binary', 'install', 'env', 'compaction', 'hooks'];
  const rows = tableRows(manifest);
  const widths = header.map((title, index) =>
    Math.max(title.length, ...rows.map((row) => row[index].length)),
  );
  const line = (cells) =>
    `  ${cells.map((cell, index) => cell.padEnd(widths[index])).join('  ')}`;
  console.log(
    `\n  ${c.bold}Harness manifest${c.reset} ${c.dim}schema ${manifest.schema_version}, subc ${manifest.cli_version}${c.reset}\n`,
  );
  console.log(`${c.dim}${line(header)}${c.reset}`);
  for (const row of rows) console.log(line(row));
  console.log(
    `\n  ${c.dim}compaction lists the modes subc sets. Use --json for every field.${c.reset}\n`,
  );
}

export function harnessManifestCommand(args = [], options = {}) {
  const unknown = args.filter((arg) => arg !== '--json');
  if (unknown.length) {
    throw new Error(
      `Unknown argument: ${unknown[0]}. Try subc harness-manifest help.`,
    );
  }
  const isTTY = options.isTTY ?? process.stdout.isTTY === true;
  const manifest = loadHarnessManifest();
  if (args.includes('--json') || !isTTY) {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return;
  }
  printTable(manifest);
}
