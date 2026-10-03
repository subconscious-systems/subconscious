// Bump on any change that can break a reader: a renamed or removed field, or a
// changed meaning. Adding a field does not need a bump.
export const HARNESS_MANIFEST_SCHEMA_VERSION = 1;

export const MANIFEST_TOKENS = {
  '{baseUrl}': 'Gateway origin, without a trailing slash.',
  '{baseUrlV1}': 'Gateway origin followed by /v1.',
  '{apiKey}': 'Gateway API key.',
  '{model}': 'Launch model ID.',
  '{catalog}': 'Every live catalog model ID, newline-separated.',
  '{catalog[N]}':
    'Catalog model at index N, clamped to the last entry; {model} when the catalog is empty.',
  '{args}': 'Arguments passed through from subc.',
  '{tempFile}': 'Temporary file the runbook writes and removes on exit.',
  '{tmp}': 'System temporary directory.',
  '{json}': 'JSON document described by the matching config entry.',
  '{claudeSettings}': 'JSON document described by the --settings config entry.',
  '{configOverrides}': 'The -c key=value pairs listed under config.',
};

const REQUIRED_HARNESS_FIELDS = [
  'install',
  'launch',
  'inputs',
  'env',
  'config',
  'capabilities',
];

function requireHarness(agent) {
  const { harness } = agent;
  if (!harness || typeof harness !== 'object') {
    throw new Error(`Agent ${agent.id} has a runbook but no harness block`);
  }
  for (const field of REQUIRED_HARNESS_FIELDS) {
    if (!(field in harness)) {
      throw new Error(`Agent ${agent.id} harness is missing ${field}`);
    }
  }
  return harness;
}

function runbookDir(agent) {
  return agent.runbook.script.split('/')[0];
}

function harnessEntry(agent) {
  const harness = requireHarness(agent);
  const { runbook } = agent;
  return {
    id: agent.id,
    name: agent.name,
    command: `subc ${agent.command || agent.id}`,
    aliases: agent.aliases || [],
    mode: runbook.mode,
    protocol: agent.protocol,
    runbook: {
      dir: runbookDir(agent),
      launch: runbook.mode === 'launch' ? runbook.script : null,
      setup: runbook.setupScript || null,
      setup_actions: runbook.setupActions || [],
    },
    binary: agent.bin || null,
    install: { ...harness.install, commands: agent.install || null },
    launch: harness.launch,
    inputs: harness.inputs,
    env: harness.env,
    config: harness.config,
    capabilities: harness.capabilities,
  };
}

export function buildHarnessManifest(registry) {
  const agents = registry.agents.filter(
    (agent) => agent.cli !== false && agent.runbook,
  );
  return {
    _generated: 'Source of truth: agents/registry.json. Do not edit by hand.',
    schema_version: HARNESS_MANIFEST_SCHEMA_VERSION,
    cli_package: 'subconscious-cli',
    tokens: MANIFEST_TOKENS,
    runbook_env: registry.runbookEnv,
    harnesses: Object.fromEntries(
      agents.map((agent) => [agent.id, harnessEntry(agent)]),
    ),
  };
}
