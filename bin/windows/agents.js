import os from 'node:os';
import path from 'node:path';
import {
  agentBinary,
  agentCommandName,
  agentInstallDirs,
  installAdvice,
} from '../agent-data.js';
import { separatorIndex } from '../headless-args.js';
import { parseOptions } from './common.js';
import { executeWindowsLaunch, windowsLaunch } from './launch.js';
import {
  readWindowsVersion,
  resolveWindowsExecutable,
  runWindows,
  windowsBinDirs,
  windowsEnv,
  windowsPath,
} from './process.js';
import { windowsSetup } from './setup.js';

export async function runWindowsAgent(agent, argv, dependencies) {
  const {
    profile,
    parseAgentAction,
    extractModel,
    requireApiKey,
    resolvedModelsForLaunch,
    selectLaunchModel,
    runbookEnv,
  } = dependencies;
  const parsed = parseAgentAction(agent, argv);
  let args =
    !['launch', 'headless'].includes(parsed.action) && parsed.action === argv[0]
      ? argv.slice(1)
      : argv;
  const environment = windowsEnv(profile?.values, process.env);
  const preferredDirs = agentInstallDirs(agent, environment, os.homedir());
  const bin = agentBinary(agent);
  environment.PATH = windowsPath([
    ...preferredDirs,
    ...(environment.PATH || '').split(';'),
    ...windowsBinDirs(environment),
  ]);
  if (['status', 'uninstall'].includes(parsed.action)) {
    return finish(
      await windowsSetup(agent.id, parsed.action, args, environment),
    );
  }

  // Honor -- after which all arguments belong to the underlying agent.
  const boundary = separatorIndex(args);
  const tail = boundary < 0 ? [] : args.slice(boundary);
  const extracted = extractModel(
    boundary < 0 ? args : args.slice(0, boundary),
    profile,
  );
  args = [...extracted.rest, ...tail];
  let explicit = {};
  if (parsed.action === 'install' || agent.id === 'claude-code') {
    const handled = parseOptions(
      boundary < 0 ? args : args.slice(0, boundary),
      { '--api-key': 1, '--gateway-url': 1 },
    );
    explicit = handled.options;
  }
  const key = explicit['--api-key'] || (await requireApiKey(profile, agent));
  if (!key) return finish(1);
  const catalogProfile = explicit['--gateway-url']
    ? {
        ...profile,
        values: { ...profile?.values, GATEWAY_URL: explicit['--gateway-url'] },
      }
    : profile;
  const catalog = await resolvedModelsForLaunch(
    catalogProfile,
    key,
    extracted.model,
  );
  const model = selectLaunchModel(
    extracted.model,
    extracted.modelSource,
    catalog,
  );
  if (extracted.model && model !== extracted.model)
    console.error(
      `Configured model ${extracted.model} is not in the live catalog; using ${model}.`,
    );
  const headless = dependencies.headless ?? parsed.action === 'headless';
  let executable;
  if (parsed.action === 'launch' || headless) {
    executable = resolveWindowsExecutable(bin, {
      env: environment,
      preferredDirs,
    });
    if (!executable) {
      // subc never installs a third-party agent; it only says how.
      const { command, url } = installAdvice(agent, 'win32');
      console.error(
        `${agent.name} isn't installed. subc doesn't install it. Install it yourself, then rerun subc ${agentCommandName(agent)}.`,
      );
      if (command) console.error(`  Install it with: ${command}`);
      console.error(`  Official install page: ${url}`);
      return finish(127);
    }
    if (agent.id === 'claude-code') {
      const version = dependencies.parseClaudeVersion(
        readWindowsVersion(executable, environment),
      );
      if (dependencies.claudeVersionNeedsUpgrade(version))
        console.error(
          `Minimum supported Claude Code version is ${dependencies.minimumClaudeVersion}; installed version is ${version}. Please upgrade Claude Code.`,
        );
    }
  }
  // Reuse profile/catalog semantics, but use Windows path and environment rules.
  const env = windowsEnv(
    runbookEnv(
      key,
      model,
      executable && path.dirname(executable),
      catalogProfile,
      agent,
      catalog.models,
    ),
    {
      PATH: windowsPath(
        executable ? [path.dirname(executable)] : [],
        environment.PATH,
      ),
    },
  );
  if (explicit['--gateway-url']) env.GATEWAY_URL = explicit['--gateway-url'];
  if (parsed.action === 'install')
    return finish(await windowsSetup(agent.id, 'install', args, env));
  if (agent.id === 'pi') await windowsSetup('pi', 'install', [], env);
  if (agent.id === 'codex') {
    try {
      await windowsSetup('codex', 'install', [], env, { log: () => {} });
    } catch (error) {
      console.error(
        `Could not refresh Codex hooks (launch will continue): ${error.message}`,
      );
    }
  }
  const spec = await windowsLaunch(agent.id, args, env);
  if (spec.command === bin) spec.command = executable;
  // Headless stdout belongs to the agent alone.
  (headless ? console.error : console.log)(
    `  Launching ${agent.name} on Subconscious (${model})\n`,
  );
  return finish(await executeWindowsLaunch(spec, runWindows));
}

function finish(code) {
  if (code) process.exitCode = code;
  return code;
}
