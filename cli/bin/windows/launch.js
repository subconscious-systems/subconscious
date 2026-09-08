// Native Windows launch specifications; never source or modify Unix runbooks.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { claudeNativeLaunch } from './claude.js';
import { defaults, value, origin, modelIds, positiveInteger, parseOptions, writeJson } from './common.js';

function connection(env, keyName) {
  return {
    model: value(env, 'MODEL', defaults.model),
    base: origin(value(env, 'GATEWAY_URL', defaults.baseUrl)),
    key: value(env, keyName, value(env, 'API_KEY')),
  };
}

export async function windowsLaunch(id, argv, env, { tempRoot = os.tmpdir() } = {}) {
  if (id === 'claude-code') return { command: 'claude', ...claudeNativeLaunch(argv, env) };
  const keyName = { codex: 'CODEX_API_KEY', opencode: 'OPENCODE_API_KEY', pi: 'PI_API_KEY', 'subconscious-code': 'SC_API_KEY', 'deepseek-harness': 'DEEPSEEK_HARNESS_API_KEY' }[id];
  const { model, base, key } = connection(env, keyName);
  const childEnv = { ...env, SUBCONSCIOUS_API_KEY: key, SUBCONSCIOUS_GATEWAY_URL: base };
  if (id === 'subconscious-code') {
    return { command: 'sc', args: argv, env: { ...childEnv, SC_API_KEY: key, SC_BASE_URL: `${base}/v1`, SC_DLR_URL: base, SC_DLR_ENABLED: 'true', SC_MODEL: model } };
  }
  if (id === 'pi') return { command: 'pi', args: ['--provider', 'subconscious', '--model', model, ...argv], env: childEnv };
  if (id === 'opencode') {
    const context = positiveInteger(value(env, 'OPENCODE_CONTEXT_LIMIT', '5000000'), 'OPENCODE_CONTEXT_LIMIT');
    const output = positiveInteger(value(env, 'OPENCODE_OUTPUT_LIMIT', '65536'), 'OPENCODE_OUTPUT_LIMIT');
    const models = Object.fromEntries(modelIds(env).map(id => [id, { name: id, tools: true, limit: { context, output } }]));
    childEnv.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      $schema: 'https://opencode.ai/config.json', disabled_providers: ['subconscious'],
      provider: { 'subconscious-cli': { npm: '@ai-sdk/openai-compatible', name: 'Subconscious Gateway', options: {
        baseURL: `${base}/v1`, apiKey: '{env:SUBCONSCIOUS_API_KEY}', headers: { 'x-subconscious-client': 'opencode' },
      }, models } }, model: `subconscious-cli/${model}`,
    });
    return { command: 'opencode', args: parseOptions(argv, {}).rest, env: childEnv };
  }
  if (id === 'codex') {
    const { options: opts, rest } = parseOptions(argv, { '--context-window': 1, '--max-context-window': 1, '--auto-compact-token-limit': 1, '--reasoning-effort': 1, '--subagents': true, '--external-tools': true });
    const context = positiveInteger(opts['--context-window'] || value(env, 'CODEX_CONTEXT_WINDOW', '5000000'), 'context-window');
    const maxContext = positiveInteger(opts['--max-context-window'] || value(env, 'CODEX_MAX_CONTEXT_WINDOW', String(context)), 'max-context-window');
    const compact = positiveInteger(opts['--auto-compact-token-limit'] || value(env, 'CODEX_AUTO_COMPACT_TOKEN_LIMIT', '4500000'), 'auto-compact-token-limit');
    const reasoning = opts['--reasoning-effort'] || value(env, 'CODEX_REASONING_EFFORT', 'max');
    if (!['none', 'low', 'medium', 'high', 'max'].includes(reasoning)) throw new Error('reasoning-effort must be none, low, medium, high, or max');
    const catalog = { models: modelIds(env).map(id => ({
      slug: id, display_name: id, description: `Subconscious model ${id}`,
      context_window: context, max_context_window: maxContext, auto_compact_token_limit: compact,
      effective_context_window_percent: 95, supported_reasoning_levels: [], shell_type: 'shell_command',
      visibility: 'list', supported_in_api: true, priority: 0,
      service_tiers: [{ id: 'priority', name: 'Priority', description: 'Route requests through the configured priority service tier' }],
      availability_nux: null, upgrade: null, base_instructions: 'You are Codex, a coding agent.',
      supports_reasoning_summaries: false, support_verbosity: false, default_verbosity: null,
      apply_patch_tool_type: 'freeform', truncation_policy: { mode: 'tokens', limit: 10000 },
      supports_parallel_tool_calls: true, experimental_supported_tools: [],
    })) };
    // Validate all flags before creating a temporary directory.
    const threads = positiveInteger(value(env, 'MAX_CONCURRENT_SUBAGENTS', '4'), 'MAX_CONCURRENT_SUBAGENTS');
    const dir = await fs.mkdtemp(path.join(tempRoot, 'subc-codex-'));
    const cleanup = () => fs.rm(dir, { recursive: true, force: true });
    try {
      const file = path.join(dir, 'models.json');
      await writeJson(file, catalog);
      const config = {
        model, model_provider: 'subconscious', model_catalog_json: file, model_reasoning_effort: reasoning,
        web_search: 'disabled', 'model_providers.subconscious.name': 'Subconscious',
        'model_providers.subconscious.base_url': `${base}/v1`, 'model_providers.subconscious.wire_api': 'responses',
        'model_providers.subconscious.env_key': 'SUBCONSCIOUS_API_KEY', 'model_providers.subconscious.stream_idle_timeout_ms': 300000,
      };
      if (!opts['--external-tools'] && value(env, 'CODEX_EXTERNAL_TOOLS', 'false') !== 'true') {
        Object.assign(config, { 'features.apps': false, 'features.plugins': false, 'apps._default.enabled': false });
      }
      if (opts['--subagents']) Object.assign(config, { 'features.multi_agent': true, 'agents.max_threads': threads, 'agents.max_depth': 1, 'agents.interrupt_message': true });
      const args = Object.entries(config).flatMap(([k, v]) => ['-c', `${k}=${JSON.stringify(v)}`]);
      return { command: opts['--subagents'] ? 'npx' : 'codex', args: [...(opts['--subagents'] ? ['-y', '@openai/codex@0.132.0'] : []), ...args, ...rest], env: childEnv, cleanup };
    } catch (error) { await cleanup(); throw error; }
  }
  if (id === 'deepseek-harness') {
    const context = positiveInteger(value(env, 'DEEPSEEK_HARNESS_CONTEXT_WINDOW', '5000000'), 'DEEPSEEK_HARNESS_CONTEXT_WINDOW');
    const maxTokens = positiveInteger(value(env, 'DEEPSEEK_HARNESS_MAX_TOKENS', '65536'), 'DEEPSEEK_HARNESS_MAX_TOKENS');
    const models = modelIds(env);
    const dir = await fs.mkdtemp(path.join(tempRoot, 'subc-dsh-'));
    const cleanup = () => fs.rm(dir, { recursive: true, force: true });
    try {
      const file = path.join(dir, 'subconscious.cordis.yml');
      const text = `- id: llm-pi-ai\n  config:\n    providers:\n      subconscious:\n        apiKeyEnv: SUBCONSCIOUS_API_KEY\n        displayName: Subconscious Gateway\n        api: openai-completions\n        baseURL: !!js process.env.SUBCONSCIOUS_DSH_BASE_URL\n        headers:\n          x-subconscious-client: deepseek-harness\n        compat:\n          supportsDeveloperRole: false\n          maxTokensField: max_tokens\n        defaultContextWindow: ${context}\n        defaultMaxTokens: ${maxTokens}\n        models:\n${models.map(id => `          - id: '${id}'\n            name: '${id}'\n            contextWindow: ${context}\n            maxTokens: ${maxTokens}`).join('\n')}\n- id: agent-default-model\n  config:\n    provider: subconscious\n    model: '${model}'\n`;
      await fs.writeFile(file, text, { mode: 0o600, flag: 'wx' });
      const mode = ['web', 'headless'].includes(argv[0]) ? argv[0] : 'web';
      const rest = ['web', 'headless'].includes(argv[0]) ? argv.slice(1) : argv;
      return { command: 'dsh', args: [...(mode === 'web' ? ['web'] : ['--profile', 'headless']), '--patch', file, ...rest], env: { ...childEnv, SUBCONSCIOUS_DSH_BASE_URL: `${base}/v1` }, cleanup };
    } catch (error) { await cleanup(); throw error; }
  }
  throw new Error(`No native Windows launcher is available for ${id}`);
}

export async function executeWindowsLaunch(spec, run) {
  try { return await run(spec.command, spec.args, { env: spec.env }); }
  finally { await spec.cleanup?.(); }
}
