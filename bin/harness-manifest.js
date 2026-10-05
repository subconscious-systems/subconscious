import { readFileSync } from 'node:fs';
import {
  AGENTS,
  agentBinary,
  agentCommandName,
  agentInputs,
  installCommands,
  RUNBOOK_DIR,
  resolveRefs,
  staticLookup,
} from './agent-data.js';
import { RUNBOOK_ENV_DESCRIPTION } from './agents.js';
import { CLAUDE_PICKER_ENV_DESCRIPTION } from './claude-picker.js';
import { c } from './colors.js';
import { buildOpenCodeConfig } from './opencode-provider.js';

// Bump on any change that can break a reader: a renamed or removed field, or a
// changed meaning. Adding a field does not need a bump.
export const HARNESS_MANIFEST_SCHEMA_VERSION = 1;

export const MANIFEST_TOKENS = {
  '{baseUrl}': 'Gateway origin, without a trailing slash.',
  '{baseUrlV1}': 'Gateway origin followed by /v1.',
  '{apiKey}': "The agent's API key input when set, otherwise API_KEY.",
  '{model}': 'Launch model ID.',
  '${NAME}':
    'Value of env var NAME at launch. The manifest replaces it with the default when NAME is an input or env entry; a reference followed by / drops trailing slashes.',
  '{catalog}': 'Every live catalog model ID, newline-separated.',
  '{catalog[N]}':
    'Catalog model at index N, clamped to the last entry; {model} when the catalog is empty.',
  '{args}': 'Arguments passed through from subc, after its own flags.',
  '{config}':
    'config_flag NAME=VALUE for each cli-config entry whose condition holds.',
  '{prompt}': 'The task given to subc <agent> headless PROMPT.',
  '{sessionId}': 'A local session ID, for launch.resume.',
  '{sessionFile}': "A local session's file, or its ID when it has none.",
  '{tempFile}':
    'Temporary file the runbook writes; the matching config entry says whether it is removed.',
  '{tmp}': 'System temporary directory.',
  '{opencodeConfig}':
    'The OpenCode config document shown in the env-json config entry.',
  '{claudeSettings}': 'JSON document described by the --settings config entry.',
  '{target}':
    'Release target triple, one of install.targets or install.windows_targets.',
  '{binDir}': "Directory the agent's binary was found in.",
  '{PATH}': "The caller's PATH.",
  '<install dirs>': 'Common install directories subc adds to PATH.',
  '<agent key>': 'The agent-specific API key input, for example CODEX_API_KEY.',
  '<id>': 'Any model ID in the catalog; the field repeats for each model.',
  'models[]': 'Every element of the models array.',
  '<runbook>': 'Absolute path of the installed bin/runbook directory.',
  '<VS Code user dir>':
    'The VS Code user settings directory, for example ~/Library/Application Support/Code/User.',
};

const PACKAGE_URL = new URL('../package.json', import.meta.url);

function conditionText(when) {
  return Object.entries(when)
    .map(([name, test]) =>
      test === 'set'
        ? `${name} non-empty`
        : test === 'empty'
          ? `${name} empty`
          : `${name} != ${test.not}`,
    )
    .join(' and ');
}

/** The OpenCode config with placeholders, built by the launch code itself. */
function openCodeConfigDocument(lookup) {
  const document = buildOpenCodeConfig({
    baseUrl: '{baseUrl}',
    model: '{model}',
    modelIds: ['<id>'],
    context: lookup('OPENCODE_CONTEXT_LIMIT'),
    output: lookup('OPENCODE_OUTPUT_LIMIT'),
  });
  return JSON.parse(
    JSON.stringify(document).replaceAll(
      JSON.stringify(RUNBOOK_DIR).slice(1, -1),
      '<runbook>/',
    ),
  );
}

function resolver(agent) {
  const lookup = staticLookup(agent);
  return (value) =>
    value === '{opencodeConfig}'
      ? openCodeConfigDocument(lookup)
      : resolveRefs(value, lookup);
}

