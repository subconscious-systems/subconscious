#!/usr/bin/env node
/**
 * Generate all derived agent data from the single source of truth
 * (`agents/registry.json`):
 *
 *   cli/bin/registry.generated.json — verbatim copy the CLI ships + reads
 *
 * Do not hand-edit any of those outputs. Edit registry.json and re-run.
 */

const fs = require('fs');
const path = require('path');
const { loadRegistry } = require('./lib/registry.js');

const ROOT = path.join(__dirname, '..');
const CLI_BIN_DIR = path.join(ROOT, 'cli', 'bin');

const registry = loadRegistry();

// Verbatim copy of the whole registry. The CLI substitutes tokens at runtime.
function writeCliData() {
  const out = {
    _generated: 'Source of truth: agents/registry.json. Do not edit by hand.',
    ...registry,
    agents: registry.agents.filter((agent) => agent.cli !== false),
  };
  const dest = path.join(CLI_BIN_DIR, 'registry.generated.json');
  fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
  console.log(`Wrote ${path.relative(ROOT, dest)}`);
}

writeCliData();
