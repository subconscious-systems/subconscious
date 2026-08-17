#!/usr/bin/env node

/**
 * Subconscious CLI — log in, then launch coding agents on your hosted models.
 *
 *   subc login | update-key | logout | whoami — manage your API key
 *   subc <agent> [...args]            — launch or configure a coding agent
 *
 * Auth lives in ./auth.js, the agent launcher + registry in ./agents.js.
 */

import fs from 'node:fs/promises';
import { c } from './colors.js';
import { renderBanner } from './branding.js';
import {
  loginCommand,
  logoutCommand,
  updateApiKeyCommand,
  whoamiCommand,
} from './auth.js';
import {
  resolveAgent,
  runAgent,
  agentList,
  agentCommandName,
  isAgentHelpRequest,
  parseAgentAction,
} from './agents.js';
import {
  configCommand,
  DEFAULT_PROFILE,
  loadProfile,
  modelsCommand,
  printConfigHelp,
  updateUrlCommand,
  validateProfileName,
} from './profiles.js';

function isHelpArg(arg) {
  return arg === 'help' || arg === '-h' || arg === '--help';
}

function printHelp() {
  const agents = agentList()
    .map(({ name, alias, action }) => `    ${c.cyan}${alias.padEnd(13)}${c.reset}${c.dim}${action} ${name}${c.reset}`)
    .join('\n');

  console.log(`${renderBanner()}

  ${c.bold}Usage${c.reset}
    ${c.cyan}subc${c.reset} <command> [...args]
    ${c.cyan}subc${c.reset} <command> help

  ${c.bold}Auth${c.reset}
    ${c.cyan}login${c.reset}        Authenticate and save your API key
    ${c.cyan}update-key${c.reset}   Replace the selected profile's API key
    ${c.cyan}update-url${c.reset}   Update the active profile's gateway URL automatically
    ${c.cyan}logout${c.reset}       Remove saved credentials
    ${c.cyan}whoami${c.reset}       Show current authentication status

  ${c.bold}Profiles${c.reset}
    ${c.cyan}config${c.reset}       List profiles, or show/edit one with ${c.dim}-p${c.reset}
    ${c.cyan}models${c.reset}       List available Subconscious models

  ${c.bold}Coding agents${c.reset}
${agents}

  ${c.bold}Options${c.reset}
    ${c.dim}--model <id>${c.reset}   Model to use (default subconscious/glm-5.2)
    ${c.dim}-p, --profile${c.reset}  Select a profile (default: default)
    ${c.dim}-h, --help${c.reset}     Show this help
    ${c.dim}-v, --version${c.reset}  Show version

  ${c.bold}Examples${c.reset}
    ${c.dim}$${c.reset} subc login
    ${c.dim}$${c.reset} subc config
    ${c.dim}$${c.reset} subc config help
    ${c.dim}$${c.reset} subc -p staging config
    ${c.dim}$${c.reset} subc config edit vim
    ${c.dim}$${c.reset} subc claude
    ${c.dim}$${c.reset} subc claude help
    ${c.dim}$${c.reset} subc cursor install
    ${c.dim}$${c.reset} subc cursor uninstall
    ${c.dim}$${c.reset} subc pi install
    ${c.dim}$${c.reset} subc -p staging codex

  ${c.dim}Use subc <command> help for command-specific usage.${c.reset}
`);
}

const COMMAND_HELP = {
  login: `
Usage:
  subc login
  subc -p NAME login
  subc login help

Authenticate and save an API key to the selected profile.
`,
  logout: `
Usage:
  subc logout
  subc -p NAME logout
  subc logout help

Remove the selected profile's saved API key. Non-secret settings are kept.
`,
  whoami: `
Usage:
  subc whoami
  subc -p NAME whoami
  subc whoami help

Show the current authentication status for the selected profile.
`,
  'update-key': `
Usage:
  subc update-key <api-key>
  subc -p NAME update-key <api-key>
  subc update-key help

Replace the selected profile's shared API key.
`,
  'update-url': `
Usage:
  subc update-url <gateway-url>
  subc update-url help

Update the active profile's gateway URL.
`,
  models: `
Usage:
  subc models
  subc models help

List available Subconscious models.
`,
};

