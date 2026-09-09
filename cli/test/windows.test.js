import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { windowsEnv, windowsBinDirs, windowsPath, windowsInvocation, windowsEditor, resolveWindowsExecutable, powershellCommand, runWindows } from '../bin/windows/process.js';
import { windowsLaunch, executeWindowsLaunch } from '../bin/windows/launch.js';
import { windowsSetup, mergeHooks, windowsHookCommand } from '../bin/windows/setup.js';
import { windowsInstallSpec, windowsReleaseAsset, installWindowsSC } from '../bin/windows/install.js';
import { writeJson, parseOptions } from '../bin/windows/common.js';
import { detectInstallTarget } from '../bin/update-check.js';
import { nativeTargetName } from '../bin/tui.js';
import { resolveAgent, agentList } from '../bin/agents.js';

const env = { GATEWAY_URL: 'https://gateway.example/v1/', API_KEY: 'sk-test', MODEL: 'subconscious/glm-5.2', SUBCONSCIOUS_MODELS: 'subconscious/glm-5.2\ncustom/model' };
const hook = fileURLToPath(new URL('../bin/windows/hook.cjs', import.meta.url));
const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const quiet = () => {};
const isWindows = process.platform === 'win32';

test('Marathon is canonical, legacy aliases are safe, and Unix keeps its binary', () => {
  const agent = resolveAgent('marathon');
  assert.equal(agent.id, 'subconscious-code');
  assert.equal(agent.command, 'marathon');
  assert.equal(agent.bin, isWindows ? 'marathon' : 'sc');
  assert.equal(resolveAgent('sc'), agent);
  assert.equal(resolveAgent('subconscious-code'), agent);
  assert.equal(agentList().find(item => item.id === agent.id).alias, 'marathon');
});

