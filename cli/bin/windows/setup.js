import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defaults, origin, value, modelIds, positiveInteger, parseOptions, object, readJson, writeJson } from './common.js';

const owned = command => {
  if (typeof command !== 'string') return false;
  if (/subconscious-hook\.(?:sh|cjs)/.test(command)) return true;
  const encoded = /-EncodedCommand ([A-Za-z0-9+/=]+)$/i.exec(command)?.[1];
  return Boolean(encoded && Buffer.from(encoded, 'base64').toString('utf16le').startsWith('# SUBC_WINDOWS_HOOK\n'));
};
const providerName = 'Subconscious Gateway';
const exists = async file => { try { await fs.access(file); return true; } catch { return false; } };

// Hook hosts expect command strings. Keep paths and credentials out of shell
// syntax: PowerShell decodes data, then invokes Node with an argv array.
export function windowsHookCommand(client, script, config, node = process.execPath) {
  const data = Buffer.from(JSON.stringify({ client, script, config, node })).toString('base64');
  const source = `# SUBC_WINDOWS_HOOK\n$d = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}')) | ConvertFrom-Json\n& $d.node $d.script $d.client $d.config\nexit 0`;
  return `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(source, 'utf16le').toString('base64')}`;
}

export function mergeHooks(document, client, command) {
  const result = structuredClone(object(document, 'hooks configuration'));
  const hooks = object(result.hooks ?? {}, 'hooks');
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) throw new Error(`hooks.${event} must be an array; leaving it unchanged`);
    const kept = [];
    for (const entry of entries) {
      object(entry, `hooks.${event} entry`);
      if (Array.isArray(entry.hooks)) {
        for (const hook of entry.hooks) object(hook, `hooks.${event} command`);
        const filtered = entry.hooks.filter(hook => !owned(hook.command));
        if (filtered.length || entry.hooks.length === 0) kept.push({ ...entry, hooks: filtered });
      } else if (entry.hooks !== undefined) {
        throw new Error(`hooks.${event}.hooks must be an array; leaving it unchanged`);
      } else if (!owned(entry.command)) kept.push(entry);
    }
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  if (command) {
    const events = { codex: ['PreCompact', 'PostCompact'], cursor: ['beforeSubmitPrompt', 'preCompact'], copilot: ['UserPromptSubmit', 'PreCompact'] }[client];
    for (const event of events) {
      const hook = { type: 'command', command, timeout: client === 'copilot' ? 5 : 3 };
      const entry = client === 'codex' ? { hooks: [{ ...hook, statusMessage: 'Reporting Subconscious compaction' }] } : hook;
      hooks[event] = [...(hooks[event] || []), entry];
    }
  }
  result.hooks = hooks;
  if (client === 'cursor' && command) result.version ??= 1;
  return result;
}

