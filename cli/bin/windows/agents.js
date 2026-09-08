import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { windowsEnv, windowsBinDirs, windowsPath, resolveWindowsExecutable, readWindowsVersion, runWindows } from './process.js';
import { windowsInstallSpec, installWindowsAgent } from './install.js';
import { windowsSetup } from './setup.js';
import { windowsLaunch, executeWindowsLaunch } from './launch.js';
import { parseOptions } from './common.js';

const askInstall = name => new Promise(resolve => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(`  ${name} isn't installed. Install it now? [Y/n] `, answer => { rl.close(); resolve(['', 'y', 'yes'].includes(answer.trim().toLowerCase())); });
});

export async function runWindowsAgent(agent, argv, dependencies) {
  const { profile, parseAgentAction, extractModel, requireApiKey, resolvedModelsForLaunch, selectLaunchModel, runbookEnv } = dependencies;
  const parsed = parseAgentAction(agent, argv);
  let args = parsed.action !== 'launch' && parsed.action === argv[0] ? argv.slice(1) : argv;
  const environment = windowsEnv(profile?.values, process.env);
  const preferredDirs = agent.runbook?.installDir
    ? [path.resolve(environment[agent.runbook.installDirEnv] || path.join(os.homedir(), agent.runbook.installDir))] : [];
  environment.PATH = windowsPath([...preferredDirs, ...(environment.PATH || '').split(';'), ...windowsBinDirs(environment)]);
  if (agent.id === 'subconscious-code' && parsed.action === 'install') {
    if (args.length) throw new Error('Usage: subc sc install');
    return finish(await installWindowsAgent(agent.id, environment));
  }
  if (['status', 'uninstall'].includes(parsed.action)) {
    return finish(await windowsSetup(agent.id, parsed.action, args, environment));
  }

  // Honor -- after which all arguments belong to the underlying agent.
  const boundary = args.indexOf('--');
  const tail = boundary < 0 ? [] : args.slice(boundary);
  const extracted = extractModel(boundary < 0 ? args : args.slice(0, boundary), profile);
  args = [...extracted.rest, ...tail];
  let explicit = {};
  if (parsed.action === 'install' || agent.id === 'claude-code') {
    const handled = parseOptions(boundary < 0 ? args : args.slice(0, args.indexOf('--')), { '--api-key': 1, '--gateway-url': 1 });
    explicit = handled.options;
  }
  const key = explicit['--api-key'] || await requireApiKey(profile, agent);
  if (!key) return finish(1);
  const catalogProfile = explicit['--gateway-url'] ? { ...profile, values: { ...profile?.values, GATEWAY_URL: explicit['--gateway-url'] } } : profile;
  const catalog = await resolvedModelsForLaunch(catalogProfile, key, extracted.model);
  const model = selectLaunchModel(extracted.model, extracted.modelSource, catalog);
  if (extracted.model && model !== extracted.model) console.error(`Configured model ${extracted.model} is not in the live catalog; using ${model}.`);
  let executable;
  if (parsed.action === 'launch') {
    executable = resolveWindowsExecutable(agent.bin, { env: environment, preferredDirs });
    if (!executable) {
      const installer = windowsInstallSpec(agent.id, environment);
      if (!installer || !process.stdin.isTTY || !process.stdout.isTTY || !await askInstall(agent.name)) {
        console.error(`${agent.name} isn't installed. ${installer ? `Install it with: ${installer.display}` : 'Install it separately, then rerun subc.'}`);
        return finish(127);
      }
      const installed = await installWindowsAgent(agent.id, environment);
      if (installed) return finish(installed);
      executable = resolveWindowsExecutable(agent.bin, { env: environment, preferredDirs });
      if (!executable) {
        console.error(`Installed ${agent.name}, but ${agent.bin} was not found. Add its installation directory to PATH or restart your terminal.`);
        return finish(127);
      }
    }
    if (agent.id === 'claude-code') {
      const version = dependencies.parseClaudeVersion(readWindowsVersion(executable, environment));
      if (dependencies.claudeVersionNeedsUpgrade(version)) console.error(`Minimum supported Claude Code version is ${dependencies.minimumClaudeVersion}; installed version is ${version}. Please upgrade Claude Code.`);
    }
  }
  // Reuse profile/catalog semantics, but use Windows path and environment rules.
  const env = windowsEnv(runbookEnv(key, model, executable && path.dirname(executable), catalogProfile, agent, catalog.models), { PATH: windowsPath(executable ? [path.dirname(executable)] : [], environment.PATH) });
  if (explicit['--gateway-url']) env.GATEWAY_URL = explicit['--gateway-url'];
  if (parsed.action === 'install') return finish(await windowsSetup(agent.id, 'install', args, env));
  if (agent.id === 'pi') await windowsSetup('pi', 'install', [], env);
  if (agent.id === 'codex') {
    try { await windowsSetup('codex', 'install', [], env, { log: () => {} }); }
    catch (error) { console.error(`Could not refresh Codex hooks (launch will continue): ${error.message}`); }
  }
  const spec = await windowsLaunch(agent.id, args, env);
  if (spec.command === agent.bin) spec.command = executable;
  console.log(`  Launching ${agent.name} on Subconscious (${model})\n`);
  return finish(await executeWindowsLaunch(spec, runWindows));
}

function finish(code) {
  if (code) process.exitCode = code;
  return code;
}
