// Native Windows launch specifications; never source or modify Unix runbooks.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { agentById, agentKeyName } from '../agent-data.js';
import {
  launchPlan,
  resolveAgentEnv,
  resolveInputs,
  takeFlags,
} from '../agent-launch.js';
import { claudePickerSettings } from '../claude-picker.js';
import { modelIds, positiveInteger } from '../launch-values.js';
import { modelSupportsVision } from '../model-capabilities.js';
import { defaults, origin, value, writeJson } from './common.js';

const PLANNED = new Set(['claude-code', 'subconscious-code', 'pi', 'opencode']);

// Windows trims a configured gateway to its origin and gives every agent but
// Claude the gateway and key as SUBCONSCIOUS_*. Claude has always been given
// the gateway as configured.
function windowsEnv(id, env) {
  const model = value(env, 'MODEL', defaults.model);
  const gateway = value(env, 'GATEWAY_URL', defaults.baseUrl);
  if (id === 'claude-code')
    return { ...env, MODEL: model, GATEWAY_URL: gateway };
  const keyName = agentKeyName(agentById(id));
  return {
    ...env,
    MODEL: model,
    GATEWAY_URL: origin(gateway),
    SUBCONSCIOUS_API_KEY: value(env, keyName, value(env, 'API_KEY')),
    SUBCONSCIOUS_GATEWAY_URL: origin(gateway),
  };
}

function claudeLaunch(agent, argv, env) {
  const settings =
    value(env, 'SUBC_CLAUDE_SETTINGS') ||
    JSON.stringify(claudePickerSettings([env.MODEL], env.MODEL));
  const plan = launchPlan(agent, {
    env: { ...env, SUBC_CLAUDE_SETTINGS: settings },
    args: argv,
  });
  if (!plan.env.ANTHROPIC_BASE_URL || !plan.env.ANTHROPIC_AUTH_TOKEN) {
    throw new Error(
      'GATEWAY_URL and API_KEY are required to launch Claude Code',
    );
  }
  positiveInteger(plan.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, 'compact-window');
  positiveInteger(
    plan.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS,
    'max-context-tokens',
  );
  return plan;
}

function plannedLaunch(agent, argv, env) {
  const plan =
    agent.id === 'claude-code'
      ? claudeLaunch(agent, argv, env)
      : launchPlan(agent, { env, args: argv });
  return { command: plan.argv[0], args: plan.argv.slice(1), env: plan.env };
}

function codexCatalog(env, context, maxContext, compact) {
  return {
    models: modelIds(env).map((id) => ({
      slug: id,
      display_name: id,
      description: `Subconscious model ${id}`,
      context_window: context,
      max_context_window: maxContext,
      auto_compact_token_limit: compact,
      effective_context_window_percent: 95,
      supported_reasoning_levels: [],
      shell_type: 'shell_command',
      visibility: 'list',
      supported_in_api: true,
      priority: 0,
      service_tiers: [
        {
          id: 'priority',
          name: 'Priority',
          description:
            'Route requests through the configured priority service tier',
        },
      ],
      availability_nux: null,
      upgrade: null,
      base_instructions: 'You are Codex, a coding agent.',
      supports_reasoning_summaries: false,
      support_verbosity: false,
      default_verbosity: null,
      apply_patch_tool_type: 'freeform',
      truncation_policy: { mode: 'tokens', limit: 10000 },
      supports_parallel_tool_calls: true,
      experimental_supported_tools: [],
      // Codex assumes ['text', 'image'] when the field is missing.
      input_modalities: modelSupportsVision(id) ? ['text', 'image'] : ['text'],
    })),
  };
}

// --subagents is Windows-only: it runs a pinned older Codex instead.
function splitSubagents(argv) {
  const boundary = argv.indexOf('--');
  const head = boundary < 0 ? argv : argv.slice(0, boundary);
  const tail = boundary < 0 ? [] : argv.slice(boundary);
  for (const arg of head)
    if (arg.startsWith('--subagents='))
      throw new Error('--subagents does not take a value');
  return {
    subagents: head.includes('--subagents'),
    words: [...head.filter((arg) => arg !== '--subagents'), ...tail],
  };
}

function codexConfig(env, file) {
  const config = {
    model: env.MODEL,
    model_provider: 'subconscious',
    model_catalog_json: file,
    model_reasoning_effort: env.CODEX_REASONING_EFFORT,
    web_search: 'disabled',
    'model_providers.subconscious.name': 'Subconscious',
    'model_providers.subconscious.base_url': `${env.GATEWAY_URL}/v1`,
    'model_providers.subconscious.wire_api': 'responses',
    'model_providers.subconscious.env_key': 'SUBCONSCIOUS_API_KEY',
    'model_providers.subconscious.stream_idle_timeout_ms': Number(
      env.CODEX_STREAM_IDLE_TIMEOUT_MS,
    ),
  };
  if (env.CODEX_EXTERNAL_TOOLS !== 'true') {
    Object.assign(config, {
      'features.apps': false,
      'features.plugins': false,
      'apps._default.enabled': false,
    });
  }
  return config;
}