function printRetiredSetup(args = []) {
  const maybeAgent = resolveAgent(args[0]);
  const command = maybeAgent ? agentCommandName(maybeAgent) : 'cursor';
  console.error(`
  ${c.red}subc setup is no longer used.${c.reset} Use the agent command instead:

    ${c.cyan}subc ${command} install${c.reset}
    ${c.cyan}subc ${command} uninstall${c.reset}
    ${c.cyan}subc ${command} help${c.reset}
`);
}

function printRetiredSettings() {
  console.error(`
  ${c.red}subc settings is no longer used.${c.reset} Use:

    ${c.cyan}subc config${c.reset}                 List profiles
    ${c.cyan}subc -p NAME config${c.reset}         Show a profile
    ${c.cyan}subc -p NAME config edit${c.reset}    Open the profile env file
    ${c.cyan}subc config help${c.reset}
`);
}

const authCommands = {
  login: loginCommand,
  'update-key': updateApiKeyCommand,
  logout: logoutCommand,
  whoami: whoamiCommand,
};

function extractProfile(argv) {
  let profileName =
    process.env.SUBC_PROFILE?.trim() ||
    process.env.MBTA_PROFILE?.trim() ||
    DEFAULT_PROFILE;
  let profileExplicit = false;
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      args.push(...argv.slice(i));
      break;
    }
    if (arg === '--profile' || arg === '-p') {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a profile name`);
      profileName = value;
      profileExplicit = true;
      continue;
    }
    if (arg.startsWith('--profile=')) {
      profileName = arg.slice('--profile='.length);
      profileExplicit = true;
      continue;
    }
    args.push(arg);
  }
  validateProfileName(profileName);
  return { args, profileName, profileExplicit };
}

function requireNamedProfile(profile) {
  if (profile.name !== DEFAULT_PROFILE && !profile.exists) {
    throw new Error(
      `Profile '${profile.name}' does not exist. Create it with ` +
        `subc -p ${profile.name} config --api-key KEY`,
    );
  }
}

async function main() {
  const parsed = extractProfile(process.argv.slice(2));
  const { args, profileName, profileExplicit } = parsed;
  const command = args[0];

  if (!command || command === '--help' || command === '-h' || (command === 'help' && !args[1])) {
    printHelp();
    return;
  }

  if (command === 'help') {
    if (!args[1] || isHelpArg(args[1])) {
      printHelp();
      return;
    }
    const agent = resolveAgent(args[1]);
    if (!agent) throw new Error(`Unknown coding agent: ${args[1]}`);
    const profile = await loadProfile(profileName);
    await runAgent(agent, ['help'], { profile });
    return;
  }

  if (command === '--version' || command === '-v') {
    const pkgPath = new URL('../package.json', import.meta.url);
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
    console.log(pkg.version);
    return;
  }

  if (command === 'setup') {
    printRetiredSetup(args.slice(1));
    process.exitCode = 1;
    return;
  }

  if (command === 'settings') {
    printRetiredSettings();
    process.exitCode = 1;
    return;
  }

  const authHandler = authCommands[command];
  if (authHandler) {
    if (isHelpArg(args[1])) {
      console.log(COMMAND_HELP[command]);
      return;
    }
    const profile = await loadProfile(profileName);
    await authHandler(args.slice(1), { profile, profileName });
    return;
  }

  if (command === 'config') {
    if (isHelpArg(args[1])) {
      printConfigHelp();
      return;
    }
    await configCommand(args.slice(1), profileName, { profileExplicit });
    return;
  }

  if (command === 'models') {
    if (isHelpArg(args[1])) {
      console.log(COMMAND_HELP.models);
      return;
    }
    modelsCommand();
    return;
  }

  if (command === 'update-url') {
    if (isHelpArg(args[1])) {
      console.log(COMMAND_HELP['update-url']);
      return;
    }
    await updateUrlCommand(args.slice(1), { profileName });
    return;
  }

  const agent = resolveAgent(command);
  if (agent) {
    const agentArgs = args.slice(1);
    const profile = await loadProfile(profileName);
    if (!isAgentHelpRequest(agentArgs)) {
      const action = parseAgentAction(agent, agentArgs);
      if (action.action !== 'status' && action.action !== 'uninstall') {
        requireNamedProfile(profile);
      }
    }
    await runAgent(agent, agentArgs, { profile });
    return;
  }

  console.error(`\n  ${c.red}Unknown command: ${command}${c.reset}`);
  printHelp();
  process.exit(1);
}

main().catch((error) => {
  console.error(`${c.red}${error.message}${c.reset}`);
  process.exit(1);
});