async function temporary(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subc-windows-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
function child(command, args, options = {}, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', text => { stdout += text; });
    child.stderr.setEncoding('utf8').on('data', text => { stderr += text; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
async function gateway(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('Windows paths cover user, npm and native-installer system profile locations', () => {
  const dirs = windowsBinDirs({ APPDATA: 'C:\\Users\\Admin\\AppData\\Roaming', USERPROFILE: 'C:\\Users\\Admin', SystemRoot: 'C:\\WINDOWS' }, 'C:\\Users\\Admin');
  assert.ok(dirs.includes('C:\\Users\\Admin\\.local\\bin'));
  assert.ok(dirs.includes('C:\\WINDOWS\\System32\\config\\systemprofile\\.local\\bin'));
  assert.ok(dirs.includes('C:\\Users\\Admin\\AppData\\Roaming\\npm'));
  assert.equal(windowsPath(['C:\\Bin', 'c:\\bin'], 'C:\\Other;"c:\\BIN"'), 'C:\\Bin;C:\\Other');
  assert.deepEqual(windowsEnv({ Path: 'old', SystemRoot: 'C:\\Windows' }, { PATH: 'new', nothing: undefined }), { PATH: 'new', SYSTEMROOT: 'C:\\Windows' });
});

test('Windows executable lookup honors preferred dirs and prefers native executables', () => {
  const files = new Set(['C:\\native\\claude.exe', 'C:\\npm\\claude.cmd']);
  const options = { env: { Path: 'C:\\npm' }, preferredDirs: ['C:\\native'], isFile: name => files.has(name) };
  assert.equal(resolveWindowsExecutable('claude', options), 'C:\\native\\claude.exe');
  assert.equal(resolveWindowsExecutable('missing', options), null);
});

test('npm shims preserve exact JSON, Unicode, empty arguments and shell metacharacters', async t => {
  const root = await temporary(t);
  const dir = path.join(root, 'user space & %data%');
  await fs.mkdir(dir);
  const entry = path.join(dir, 'agent.cjs');
  const shim = path.join(dir, 'agent.cmd');
  await fs.writeFile(entry, 'console.log(JSON.stringify(process.argv.slice(2)))');
  await fs.writeFile(shim, '@ECHO off\nSET dp0=%~dp0\n"%dp0%\\node.exe" "%dp0%\\agent.cjs" %*\n');
  const args = ['--settings', '{"text":"a \\"quote\\" & %PATH%"}', '', 'line one\nline two', 'café 日本語', 'C:\\dir with spaces\\', 'x|y>z<q^r!s'];
  const invocation = windowsInvocation(shim, args, process.env, { pathApi: path, resolve: () => shim });
  assert.equal(invocation.command, process.execPath);
  const result = await child(invocation.command, invocation.args, { env: invocation.env });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), args);
});

for (const name of ['npm', 'npx']) test(`Node's bundled ${name}.cmd resolves the CLI, not npm-prefix.js`, async t => {
  const dir = await temporary(t);
  const bin = path.join(dir, 'node_modules', 'npm', 'bin');
  await fs.mkdir(bin, { recursive: true });
  for (const file of ['npm-prefix.js', 'npm-cli.js', 'npx-cli.js']) await fs.writeFile(path.join(bin, file), '// fixture');
  const shim = path.join(dir, name + '.cmd');
  await fs.writeFile(shim, 'SET "NODE_EXE=%~dp0\\node.exe"\nSET "NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js"\nSET "NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js"\nSET "NPX_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npx-cli.js"');
  // Fixture uses native separators for testing the resolver on Unix too.
  const invocation = windowsInvocation(shim, ['--version'], {}, { pathApi: path, resolve: () => shim, readFile: file => {
    if (file === shim) return `SET "NODE_EXE=%~dp0/node.exe"\nSET "NPM_PREFIX_JS=%~dp0/node_modules/npm/bin/npm-prefix.js"\nSET "NPM_CLI_JS=%~dp0/node_modules/npm/bin/npm-cli.js"\nSET "NPX_CLI_JS=%~dp0/node_modules/npm/bin/npx-cli.js"`;
    return '// fixture';
  } });
  assert.equal(invocation.args[0], path.join(bin, name + '-cli.js'));
});

test('unknown batch wrappers fail with guidance rather than using a shell', () => {
  assert.throws(() => windowsInvocation('custom', [], {}, { resolve: () => 'C:\\custom.cmd', readFile: () => 'echo %*' }), /custom batch wrapper/);
});

test('npm native-executable shims launch the agent, not node.exe', async t => {
  const dir = await temporary(t);
  const shim = path.join(dir, 'claude.cmd');
  const executable = path.join(dir, 'claude.exe');
  await fs.writeFile(executable, 'MZ-fixture');
  const invocation = windowsInvocation(shim, ['--continue'], {}, { pathApi: path, resolve: () => shim, readFile: () => '"%dp0%/node.exe"\n"%dp0%/claude.exe" %*' });
  assert.equal(invocation.command, executable);
  assert.deepEqual(invocation.args, ['--continue']);
});

test('VS Code command shims retain their Electron runner and script argv', async t => {
  const dir = await temporary(t);
  const shim = path.join(dir, 'code.cmd');
  const executable = path.join(dir, 'Code.exe');
  await fs.writeFile(executable, 'MZ-fixture');
  const invocation = windowsInvocation(shim, ['--wait', 'C:\\a b\\profile.env'], {}, { pathApi: path, resolve: () => shim, readFile: file => file === shim ? 'set ELECTRON_RUN_AS_NODE=1\n"%~dp0Code.exe" "%~dp0cli.js" %*' : '// fixture' });
  assert.equal(invocation.command, executable);
  assert.equal(invocation.env.ELECTRON_RUN_AS_NODE, '1');
  assert.deepEqual(invocation.args, [path.join(dir, 'cli.js'), '--wait', 'C:\\a b\\profile.env']);
});

test('Windows editors preserve paths and wait for VS Code', () => {
  assert.deepEqual(windowsEditor(undefined, {}), { command: 'notepad.exe', args: [] });
  assert.deepEqual(windowsEditor(undefined, { VISUAL: '"C:\\Program Files\\Code\\code.cmd" --wait' }), { command: 'C:\\Program Files\\Code\\code.cmd', args: ['--wait'] });
  assert.deepEqual(windowsEditor('code', {}), { command: 'code', args: ['--wait'] });
  assert.throws(() => windowsEditor('"broken', {}), /Unmatched quote/);
});

test('PowerShell dynamic data stays in environment rather than executable source', () => {
  const spec = powershellCommand('Start-Process -FilePath $env:SUBC_BROWSER_URL', { SUBC_BROWSER_URL: 'https://example.test/?a=1&b=%PATH%' });
  const source = Buffer.from(spec.args.at(-1), 'base64').toString('utf16le');
  assert.equal(source, 'Start-Process -FilePath $env:SUBC_BROWSER_URL');
  assert.doesNotMatch(source, /example\.test/);
  assert.equal(spec.env.SUBC_BROWSER_URL, 'https://example.test/?a=1&b=%PATH%');
});

test('native child status is preserved and signal listeners are removed', async () => {
  const before = process.listenerCount('SIGINT');
  assert.equal(await runWindows(process.execPath, ['-e', 'process.exit(7)'], { stdio: 'ignore' }), 7);
  assert.equal(process.listenerCount('SIGINT'), before);
  await assert.rejects(runWindows('subc-definitely-missing-executable', []), /Could not find/);
  assert.equal(process.listenerCount('SIGINT'), before);
});

test('Windows Claude launch retains model, subagent, telemetry and picker settings', async () => {
  const launch = await windowsLaunch('claude-code', ['--compact-window', '750000', '--max-context-tokens', '2500000', '--', '--continue'], {
    ...env, GATEWAY_URL: 'https://gateway.example/', CLAUDE_CODE_SUBAGENT_MODEL: 'UNSET', MAX_CONCURRENT_SUBAGENTS: '6', MAX_SUBAGENT_SPAWN_DEPTH: '2', SUBC_CLAUDE_SETTINGS: '{"availableModels":[]}',
  });
  assert.equal(launch.command, 'claude');
  assert.deepEqual(launch.args, ['--settings', '{"availableModels":[]}', '--continue']);
  assert.equal(launch.env.ANTHROPIC_AUTH_TOKEN, 'sk-test');
  assert.equal(launch.env.ANTHROPIC_MODEL, env.MODEL);
  assert.equal(launch.env.CLAUDE_CODE_SUBAGENT_MODEL, env.MODEL);
  assert.equal(launch.env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS, '6');
  assert.equal(launch.env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH, '2');
  assert.equal(launch.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '750000');
  assert.equal(launch.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS, '2500000');
  assert.equal(launch.env.ENABLE_CLAUDEAI_MCP_SERVERS, 'false');
  assert.equal(launch.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT, 'https://gateway.example/v1/logs');
  const equals = await windowsLaunch('claude-code', ['--api-key=override', '--compact-window=123456', '--', '--model', 'agent-model'], env);
  assert.equal(equals.env.ANTHROPIC_AUTH_TOKEN, 'override');
  assert.equal(equals.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '123456');
  assert.deepEqual(equals.args.slice(-2), ['--model', 'agent-model']);
});

test('Codex uses a temporary catalog, native argv and opt-in external tools/subagents', async t => {
  const root = await temporary(t);
  const spec = await windowsLaunch('codex', ['--subagents', '--context-window=2000000', '--reasoning-effort', 'high', '--', 'exec', 'hello & goodbye'], { ...env, CODEX_AUTO_COMPACT_TOKEN_LIMIT: '1800000', MAX_CONCURRENT_SUBAGENTS: '7' }, { tempRoot: root });
  assert.equal(spec.command, 'npx');
  assert.deepEqual(spec.args.slice(0, 2), ['-y', '@openai/codex@0.132.0']);
  assert.ok(spec.args.includes('agents.max_threads=7'));
  assert.ok(spec.args.includes('features.apps=false'));
  assert.ok(spec.args.includes('model_reasoning_effort="high"'));
  assert.deepEqual(spec.args.slice(-2), ['exec', 'hello & goodbye']);
  const catalogPath = JSON.parse(spec.args.find(arg => arg.startsWith('model_catalog_json=')).split('=').slice(1).join('='));
  const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
  assert.equal(catalog.models.length, 2);
  assert.equal(catalog.models[0].context_window, 2000000);
  assert.equal(catalog.models[0].auto_compact_token_limit, 1800000);
  assert.equal(spec.env.SUBCONSCIOUS_API_KEY, 'sk-test');
  assert.equal(await executeWindowsLaunch(spec, async () => 19), 19);
  await assert.rejects(fs.access(catalogPath));
  const external = await windowsLaunch('codex', ['--external-tools'], env, { tempRoot: root });
  assert.ok(!external.args.includes('features.apps=false'));
  await assert.rejects(executeWindowsLaunch(external, async () => { throw new Error('launch failed'); }), /launch failed/);
  assert.deepEqual(await fs.readdir(root), []);
});

test('invalid Codex flags cannot leave temp files', async t => {
  const root = await temporary(t);
  await assert.rejects(windowsLaunch('codex', ['--context-window', '-5'], env, { tempRoot: root }), /positive integer/);
  await assert.rejects(windowsLaunch('codex', ['--reasoning-effort', 'impossible'], env, { tempRoot: root }), /reasoning-effort/);
  assert.deepEqual(await fs.readdir(root), []);
  assert.throws(() => parseOptions(['--subagents=false'], { '--subagents': true }), /does not take a value/);
});

test('OpenCode, Pi and sc have independent native launch specifications', async () => {
  const oc = await windowsLaunch('opencode', ['--', '--continue'], { ...env, OPENCODE_CONTEXT_LIMIT: '123456', OPENCODE_OUTPUT_LIMIT: '7890' });
  const config = JSON.parse(oc.env.OPENCODE_CONFIG_CONTENT);
  assert.equal(config.provider['subconscious-cli'].options.baseURL, 'https://gateway.example/v1');
  assert.equal(config.provider['subconscious-cli'].options.apiKey, '{env:SUBCONSCIOUS_API_KEY}');
  assert.deepEqual(Object.keys(config.provider['subconscious-cli'].models), [env.MODEL, 'custom/model']);
  assert.ok(!oc.env.OPENCODE_CONFIG_CONTENT.includes('sk-test'));
  assert.deepEqual(config.provider['subconscious-cli'].models[env.MODEL].limit, { context: 123456, output: 7890 });
  assert.deepEqual(oc.args, ['--continue']);
  assert.deepEqual((await windowsLaunch('pi', ['--continue'], env)).args, ['--provider', 'subconscious', '--model', env.MODEL, '--continue']);
  const sc = await windowsLaunch('subconscious-code', ['--prompt', 'x & y'], env);
  assert.equal(sc.command, 'marathon');
  assert.equal(sc.env.SC_BASE_URL, 'https://gateway.example/v1');
  assert.equal(sc.env.SC_DLR_URL, 'https://gateway.example');
  assert.deepEqual(sc.args, ['--prompt', 'x & y']);
});

test('DeepSeek overlay is ephemeral, has no API key, and supports headless argv', async t => {
  const root = await temporary(t);
  const spec = await windowsLaunch('deepseek-harness', ['headless', 'hello\nworld'], { ...env, DEEPSEEK_HARNESS_CONTEXT_WINDOW: '123456', DEEPSEEK_HARNESS_MAX_TOKENS: '6543' }, { tempRoot: root });
  assert.deepEqual(spec.args.slice(0, 3), ['--profile', 'headless', '--patch']);
  const overlay = await fs.readFile(spec.args[3], 'utf8');
  assert.match(overlay, /contextWindow: 123456/);
  assert.match(overlay, /maxTokens: 6543/);
  assert.doesNotMatch(overlay, /sk-test/);
  assert.equal(spec.env.SUBCONSCIOUS_DSH_BASE_URL, 'https://gateway.example/v1');
  await executeWindowsLaunch(spec, async () => 0);
  assert.deepEqual(await fs.readdir(root), []);
});

for (const client of ['codex', 'cursor', 'copilot']) test(`${client} hooks merge idempotently and remove only owned entries`, () => {
  const custom = { matcher: 'keep', extra: true, hooks: [{ type: 'command', command: 'custom-script.exe' }, { type: 'command', command: 'bash subconscious-hook.sh' }] };
  const original = { extra: { keep: true }, hooks: { PreCompact: [custom] } };
  const command = windowsHookCommand(client, 'C:\\User & %name%\\hook.cjs', 'C:\\config.json');
  const merged = mergeHooks(original, client, command);
  assert.deepEqual(mergeHooks(merged, client, command), merged);
  const removed = mergeHooks(merged, client, null);
  assert.deepEqual(removed.hooks.PreCompact, [{ ...custom, hooks: [custom.hooks[0]] }]);
  assert.deepEqual(removed.extra, { keep: true });
  assert.equal(original.hooks.PreCompact[0].hooks.length, 2);
  assert.doesNotMatch(command, /%name%|C:\\/);
});

test('malformed hook configuration is rejected without overwriting any file', async t => {
  const home = await temporary(t);
  const file = path.join(home, '.codex', 'hooks.json');
  await writeJson(file, { hooks: { PreCompact: 'invalid' } });
  const before = await fs.readFile(file, 'utf8');
  await assert.rejects(windowsSetup('codex', 'install', [], env, { home, log: quiet }), /must be an array/);
  assert.equal(await fs.readFile(file, 'utf8'), before);
  await assert.rejects(fs.access(path.join(home, '.codex', 'subconscious-windows.json')));
  await fs.writeFile(file, '{ malformed');
  await assert.rejects(windowsSetup('codex', 'uninstall', [], {}, { home, log: quiet }), /leaving it unchanged/);
  assert.equal(await fs.readFile(file, 'utf8'), '{ malformed');
});

for (const client of ['codex', 'cursor', 'copilot', 'pi']) test(`${client} Windows setup survives install/status/reinstall/uninstall`, async t => {
  const home = await temporary(t);
  const appData = path.join(home, 'AppData', 'Roaming');
  const options = { home, log: quiet };
  const environment = { ...env, APPDATA: appData };
  const providerFile = client === 'pi' ? path.join(home, '.pi', 'agent', 'models.json') : path.join(appData, 'Code', 'User', 'chatLanguageModels.json');
  if (client === 'pi') await writeJson(providerFile, { extra: true, providers: { existing: { apiKey: 'keep' } } });
  if (client === 'copilot') await writeJson(providerFile, [{ name: 'Existing', models: [] }]);
  assert.equal(await windowsSetup(client, 'install', [], environment, options), 0);
  assert.equal(await windowsSetup(client, 'install', [], environment, options), 0);
  let status = '';
  await windowsSetup(client, 'status', [], { APPDATA: appData }, { home, log: line => { status += line; } });
  assert.match(status, /installed/);
  if (client === 'copilot') {
    const providers = JSON.parse(await fs.readFile(providerFile, 'utf8'));
    assert.equal(providers.length, 2);
    assert.equal(providers[1].models[0].url, 'https://gateway.example/v1/messages');
    assert.equal(providers[1].apiKey, '${input:chat.lm.secret.subconscious-gateway}');
    assert.ok(!(await fs.readFile(providerFile, 'utf8')).includes('sk-test'));
  }
  await windowsSetup(client, 'uninstall', [], { APPDATA: appData }, options);
  await windowsSetup(client, 'uninstall', [], { APPDATA: appData }, options);
  if (client === 'copilot') assert.deepEqual(JSON.parse(await fs.readFile(providerFile, 'utf8')), [{ name: 'Existing', models: [] }]);
  if (client === 'pi') assert.deepEqual(JSON.parse(await fs.readFile(providerFile, 'utf8')), { extra: true, providers: { existing: { apiKey: 'keep' } } });
});

test('Copilot uses Roaming AppData and validates app and token options before writing', async t => {
  const home = await temporary(t);
  const appData = path.join(home, 'Roaming');
  const options = { home, log: quiet };
  const environment = { ...env, APPDATA: appData };
  await assert.rejects(windowsSetup('copilot', 'install', ['--vscode-app', '..'], environment, options), /--vscode-app/);
  await assert.rejects(windowsSetup('copilot', 'install', ['--max-input-tokens', '0'], environment, options), /positive integer/);
  assert.deepEqual(await fs.readdir(home), []);
  await windowsSetup('copilot', 'install', ['--vscode-app', 'Code - Insiders', '--max-input-tokens', '900000'], environment, options);
  const file = path.join(appData, 'Code - Insiders', 'User', 'chatLanguageModels.json');
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8'))[0].models[0].maxInputTokens, 900000);
});

test('legacy cleanup is auth-free and preserves unrelated OpenCode providers and Claude settings', async t => {
  const home = await temporary(t);
  const claude = path.join(home, '.claude');
  const opencode = path.join(home, '.opencode');
  await writeJson(path.join(claude, 'settings.json'), { theme: 'dark' });
  await fs.writeFile(path.join(claude, 'subconscious-gateway.env'), 'secret');
  await writeJson(path.join(opencode, 'opencode.json'), { provider: { subconscious: {}, other: { keep: true } }, model: 'subconscious/old', theme: 'dark' });
  await fs.writeFile(path.join(opencode, 'subconscious.env'), 'secret');
  await windowsSetup('claude-code', 'uninstall', [], {}, { home, log: quiet });
  await windowsSetup('opencode', 'uninstall', [], {}, { home, log: quiet });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(opencode, 'opencode.json'), 'utf8')), { provider: { other: { keep: true } }, theme: 'dark' });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(claude, 'settings.json'), 'utf8')), { theme: 'dark' });
  await assert.rejects(fs.access(path.join(opencode, 'subconscious.env')));
  await assert.rejects(fs.access(path.join(claude, 'subconscious-gateway.env')));
});

