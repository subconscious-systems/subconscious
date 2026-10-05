import {
  AGENTS,
  agentCommandName,
  agentKeyName,
  agentSetupActions,
  DEFAULTS,
  PACKAGED_MODELS,
} from './agent-data.js';
import { isAgentHelpRequest, printAgentHelp } from './agent-help.js';
import {
  augmentPath,
  candidateBinDirs,
  claudeVersionNeedsUpgrade,
  ensureInstalled,
  ensureMinimumVersion,
  MIN_CLAUDE_CODE_VERSION,
  parseClaudeVersion,
} from './agent-install.js';
import { launchPlan, resolveInputs } from './agent-launch.js';
import { planCommand, runCommand, scriptCommand } from './agent-spawn.js';
import { getApiKey } from './auth.js';
import {
  applyClaudePickerCatalog,
  CLAUDE_PICKER_ENV_DESCRIPTION,
  claudeModelPickerEnv,
  claudePickerSettings,
} from './claude-picker.js';
import { c } from './colors.js';
import {
  headlessPromptIndex,
  separatorIndex,
  takesModelValue,
} from './headless-args.js';
import {
  isLiveModelSource,
  PUBLIC_CATALOG_FALLBACK_MESSAGE,
  resolveModelCatalog,
} from './models.js';
import { isUnsetSetting, resolvedModelSetting } from './profiles.js';
import { runWindowsAgent } from './windows/agents.js';

export { agentCommandName, agentSetupActions } from './agent-data.js';
export { isAgentHelpRequest, printAgentHelp } from './agent-help.js';
export {
  augmentPath,
  claudeVersionNeedsUpgrade,
  MIN_CLAUDE_CODE_VERSION,
  MIN_CODEX_VERSION,
  parseClaudeVersion,
  preferredBinDirsForAgent,
  readClaudeVersion,
  versionNeedsUpgrade,
} from './agent-install.js';
export { claudePickerSettings } from './claude-picker.js';

const CLAUDE_CODE = 'claude-code';

const BY_ALIAS = new Map();
for (const agent of AGENTS) {
  BY_ALIAS.set(agent.id, agent);
  BY_ALIAS.set(agentCommandName(agent), agent);
  for (const alias of agent.aliases) BY_ALIAS.set(alias, agent);
}

export function resolveAgent(name) {
  return BY_ALIAS.get(name) ?? null;
}

export function agentList() {
  return AGENTS.map((a) => ({
    id: a.id,
    name: a.name,
    alias: agentCommandName(a),
    action: a.runbook.mode === 'setup' ? 'Configure' : 'Launch',
    description: a.description,
    launch: a.runbook.mode !== 'setup',
  }));
}

const SETUP_ACTIONS = new Set(['install', 'status', 'uninstall']);
const DROPPED_SETUP_HELPERS = new Set(['use', 'env', 'unset']);

export function parseAgentAction(agent, argv = []) {
  const command = agentCommandName(agent);
  const first = argv[0];
  const actions = agentSetupActions(agent);

  if (DROPPED_SETUP_HELPERS.has(first)) {
    throw new Error(
      `${agent.name} no longer supports '${first}'. Launch with subc ${command}.`,
    );
  }

  if (SETUP_ACTIONS.has(first)) {
    if (!agent.runbook.setup_script || !actions.includes(first)) {
      if (first === 'install') {
        const uninstallHint = actions.includes('uninstall')
          ? ` To remove leftover files: subc ${command} uninstall.`
          : '';
        throw new Error(
          `${agent.name} is launch-only. Run subc ${command}.${uninstallHint}`,
        );
      }
      throw new Error(
        `${agent.name} does not support '${first}'. Try subc ${command} help.`,
      );
    }
    return { action: first, args: argv };
  }

  if (first === 'headless') {
    if (!agent.launch?.headless_argv) {
      throw new Error(`${agent.name} does not support headless mode.`);
    }
    if (!argv[1]?.trim() || ['-h', '--help'].includes(argv[1])) {
      throw new Error(`Usage: subc ${command} headless PROMPT [args...]`);
    }
    if (argv.slice(2).some((arg) => arg === '-h' || arg === '--help')) {
      throw new Error('help is not available in a headless run');
    }
    return { action: 'headless', args: argv };
  }

  if (agent.runbook.mode === 'setup') {
    return { action: 'install', args: argv };
  }

  return { action: 'launch', args: argv };
}

/** True when argv asks for a headless run; throws when that run is invalid. */
export function isHeadlessRequest(agent, argv = []) {
  const prompt = headlessPromptIndex(argv);
  if (prompt < 0) return false;
  parseAgentAction(agent, argv.slice(prompt - 1));
  return true;
}

