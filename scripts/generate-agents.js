#!/usr/bin/env node
/**
 * Generate CLI data from the single source of truth (`agents/registry.json`):
 *
 *   1. bin/registry.generated.json
 *   2. bin/runbook/model-capabilities.generated.sh
 *
 * Do not hand-edit those outputs. Edit registry.json and re-run.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry } from './lib/registry.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN_DIR = path.join(ROOT, 'bin');

const registry = loadRegistry();

function writeCliData() {
  const out = {
    _generated: 'Source of truth: agents/registry.json. Do not edit by hand.',
    ...registry,
    agents: registry.agents.filter((agent) => agent.cli !== false),
  };
  const dest = path.join(BIN_DIR, 'registry.generated.json');
  fs.writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, dest)}`);
}

function writeModelCapabilities() {
  const visionModels = Object.entries(registry.modelCapabilities || {})
    .filter(([, capabilities]) => capabilities.vision === true)
    .map(([id]) => {
      if (!/^[-A-Za-z0-9._:/+]+$/.test(id))
        throw new Error(`Invalid model id: ${id}`);
      return `    '${id}') return 0 ;;`;
    });
  const source = [
    '#!/usr/bin/env bash',
    '# Generated from agents/registry.json. Do not edit by hand.',
    '# Exact IDs only: similarly named models do not inherit capabilities.',
    'subc_model_supports_vision() {',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter, not a JS template
    '  case "${1:-}" in',
    ...visionModels,
    '    *) return 1 ;;',
    '  esac',
    '}',
    '',
  ].join('\n');
  const dest = path.join(BIN_DIR, 'runbook', 'model-capabilities.generated.sh');
  fs.writeFileSync(dest, source);
  console.log(`Wrote ${path.relative(ROOT, dest)}`);
}

writeCliData();
writeModelCapabilities();