test('Windows hooks report prompt and compaction events without Bash, jq or curl', async t => {
  const home = await temporary(t);
  const requests = [];
  const base = await gateway(t, (req, res) => {
    let text = '';
    req.on('data', chunk => { text += chunk; });
    req.on('end', () => { requests.push({ body: JSON.parse(text), headers: req.headers }); res.end('{}'); });
  });
  const config = path.join(home, 'config.json');
  await writeJson(config, { apiKey: 'sk-test', gatewayUrl: base });
  const emit = async (client, payload) => {
    const result = await child(process.execPath, [hook, client, config], {}, JSON.stringify(payload));
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, '');
    return JSON.parse(result.stdout);
  };
  assert.deepEqual(await emit('cursor', { hook_event_name: 'beforeSubmitPrompt', conversation_id: 'c1', prompt: 'hello & %PATH%', workspace_roots: ['C:\\My Projects\\project'] }), { continue: true, permission: 'allow' });
  assert.deepEqual(await emit('cursor', { hook_event_name: 'preCompact', conversation_id: 'c1', generation_id: 'g1', context_tokens: 500, is_first_compaction: true }), {});
  await emit('codex', { hook_event_name: 'PreCompact', session_id: 'c2', turn_id: 't1', trigger: 'auto' });
  await emit('codex', { hook_event_name: 'PostCompact', session_id: 'c2', turn_id: 't1' });
  await emit('copilot', { hook_event_name: 'PreCompact', session_id: '../../unsafe?session' });
  assert.deepEqual(await emit('copilot', { hook_event_name: 'UserPromptSubmit', session_id: '../../unsafe?session', prompt: 'next', cwd: 'C:\\Project' }), { continue: true });
  assert.deepEqual(requests.map(r => r.body.phase || r.body.event), ['conversation_ensure', 'point', 'start', 'end', 'start', 'conversation_ensure', 'end']);
  assert.equal(requests[0].body.workspace, 'project');
  assert.equal(requests[1].body.dedupe_key, 'c1:g1:true');
  assert.equal(requests[2].headers['x-subconscious-client'], 'codex');
  assert.ok(requests.every(r => r.headers.authorization === 'Bearer sk-test'));
  assert.deepEqual(await fs.readdir(path.join(home, 'subconscious-compact-pending')), []);
});