/**
 * Resolve the gateway for a launch: SUBCONSCIOUS_BASE_URL, then the profile
 * GATEWAY_URL, then the packaged default, without trailing slashes.
 */
function buildContext(apiKey, model, profile) {
  const baseUrl = (
    process.env.SUBCONSCIOUS_BASE_URL?.trim() ||
    profile?.values?.GATEWAY_URL?.trim() ||
    DEFAULTS.baseUrl
  ).replace(/\/+$/, '');
  return { apiKey, model, baseUrl };
}

/**
 * Pull a `--model <value>` / `--model=<value>` flag out of the passthrough
 * args (so it sets the Subconscious model rather than reaching the agent).
 * Falls back to SUBCONSCIOUS_MODEL, then the profile MODEL. UNSET or a blank
 * profile model means "use the first live catalog entry" (gateway priority).
 */
export function extractModel(argv, profile) {
  const environmentModel = resolvedModelSetting(process.env.SUBCONSCIOUS_MODEL);
  const profileModel = resolvedModelSetting(profile?.values?.MODEL);
  let model = environmentModel || profileModel || '';
  let modelSource = environmentModel
    ? 'environment'
    : profileModel
      ? 'profile'
      : 'catalog';
  const rest = [];
  // The headless prompt is opaque, even when it looks like --model.
  const promptIndex = headlessPromptIndex(argv);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (i === promptIndex) {
      rest.push(a);
      continue;
    }
    if (a === '--model') {
      const v = argv[i + 1];
      if (takesModelValue(v)) {
        if (v === '' || isUnsetSetting(v)) {
          model = '';
          modelSource = 'catalog';
        } else {
          model = v;
          modelSource = 'command';
        }
        i++;
      }
      continue;
    }
    if (a.startsWith('--model=')) {
      const v = a.slice('--model='.length);
      if (isUnsetSetting(v)) {
        model = '';
        modelSource = 'catalog';
      } else {
        model = v;
        modelSource = 'command';
      }
      continue;
    }
    rest.push(a);
  }
  return { model, modelSource, rest };
}

function isSetupWithoutAuth(argv) {
  return ['status', 'uninstall', '-h', '--help', 'help'].includes(argv[0]);
}

function optionValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1]?.trim() || null : null;
}

export async function getAgentApiKey(profile, agent) {
  const specificKey = agentKeyName(agent);
  const specificEnvKey = specificKey && process.env[specificKey]?.trim();
  if (specificEnvKey)
    return { key: specificEnvKey, source: `${specificKey} env var` };

  const sharedEnvKey = process.env.SUBCONSCIOUS_API_KEY?.trim();
  if (sharedEnvKey) {
    return { key: sharedEnvKey, source: 'SUBCONSCIOUS_API_KEY env var' };
  }

  const profileKey = specificKey && profile?.values?.[specificKey]?.trim();
  if (profileKey) return { key: profileKey, source: profile.path };

  return getApiKey(profile);
}

async function requireApiKey(profile, agent) {
  const auth = await getAgentApiKey(profile, agent);
  if (auth) return auth.key;
  const login =
    profile?.name && profile.name !== 'default'
      ? `subc --profile ${profile.name} login`
      : 'subc login';

  console.error(`\n  ${c.red}Not logged in.${c.reset}`);
  console.error(
    `  Run ${c.cyan}${login}${c.reset} (or set ${c.dim}SUBCONSCIOUS_API_KEY${c.reset}) first.\n`,
  );
  process.exitCode = 1;
  return null;
}

export const RUNBOOK_ENV_DESCRIPTION = Object.freeze({
  order:
    'Later layers win: Claude picker env (claude-code only), then profile values, then process.env, then the fixed values. For claude-code, picker slots whose value is not in the live catalog are then reset to the catalog. Each agent then applies its own inputs and env entries.',
  inherited: [
    {
      source: 'profile',
      description:
        'Every key in the selected profile env file, for example CODEX_CONTEXT_WINDOW.',
    },
    {
      source: 'process.env',
      description:
        "The caller's whole environment. It overrides profile values.",
    },
  ],
  fixed: [
    {
      name: 'GATEWAY_URL',
      value: '{baseUrl}',
      description:
        'SUBCONSCIOUS_BASE_URL, then profile GATEWAY_URL, then the packaged default. Trailing slashes are removed.',
    },
    { name: 'API_KEY', value: '{apiKey}', description: 'Gateway credential.' },
    {
      name: '<agent key>',
      value: '{apiKey}',
      description:
        'The agent-specific key input (for example CODEX_API_KEY), set to the same credential.',
    },
    {
      name: 'MODEL',
      value: '{model}',
      description:
        '--model, then SUBCONSCIOUS_MODEL, then profile MODEL; UNSET or blank uses the first catalog model. A profile or default model missing from a live catalog is replaced by the first live model.',
    },
    {
      name: 'SUBCONSCIOUS_MODELS',
      value: '{catalog}',
      description: 'Newline-separated live model catalog.',
    },
    {
      name: 'PATH',
      value: '{binDir}:<install dirs>:{PATH}',
      description:
        "The caller's PATH with the agent's install directory and common install directories prepended.",
    },
  ],
  runbook_scripts: [
    {
      name: 'SUBC_MODEL_IDS',
      value: '{model} then {catalog}',
      description: 'The launch model first, then the catalog, deduplicated.',
    },
    {
      name: 'SUBC_VISION_MODELS',
      value: 'model IDs',
      description: 'Models that accept images, newline-separated.',
    },
    {
      name: 'SUBC_TEMPLATE_WORDS',
      value: 'count',
      description:
        'How many leading argv words came from the argv template; only those may hold {tempFile}.',
    },
  ],
  per_harness: { 'claude-code': CLAUDE_PICKER_ENV_DESCRIPTION },
});