export async function windowsSetup(id, action, argv, environment, { home = os.homedir(), log = console.log } = {}) {
  const schema = { '--gateway-url': 1, '--api-key': 1, '--model': 1 };
  if (id === 'copilot') Object.assign(schema, { '--vscode-app': 1, '--max-input-tokens': 1, '--max-output-tokens': 1 });
  if (id === 'pi') Object.assign(schema, { '--context-window': 1, '--max-tokens': 1 });
  const { options } = parseOptions(argv, schema, { strict: true });
  const env = { ...environment, ...(options['--model'] ? { MODEL: options['--model'] } : {}) };
  const gatewayUrl = origin(options['--gateway-url'] || value(env, 'GATEWAY_URL', defaults.baseUrl));
  const apiKey = options['--api-key'] || value(env, 'API_KEY');
  const installing = action === 'install';
  const removing = action === 'uninstall';
  const needsKey = ['codex', 'cursor', 'copilot', 'pi'].includes(id);
  if (installing && needsKey && !apiKey) throw new Error('An API key is required for setup. Run subc login first.');

  if (['codex', 'cursor', 'copilot'].includes(id)) {
    const dir = id === 'codex' ? (env.CODEX_DIR || env.CODEX_HOME || path.join(home, '.codex')) : path.join(home, `.${id}`);
    const hooksFile = id === 'copilot' ? path.join(dir, 'hooks', 'subconscious-hooks.json') : path.join(dir, 'hooks.json');
    const script = path.join(dir, 'hooks', 'subconscious-hook.cjs');
    const config = path.join(dir, 'subconscious-windows.json');
    const document = await readJson(hooksFile, {});
    // Validate all existing user configuration before writing any files.
    const merged = mergeHooks(document, id, installing ? windowsHookCommand(id, script, config) : null);
    let providerFile, providers;
    if (id === 'copilot') {
      const apps = ['Code', 'Code - Insiders', 'VSCodium'];
      const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
      let app = options['--vscode-app'] || env.VSCODE_APP;
      if (app && !apps.includes(app)) throw new Error('--vscode-app must be Code, Code - Insiders, or VSCodium');
      if (!app) {
        for (const candidate of apps) if (await exists(path.join(appData, candidate, 'User'))) { app = candidate; break; }
        app ||= 'Code';
      }
      providerFile = path.join(appData, app, 'User', 'chatLanguageModels.json');
      const current = await readJson(providerFile, []);
      if (!Array.isArray(current)) throw new Error(`${providerFile} must be a JSON array; leaving it unchanged`);
      for (const provider of current) object(provider, 'language model provider');
      providers = current.filter(provider => provider.name !== providerName);
      if (installing) {
        const context = positiveInteger(options['--max-input-tokens'] || value(env, 'COPILOT_MAX_INPUT_TOKENS', '5000000'), 'max-input-tokens');
        const maxTokens = positiveInteger(options['--max-output-tokens'] || value(env, 'COPILOT_MAX_OUTPUT_TOKENS', '65536'), 'max-output-tokens');
        providers.push({ name: providerName, vendor: 'customendpoint', apiKey: '${input:chat.lm.secret.subconscious-gateway}', apiType: 'messages', models: modelIds(env).map(id => ({
          id, name: `Subconscious ${id}`, url: `${gatewayUrl}/v1/messages`, toolCalling: true, vision: false,
          maxInputTokens: context, maxOutputTokens: maxTokens, thinking: true, streaming: true,
          requestHeaders: { 'x-subconscious-client': 'copilot' },
        })) });
      }
    }
    if (action === 'status') {
      const hasHook = Object.values(document.hooks || {}).some(entries => entries.some(entry => owned(entry.command) || entry.hooks?.some(hook => owned(hook.command))));
      log(`${id}: ${hasHook ? 'Subconscious hooks installed' : 'no Subconscious hooks'} (${hooksFile})`);
      if (providerFile) log(`Model configuration: ${providerFile}`);
      return 0;
    }
    if (installing) {
      await fs.mkdir(path.dirname(script), { recursive: true });
      await fs.copyFile(new URL('./hook.cjs', import.meta.url), script);
      await writeJson(config, { gatewayUrl, apiKey });
    }
    if (installing || await exists(hooksFile)) await writeJson(hooksFile, merged);
    if (providerFile && (installing || await exists(providerFile))) await writeJson(providerFile, providers);
    if (removing) {
      await fs.rm(script, { force: true });
      await fs.rm(config, { force: true });
    }
    if (installing && id === 'cursor') log(`In Cursor Settings, use ${gatewayUrl}/v1, your API key, and model ${value(env, 'MODEL', defaults.model)}. Restart Cursor to load hooks.`);
    if (installing && id === 'copilot') log('Restart VS Code, select a Subconscious model, and enter your API key when prompted.');
    log(`${id}: Windows integration ${installing ? 'installed' : 'removed'}.`);
    return 0;
  }
  if (id === 'pi') {
    const dir = env.PI_CODING_AGENT_DIR || path.join(home, '.pi', 'agent');
    const modelsFile = path.join(dir, 'models.json');
    const document = object(await readJson(modelsFile, {}), 'Pi models');
    const providers = object(document.providers ?? {}, 'Pi providers');
    if (action === 'status') { log(`Pi: ${providers.subconscious ? 'Subconscious provider installed' : 'not installed'} (${modelsFile})`); return 0; }
    const extension = path.join(dir, 'extensions', 'subconscious-compaction.ts');
    const config = path.join(dir, 'subconscious-windows.json');
    if (installing) {
      const context = positiveInteger(options['--context-window'] || value(env, 'PI_CONTEXT_WINDOW', '5000000'), 'context-window');
      const maxTokens = positiveInteger(options['--max-tokens'] || value(env, 'PI_MAX_TOKENS', '65536'), 'max-tokens');
      providers.subconscious = { baseUrl: `${gatewayUrl}/v1`, api: 'openai-completions', apiKey, headers: { 'x-subconscious-client': 'pi' }, models: modelIds(env).map(id => ({ id, contextWindow: context, maxTokens, compat: { sendSessionAffinityHeaders: true, sessionAffinityFormat: 'openai-nosession' } })) };
      await fs.mkdir(path.dirname(extension), { recursive: true });
      await fs.copyFile(new URL('./pi-compaction.ts', import.meta.url), extension);
      await writeJson(config, { gatewayUrl, apiKey });
    } else {
      delete providers.subconscious;
      await fs.rm(extension, { force: true });
      await fs.rm(config, { force: true });
    }
    if (installing || await exists(modelsFile)) await writeJson(modelsFile, { ...document, providers });
    log(`Pi: Windows integration ${installing ? 'installed' : 'removed'}.`);
    return 0;
  }
  if (id === 'claude-code' || id === 'opencode') {
    const dir = path.join(home, id === 'claude-code' ? '.claude' : '.opencode');
    const legacy = path.join(dir, id === 'claude-code' ? 'subconscious-gateway.env' : 'subconscious.env');
    let present = await exists(legacy);
    if (id === 'opencode') {
      const file = path.join(dir, 'opencode.json');
      const document = object(await readJson(file, {}), 'OpenCode configuration');
      if (document.provider !== undefined) object(document.provider, 'OpenCode providers');
      present ||= Boolean(document.provider?.subconscious);
      if (removing && await exists(file)) {
        if (document.provider) delete document.provider.subconscious;
        if (document.model?.startsWith('subconscious/')) delete document.model;
        await writeJson(file, document);
      }
      if (removing) await fs.rm(path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode', 'plugins', 'subconscious-compaction.ts'), { force: true });
    }
    if (removing) await fs.rm(legacy, { force: true });
    log(`${id}: ${removing ? 'legacy integration removed' : present ? 'legacy integration exists' : 'launch-only; no legacy integration'}.`);
    return 0;
  }
  throw new Error(`No native Windows setup is available for ${id}`);
}