test('hooks fail open for malformed input, missing credentials, and offline gateways', async t => {
  const home = await temporary(t);
  const config = path.join(home, 'config.json');
  const missing = await child(process.execPath, [hook, 'cursor', config], {}, 'not JSON');
  assert.equal(missing.code, 0);
  assert.deepEqual(JSON.parse(missing.stdout), { continue: true, permission: 'allow' });
  await writeJson(config, { gatewayUrl: 'http://127.0.0.1:1', apiKey: 'sk-secret' });
  const offline = await child(process.execPath, [hook, 'copilot', config], {}, JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: 'private' }));
  assert.equal(offline.code, 0);
  assert.deepEqual(JSON.parse(offline.stdout), { continue: true });
  assert.doesNotMatch(offline.stdout + offline.stderr, /sk-secret|private/);
});

test('hook gateway timeouts are bounded and permissive', async t => {
  const home = await temporary(t);
  const base = await gateway(t, () => {});
  const config = path.join(home, 'config.json');
  await writeJson(config, { gatewayUrl: base, apiKey: 'sk-test' });
  const started = Date.now();
  const result = await child(process.execPath, [hook, 'codex', config], {}, '{"hook_event_name":"PreCompact","session_id":"s"}');
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), {});
  assert.ok(Date.now() - started < 5000);
});