/**
 * The env every launch and setup starts from: profile values, then the
 * caller's env, then the resolved gateway, key, model, and catalog. Claude
 * Code also gets its model picker, kept inside the live catalog.
 */
export function runbookEnv(
  apiKey,
  model,
  binDir,
  profile,
  agent,
  models = PACKAGED_MODELS,
) {
  const ctx = buildContext(apiKey, model, profile);
  const extraDirs = [binDir, ...candidateBinDirs()].filter(Boolean);
  const keyName = agentKeyName(agent);
  const claude = agent.id === CLAUDE_CODE;
  const picker = claude ? claudeModelPickerEnv(model, models) : {};
  return applyClaudePickerCatalog(
    {
      ...picker,
      ...(profile?.values || {}),
      ...process.env,
      GATEWAY_URL: ctx.baseUrl,
      API_KEY: apiKey,
      ...(keyName ? { [keyName]: apiKey } : {}),
      MODEL: model,
      SUBCONSCIOUS_MODELS: models.join('\n'),
      ...(claude
        ? {
            SUBC_CLAUDE_SETTINGS: JSON.stringify(
              claudePickerSettings(models, model),
            ),
          }
        : {}),
      PATH: augmentPath(extraDirs, binDir),
    },
    picker,
    models,
  );
}

async function resolvedModelsForLaunch(profile, apiKey, selectedModel) {
  const ctx = buildContext(apiKey, selectedModel, profile);
  const catalog = await resolveModelCatalog({
    baseUrl: ctx.baseUrl,
    apiKey,
    selectedModel,
    fallbackModels: PACKAGED_MODELS,
  });
  if (catalog.source === 'public' && apiKey) {
    console.error(`  ${c.dim}${PUBLIC_CATALOG_FALLBACK_MESSAGE}${c.reset}\n`);
  } else if (catalog.error) {
    console.error(
      `  ${c.yellow}Could not fetch the live model catalog; using packaged defaults.${c.reset}`,
    );
    console.error(`  ${c.dim}${catalog.error.message}${c.reset}\n`);
  }
  return catalog;
}

export function selectLaunchModel(requestedModel, modelSource, catalog) {
  const first = catalog.models[0] || requestedModel || DEFAULTS.model;
  if (modelSource === 'catalog' || !requestedModel) {
    return first;
  }
  const useLiveDefault =
    isLiveModelSource(catalog.source) &&
    catalog.models.length > 0 &&
    !catalog.models.includes(requestedModel) &&
    (modelSource === 'profile' || modelSource === 'default');
  return useLiveDefault ? first : requestedModel;
}

async function runRunbookSetup(agent, argv, profile) {
  const script = agent.runbook.setup_script;
  if (isSetupWithoutAuth(argv) || agent.runbook.setup_needs_auth === false) {
    // Status and uninstall read no model or
    // agent setting, so an invalid saved one must not block them.
    const lenient = { strict: false };
    const base = { ...(profile?.values || {}), ...process.env };
    const env = resolveInputs(agent, base, {}, lenient);
    return runCommand(scriptCommand(agent, script, argv, env, lenient));
  }

  const {
    model: requestedModel,
    modelSource,
    rest,
  } = extractModel(argv, profile);
  const apiKey =
    optionValue(rest, '--api-key') || (await requireApiKey(profile, agent));
  if (!apiKey) return 1;
  const catalog = await resolvedModelsForLaunch(
    profile,
    apiKey,
    requestedModel,
  );
  const model = selectLaunchModel(requestedModel, modelSource, catalog);
  if (requestedModel && model !== requestedModel) {
    console.error(
      `  ${c.yellow}Configured model ${requestedModel} is not in the live catalog; using ${model}.${c.reset}\n`,
    );
  }

  console.log(
    `  ${c.dim}Configuring ${c.reset}${c.bold}${agent.name}${c.reset} ${c.dim}for Subconscious (${model})${c.reset}\n`,
  );
  // Setup scripts read no strict-choice setting; only the model list matters.
  const env = resolveInputs(
    agent,
    runbookEnv(apiKey, model, undefined, profile, agent, catalog.models),
    {},
    { strict: false },
  );
  const code = await runCommand(scriptCommand(agent, script, rest, env));
  const installed = !['status', 'uninstall'].includes(rest[0]);
  if (code !== 0 || !installed) return code;

  if (agent.runbook.after_install) {
    console.log(`\n  ${c.dim}${agent.runbook.after_install}${c.reset}\n`);
  }
  return code;
}

