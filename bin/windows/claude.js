// Windows-only equivalent of the existing Claude shell launch.
import { readFileSync } from 'node:fs';
import { resolvedModelSetting } from '../profiles.js';
import { positiveInteger, parseOptions } from './common.js';
const DEFAULTS = JSON.parse(readFileSync(new URL('../registry.generated.json', import.meta.url), 'utf8')).defaults;
function claudePickerSettings(models) {
  return { availableModels: models, modelPicker: { replaceBuiltInOptions: true, options: models.map(model => ({model, label: model, description: 'Subconscious model ' + model})) } };
}

export function claudeNativeLaunch(argv, environment) {
  const { options, rest: passthrough } = parseOptions(argv, {
    '--gateway-url': 1, '--api-key': 1, '--model': 1,
    '--compact-window': 1, '--max-context-tokens': 1,
  });
  const gatewayUrl = options['--gateway-url'] || environment.GATEWAY_URL?.trim() || '';
  const apiKey = options['--api-key'] || environment.CLAUDE_CODE_API_KEY?.trim() || environment.API_KEY?.trim() || '';
  const model = options['--model'] || environment.MODEL?.trim() || DEFAULTS.model;
  const compactWindow = options['--compact-window'] ||
    environment.CLAUDE_CODE_AUTO_COMPACT_WINDOW?.trim() ||
    environment.COMPACT_WINDOW?.trim() ||
    '1000000';
  const maxContextTokens = options['--max-context-tokens'] ||
    environment.CLAUDE_CODE_MAX_CONTEXT_TOKENS?.trim() ||
    environment.MAX_CONTEXT_TOKENS?.trim() ||
    '3000000';

  if (!gatewayUrl || !apiKey) {
    throw new Error('GATEWAY_URL and API_KEY are required to launch Claude Code');
  }
  positiveInteger(compactWindow, 'compact-window');
  positiveInteger(maxContextTokens, 'max-context-tokens');

  const effectiveGatewayUrl = environment.CLAUDE_GATEWAY_URL?.trim() || gatewayUrl;
  const subagentModel = resolvedModelSetting(environment.CLAUDE_CODE_SUBAGENT_MODEL) || model;
  const settings =
    environment.SUBC_CLAUDE_SETTINGS?.trim() ||
    JSON.stringify(claudePickerSettings([model], model));
  const withoutTrailingSlash = effectiveGatewayUrl.replace(/\/+$/, '');
  const env = {
    ...environment,
    ANTHROPIC_BASE_URL: effectiveGatewayUrl,
    ANTHROPIC_AUTH_TOKEN: apiKey,
    ANTHROPIC_MODEL: environment.ANTHROPIC_MODEL?.trim() || model,
    ANTHROPIC_SMALL_FAST_MODEL: environment.ANTHROPIC_SMALL_FAST_MODEL?.trim() || model,
    CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY:
      environment.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY?.trim() || '0',
    CLAUDE_CODE_SUBAGENT_MODEL: subagentModel,
    CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS:
      environment.MAX_CONCURRENT_SUBAGENTS?.trim() || '4',
    CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH:
      environment.MAX_SUBAGENT_SPAWN_DEPTH?.trim() || '1',
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: compactWindow,
    CLAUDE_CODE_MAX_CONTEXT_TOKENS: maxContextTokens,
    CLAUDE_CODE_ENABLE_TELEMETRY:
      environment.CLAUDE_CODE_ENABLE_TELEMETRY?.trim() || '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:
      environment.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC?.trim() || '1',
    ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
    OTEL_LOGS_EXPORTER: environment.OTEL_LOGS_EXPORTER?.trim() || 'otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL:
      environment.OTEL_EXPORTER_OTLP_PROTOCOL?.trim() || 'http/json',
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${withoutTrailingSlash}/v1/logs`,
    OTEL_EXPORTER_OTLP_HEADERS: `x-api-key=${apiKey}`,
    OTEL_EXPORTER_OTLP_TIMEOUT:
      environment.OTEL_EXPORTER_OTLP_TIMEOUT?.trim() || '2000',
    OTEL_LOGS_EXPORT_INTERVAL:
      environment.OTEL_LOGS_EXPORT_INTERVAL?.trim() || '2000',
  };

  return { args: ['--settings', settings, ...passthrough], env };
}