test('Windows installers never select Unix commands and check upstream asset support', () => {
  for (const id of ['claude-code', 'codex', 'opencode', 'deepseek-harness']) {
    const spec = windowsInstallSpec(id, {});
    assert.doesNotMatch(spec.command, /bash|curl/);
    if (id === 'claude-code') assert.equal(spec.fallback.command, 'npm');
  }
  assert.equal(windowsInstallSpec('pi'), null);
  assert.throws(() => windowsReleaseAsset({ tag_name: 'v1', assets: [] }, 'x64'), /no published native Windows/);
  const asset = { name: 'sc-aarch64-pc-windows-msvc.zip' };
  assert.throws(() => windowsReleaseAsset({ assets: [asset] }, 'arm64'), /missing.*sha256/);
  assert.deepEqual(windowsReleaseAsset({ assets: [asset, { name: asset.name + '.sha256' }] }, 'arm64').asset, asset);
  const marathon = { name: 'marathon-aarch64-pc-windows-msvc.zip' };
  const assets = [asset, { name: asset.name + '.sha256' }, marathon, { name: marathon.name + '.sha256' }];
  assert.equal(windowsReleaseAsset({ assets }, 'arm64').asset, marathon);
  assert.throws(() => windowsReleaseAsset({ assets: assets.slice(0, -1) }, 'arm64'), /missing.*sha256/);
});