async function runSetupAction(agent, parsed, profile) {
  if (!agent.runbook.setup_script) {
    throw new Error(`No persistent integration is available for ${agent.name}`);
  }
  const setupArgs =
    parsed.args[0] === parsed.action
      ? parsed.args
      : [parsed.action, ...parsed.args];
  const code = await runRunbookSetup(agent, setupArgs, profile);
  if (code === 0) {
    const message =
      parsed.action === 'status'
        ? `${agent.name} status check complete.`
        : parsed.action === 'uninstall'
          ? `${agent.name} integration removed.`
          : `${agent.name} setup complete.`;
    console.log(`\n  ${c.green}${c.bold}✓ ${message}${c.reset}\n`);
  }
  return code;
}

/** Split `headless PROMPT args...` from the words after subc's own flags. */
function headlessParts(rest) {
  const index = headlessPromptIndex(rest);
  return index < 0
    ? { args: rest, prompt: undefined }
    : { args: rest.slice(index + 1), prompt: rest[index] };
}

/**
 * Launch a coding agent against Subconscious. `argv` is everything after the
 * agent name; unknown flags pass straight through to the underlying CLI.
 */
export async function runAgent(agent, argv, options = {}) {
  const profile = options.profile;
  if (isAgentHelpRequest(argv)) {
    printAgentHelp(agent, profile);
    return 0;
  }

  const headless = isHeadlessRequest(agent, argv);
  if (headless && !agent.launch.headless_platforms.includes(process.platform)) {
    throw new Error(
      `${agent.name} headless mode is not available on ${process.platform === 'win32' ? 'Windows' : process.platform} yet.`,
    );
  }

  if (process.platform === 'win32') {
    return runWindowsAgent(agent, argv, {
      profile,
      parseAgentAction,
      extractModel,
      requireApiKey,
      resolvedModelsForLaunch,
      selectLaunchModel,
      runbookEnv,
      minimumClaudeVersion: MIN_CLAUDE_CODE_VERSION,
      headless,
      parseClaudeVersion,
      claudeVersionNeedsUpgrade,
    });
  }

  const parsed = parseAgentAction(agent, argv);
  if (parsed.action !== 'launch' && !headless) {
    return runSetupAction(agent, parsed, profile);
  }

  return launchAgent(agent, argv, profile, headless);
}

async function launchAgent(agent, argv, profile, headless) {
  // Arguments after -- belong to the agent, including its own --model.
  const boundary = separatorIndex(argv);
  const {
    model: requestedModel,
    modelSource,
    rest: subcRest,
  } = extractModel(boundary < 0 ? argv : argv.slice(0, boundary), profile);
  const rest = boundary < 0 ? subcRest : [...subcRest, ...argv.slice(boundary)];
  const apiKey = await requireApiKey(profile, agent);
  if (!apiKey) return 1;

  const mayPrompt = !headless;
  const binDir = await ensureInstalled(agent, { mayPrompt });
  await ensureMinimumVersion(agent, binDir, { mayPrompt });
  const catalog = await resolvedModelsForLaunch(
    profile,
    apiKey,
    requestedModel,
  );
  const model = selectLaunchModel(requestedModel, modelSource, catalog);
  if (requestedModel && model !== requestedModel) {
    console.error(
      `  ${c.yellow}Configured model ${requestedModel} is not in the live catalog; using ${model}.${c.reset}\n`,
    );
  }

  // Headless stdout belongs to the harness alone.
  (headless ? console.error : console.log)(
    `  ${c.dim}Launching ${c.reset}${c.bold}${agent.name}${c.reset} ${c.dim}on Subconscious ${c.reset}${c.dim}(${model})${c.reset}\n`,
  );
  const env = runbookEnv(apiKey, model, binDir, profile, agent, catalog.models);
  // The headless endpoint is the one endpoint for every harness, Claude too.
  const launchEnv = headless ? { ...env, CLAUDE_GATEWAY_URL: '' } : env;
  const plan = launchPlan(agent, { env: launchEnv, ...headlessParts(rest) });
  return runCommand(planCommand(agent, plan, binDir));
}