async function codexLaunch(agent, argv, env, tempRoot) {
  const { subagents, words } = splitSubagents(argv);
  // Windows Codex sets no subagent effort, so that flag still reaches Codex
  // unchanged.
  const { values, rest } = takeFlags(agent, words, {
    skip: ['CODEX_SUBAGENT_REASONING_EFFORT'],
  });
  const resolved = resolveAgentEnv(agent, resolveInputs(agent, env, values));
  const context = positiveInteger(
    resolved.CODEX_CONTEXT_WINDOW,
    'context-window',
  );
  const maxContext = positiveInteger(
    resolved.CODEX_MAX_CONTEXT_WINDOW,
    'max-context-window',
  );
  const compact = positiveInteger(
    resolved.CODEX_AUTO_COMPACT_TOKEN_LIMIT,
    'auto-compact-token-limit',
  );
  const catalog = codexCatalog(resolved, context, maxContext, compact);
  // Validate all flags before creating a temporary directory.
  positiveInteger(resolved.CODEX_STREAM_IDLE_TIMEOUT_MS, 'stream-idle-timeout');
  const threads = positiveInteger(
    resolved.MAX_CONCURRENT_SUBAGENTS,
    'MAX_CONCURRENT_SUBAGENTS',
  );
  const dir = await fs.mkdtemp(path.join(tempRoot, 'subc-codex-'));
  const cleanup = () => fs.rm(dir, { recursive: true, force: true });
  try {
    const file = path.join(dir, 'models.json');
    await writeJson(file, catalog);
    const config = codexConfig(resolved, file);
    if (subagents)
      Object.assign(config, {
        'features.multi_agent': true,
        'agents.max_threads': threads,
        'agents.max_depth': 1,
        'agents.interrupt_message': true,
      });
    const args = Object.entries(config).flatMap(([k, v]) => [
      '-c',
      `${k}=${JSON.stringify(v)}`,
    ]);
    return {
      command: subagents ? 'npx' : 'codex',
      args: [
        ...(subagents ? ['-y', '@openai/codex@0.132.0'] : []),
        ...args,
        ...rest,
      ],
      env: resolved,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

function dshOverlay(env, context, maxTokens) {
  const models = modelIds(env)
    .map(
      (id) =>
        `          - id: '${id}'\n            name: '${id}'\n${modelSupportsVision(id) ? '            input: [text, image]\n' : ''}            contextWindow: ${context}\n            maxTokens: ${maxTokens}`,
    )
    .join('\n');
  return `- id: llm-pi-ai\n  config:\n    providers:\n      subconscious:\n        apiKeyEnv: SUBCONSCIOUS_API_KEY\n        displayName: Subconscious Gateway\n        api: openai-completions\n        baseURL: !!js process.env.SUBCONSCIOUS_DSH_BASE_URL\n        headers:\n          x-subconscious-client: deepseek-harness\n        compat:\n          supportsDeveloperRole: false\n          maxTokensField: max_tokens\n        defaultContextWindow: ${context}\n        defaultMaxTokens: ${maxTokens}\n        models:\n${models}\n- id: agent-default-model\n  config:\n    provider: subconscious\n    model: '${env.MODEL}'\n`;
}

async function dshLaunch(agent, argv, env, tempRoot) {
  const headless = argv[0] === 'headless';
  const plan = launchPlan(agent, {
    env,
    args: headless ? argv.slice(2) : argv,
    prompt: headless ? argv[1] : undefined,
  });
  const context = positiveInteger(
    plan.env.DEEPSEEK_HARNESS_CONTEXT_WINDOW,
    'DEEPSEEK_HARNESS_CONTEXT_WINDOW',
  );
  const maxTokens = positiveInteger(
    plan.env.DEEPSEEK_HARNESS_MAX_TOKENS,
    'DEEPSEEK_HARNESS_MAX_TOKENS',
  );
  const text = dshOverlay(plan.env, context, maxTokens);
  const dir = await fs.mkdtemp(path.join(tempRoot, 'subc-dsh-'));
  const cleanup = () => fs.rm(dir, { recursive: true, force: true });
  try {
    const file = path.join(dir, 'subconscious.cordis.yml');
    await fs.writeFile(file, text, { mode: 0o600, flag: 'wx' });
    const argvWithFile = plan.argv.map((word, index) =>
      index < plan.templateWords ? word.replaceAll('{tempFile}', file) : word,
    );
    return {
      command: argvWithFile[0],
      args: argvWithFile.slice(1),
      env: plan.env,
      ...(plan.input === undefined ? {} : { input: plan.input }),
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function windowsLaunch(
  id,
  argv,
  env,
  { tempRoot = os.tmpdir() } = {},
) {
  const agent = agentById(id);
  const launchEnv = windowsEnv(id, env);
  if (PLANNED.has(id)) return plannedLaunch(agent, argv, launchEnv);
  if (id === 'codex') return codexLaunch(agent, argv, launchEnv, tempRoot);
  if (id === 'deepseek-harness')
    return dshLaunch(agent, argv, launchEnv, tempRoot);
  throw new Error(`No native Windows launcher is available for ${id}`);
}

export async function executeWindowsLaunch(spec, run) {
  try {
    const options =
      spec.input === undefined
        ? { env: spec.env }
        : { env: spec.env, input: spec.input };
    return await run(spec.command, spec.args, options);
  } finally {
    await spec.cleanup?.();
  }
}