test('Subconscious Code verifies downloads and preserves an existing binary on failure', async t => {
  const home = await temporary(t);
  const bin = path.join(home, 'bin');
  const releaseUrl = 'https://github.com/subconscious-systems/subconscious-code/releases/download/v1/';
  const name = 'sc-x86_64-pc-windows-msvc.exe';
  const binary = Buffer.from('MZ-test-executable');
  let checksum = createHash('sha256').update(binary).digest('hex');
  const fetchImpl = async url => {
    if (url.startsWith('https://api.github.com/')) return { ok: true, json: async () => ({ tag_name: 'v1', assets: [name, name + '.sha256'].map(name => ({ name, browser_download_url: releaseUrl + name })) }) };
    const bytes = url.endsWith('.sha256') ? Buffer.from(checksum) : binary;
    return { ok: true, arrayBuffer: async () => bytes };
  };
  await installWindowsSC({ SC_INSTALL_DIR: bin }, { home, arch: 'x64', fetchImpl, log: quiet });
  assert.deepEqual(await fs.readFile(path.join(bin, 'marathon.exe')), binary);
  checksum = '0'.repeat(64);
  await assert.rejects(installWindowsSC({ SC_INSTALL_DIR: bin }, { home, arch: 'x64', fetchImpl, log: quiet }), /checksum/);
  assert.deepEqual(await fs.readFile(path.join(bin, 'marathon.exe')), binary);
  assert.deepEqual(await fs.readdir(bin), ['marathon.exe']);
});