function inputEntry(input, resolve) {
  return input.default === undefined
    ? input
    : { ...input, default: resolve(input.default) };
}

function exportedEnv(input, resolve) {
  return {
    name: input.name,
    value: String(resolve(input.default)),
    override: [input.name, ...(input.aliases || [])],
    description: input.description,
  };
}

function envEntries(agent, resolve) {
  const inputs = agentInputs(agent).filter((input) => input.export);
  const own = agent.env.map((entry) => ({
    ...entry,
    value:
      entry.value === '{opencodeConfig}'
        ? entry.value
        : String(resolve(entry.value)),
    override: entry.override || [],
  }));
  const launcher =
    agent.id === 'claude-code' ? CLAUDE_PICKER_ENV_DESCRIPTION : [];
  return [
    ...inputs.map((input) => exportedEnv(input, resolve)),
    ...own,
    ...launcher,
  ];
}

function inputBehindRef(agent, value) {
  const name = /^\$\{([A-Z_][A-Z0-9_]*)\}$/.exec(value ?? '')?.[1];
  return name && agentInputs(agent).find((input) => input.name === name);
}

/** Where a value that reads an input can be changed: its env names and flag. */
function overrideFor(input) {
  return [
    input.name,
    ...(input.aliases || []),
    ...(input.flag ? [input.flag] : []),
  ];
}

function configEntry(agent, entry, resolve) {
  const { when, ...rest } = entry;
  const out = { ...rest };
  if ('value' in entry) out.value = resolve(entry.value);
  const input = inputBehindRef(agent, entry.value);
  if (input) out.override = overrideFor(input);
  if (when) out.condition = conditionText(when);
  return out;
}

/** A knob that reads an input says where the value comes from and its bounds. */
function knob(agent, setting, resolve) {
  const input = inputBehindRef(agent, setting.value);
  const value = resolve(setting.value);
  const out = {
    ...setting,
    value: setting.kind === 'env' ? String(value) : value,
  };
  if (input && !setting.override) out.override = overrideFor(input);
  if (input && setting.range)
    out.range = { min: input.min, max: input.max, ...setting.range };
  return out;
}

function capabilities(agent, resolve) {
  const { compaction, ...rest } = agent.capabilities;
  const knobs = Object.fromEntries(
    ['on', 'off', 'threshold'].map((mode) => [
      mode,
      knob(agent, compaction[mode], resolve),
    ]),
  );
  return { ...resolve(rest), compaction: { ...compaction, ...knobs } };
}

function harnessEntry(agent) {
  const resolve = resolver(agent);
  const { runbook } = agent;
  const script = (name) => (name ? `${agent.id}/${name}` : null);
  return {
    id: agent.id,
    name: agent.name,
    command: `subc ${agentCommandName(agent)}`,
    aliases: agent.aliases,
    mode: runbook.mode,
    protocol: agent.protocol,
    runbook: {
      dir: agent.id,
      launch: script(runbook.script),
      setup: script(runbook.setup_script),
      setup_actions: runbook.setup_actions || [],
    },
    binary: agentBinary(agent),
    install: { ...agent.install, commands: installCommands(agent) },
    prerequisites: agent.prerequisites,
    launch: agent.launch ?? null,
    inputs: agentInputs(agent).map((input) => inputEntry(input, resolve)),
    env: envEntries(agent, resolve),
    config: agent.config.map((entry) => configEntry(agent, entry, resolve)),
    capabilities: capabilities(agent, resolve),
  };
}

/** The manifest, computed from the agent files this subc ships. */
export function loadHarnessManifest() {
  return {
    schema_version: HARNESS_MANIFEST_SCHEMA_VERSION,
    cli_version: JSON.parse(readFileSync(PACKAGE_URL, 'utf-8')).version,
    cli_package: 'subconscious-cli',
    tokens: MANIFEST_TOKENS,
    runbook_env: RUNBOOK_ENV_DESCRIPTION,
    harnesses: Object.fromEntries(
      AGENTS.map((agent) => [agent.id, harnessEntry(agent)]),
    ),
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