test('Windows upgrades retain the global npm prefix and the TUI chooses .exe', () => {
  const target = detectInstallTarget('C:\\Users\\First Last\\AppData\\Roaming\\npm\\node_modules\\subconscious-cli\\bin\\update-check.js', 'win32');
  assert.equal(target.prefix, 'C:/Users/First Last/AppData/Roaming/npm');
  assert.ok(target.args.includes(target.prefix));
  assert.match(target.display, /--prefix "C:\/Users\/First Last/);
  assert.equal(nativeTargetName('win32', 'x64'), 'subc-tui-windows-amd64.exe');
  assert.equal(nativeTargetName('win32', 'arm64'), 'subc-tui-windows-arm64.exe');
});

test('Windows host: real npm/npx shims and PowerShell hook argv run natively', { skip: !isWindows }, async t => {
  assert.equal(await runWindows('npm', ['--version'], { stdio: 'ignore' }), 0);
  assert.equal(await runWindows('npx', ['--version'], { stdio: 'ignore' }), 0);
  const home = await temporary(t);
  const dir = path.join(home, 'space & %PATH%');
  await fs.mkdir(dir);
  const script = path.join(dir, 'subconscious-hook.cjs');
  const config = path.join(dir, 'config.json');
  await fs.copyFile(hook, script);
  await writeJson(config, {});
  const command = windowsHookCommand('cursor', script, config);
  const [program, ...args] = command.split(' ');
  const result = await child(program, args, {}, '{}');
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { continue: true, permission: 'allow' });
});

test('Windows host: ZIP extraction updates Marathon, preserves sc.exe, and rejects a missing root', { skip: !isWindows }, async t => {
  const home = await temporary(t);
  const bin = path.join(home, 'install with spaces & %PATH%');
  await fs.mkdir(bin);
  const target = path.join(bin, 'marathon.exe');
  await fs.writeFile(target, 'previous executable');
  await fs.writeFile(path.join(bin, 'sc.exe'), 'do not touch service control');
  const archive = path.join(home, 'release.zip');
  const source = path.join(home, 'source.exe');
  const binary = Buffer.from('MZ-verified-zip-fixture');
  await fs.writeFile(source, binary);
  let name = 'marathon-x86_64-pc-windows-msvc.zip';
  const releaseUrl = 'https://github.com/subconscious-systems/subconscious-code/releases/download/v1/';
  const makeArchive = async rootName => {
    await fs.rm(archive, { force: true });
    const spec = powershellCommand("$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $z = [IO.Compression.ZipFile]::Open($env:SUBC_TEST_ARCHIVE, 'Create'); try { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, $env:SUBC_TEST_SOURCE, $env:SUBC_TEST_ENTRY) | Out-Null; [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, $env:SUBC_TEST_SOURCE, '../outside.exe') | Out-Null } finally { $z.Dispose() }", { ...process.env, SUBC_TEST_ARCHIVE: archive, SUBC_TEST_SOURCE: source, SUBC_TEST_ENTRY: rootName });
    assert.equal(await runWindows(spec.command, spec.args, { env: spec.env, stdio: 'ignore' }), 0);
    const bytes = await fs.readFile(archive);
    return async url => {
      if (url.startsWith('https://api.github.com/')) return { ok: true, json: async () => ({ tag_name: 'v1', assets: [name, name + '.sha256'].map(name => ({ name, browser_download_url: releaseUrl + name })) }) };
      return { ok: true, arrayBuffer: async () => url.endsWith('.sha256') ? Buffer.from(createHash('sha256').update(bytes).digest('hex')) : bytes };
    };
  };
  const environment = { ...process.env, SC_INSTALL_DIR: bin };
  await installWindowsSC(environment, { home, arch: 'x64', fetchImpl: await makeArchive('marathon.exe'), log: quiet });
  assert.deepEqual(await fs.readFile(target), binary);
  await assert.rejects(fs.access(path.join(home, 'outside.exe')));
  await assert.rejects(installWindowsSC(environment, { home, arch: 'x64', fetchImpl: await makeArchive('nested/marathon.exe'), log: quiet }), /extract/);
  assert.deepEqual(await fs.readFile(target), binary);
  name = 'sc-x86_64-pc-windows-msvc.zip';
  await installWindowsSC(environment, { home, arch: 'x64', fetchImpl: await makeArchive('sc.exe'), log: quiet });
  assert.deepEqual(await fs.readFile(target), binary);
  assert.equal(await fs.readFile(path.join(bin, 'sc.exe'), 'utf8'), 'do not touch service control');
  assert.deepEqual((await fs.readdir(bin)).sort(), ['marathon.exe', 'sc.exe']);
});

test('Windows host: CLI routes every agent with a Bash-free PATH and preserves exit codes', { skip: !isWindows }, async t => {
  const home = await temporary(t);
  const bin = path.join(home, 'bin');
  await fs.mkdir(bin);
  const record = path.join(home, 'launch.json');
  const script = path.join(bin, 'agent.cjs');
  await fs.writeFile(script, `require('node:fs').writeFileSync(process.env.SUBC_TEST_RECORD, JSON.stringify({ args: process.argv.slice(2), model: process.env.MODEL, key: process.env.SUBCONSCIOUS_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN })); process.exit(17);`);
  for (const name of ['claude', 'codex', 'opencode', 'pi', 'dsh', 'marathon']) await fs.writeFile(path.join(bin, name + '.cmd'), '@ECHO off\nSET dp0=%~dp0\n"%dp0%\\node.exe" "%dp0%\\agent.cjs" %*\n');
  await fs.writeFile(path.join(bin, 'sc.cmd'), '@ECHO off\necho SERVICE_CONTROL_MUST_NOT_RUN\nexit /b 99\n');
  const base = await gateway(t, (req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ id: env.MODEL }] })); });
  const environment = windowsEnv(process.env, {
    USERPROFILE: home, HOME: home, APPDATA: path.join(home, 'Roaming'), LOCALAPPDATA: path.join(home, 'Local'),
    SUBC_CONFIG_DIR: path.join(home, '.subconscious'), SC_INSTALL_DIR: bin, CODEX_DIR: path.join(home, '.codex'),
    PATH: `${bin};${path.dirname(process.execPath)}`, SUBC_DISABLE_UPDATE_CHECK: '1',
    SUBCONSCIOUS_API_KEY: 'sk-test', SUBCONSCIOUS_BASE_URL: base, SUBCONSCIOUS_MODEL: env.MODEL,
    SUBC_TEST_RECORD: record, CODEX_HOME: path.join(home, '.codex'), PI_CODING_AGENT_DIR: path.join(home, '.pi', 'agent'),
  });
  for (const name of ['claude', 'codex', 'opencode', 'pi', 'dsh', 'marathon', 'sc', 'subconscious-code']) {
    const prompt = 'say "hello" & %PATH%\nnext line';
    const result = await child(process.execPath, [cli, name, '--', prompt], { env: environment });
    assert.equal(result.code, 17, `${name}: ${result.stderr}\n${result.stdout}`);
    const captured = JSON.parse(await fs.readFile(record, 'utf8'));
    assert.ok(captured.args.includes(prompt), name);
    assert.equal(captured.model, env.MODEL);
    assert.equal(captured.key, 'sk-test');
    assert.doesNotMatch(result.stderr, /require.*bash/i);
    assert.doesNotMatch(result.stdout, /SERVICE_CONTROL_MUST_NOT_RUN/);
  }
  await fs.rm(path.join(bin, 'marathon.cmd'));
  for (const name of ['marathon', 'sc']) {
    const result = await child(process.execPath, [cli, name, '--version'], { env: environment });
    assert.equal(result.code, 127, `${name}: ${result.stderr}\n${result.stdout}`);
    assert.doesNotMatch(result.stdout, /SERVICE_CONTROL_MUST_NOT_RUN/);
  }
  for (const name of ['cursor', 'copilot', 'pi', 'codex']) {
    const result = await child(process.execPath, [cli, name, 'install'], { env: environment });
    assert.equal(result.code, 0, `${name}: ${result.stderr}`);
  }
  for (const command of [['--version'], ['help'], ['config', 'list'], ['whoami'], ['codex', 'status'], ['cursor', 'uninstall'], ['copilot', 'uninstall'], ['pi', 'uninstall']]) {
    const result = await child(process.execPath, [cli, ...command], { env: environment });
    assert.equal(result.code, 0, `${command}: ${result.stderr}`);
  }
});
