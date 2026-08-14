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
  parseSetupRequest,
  isAgentHelpRequest,
} from './agents.js';
import {
  configCommand,
  DEFAULT_PROFILE,
  loadProfile,
  modelsCommand,
  updateUrlCommand,
  validateProfileName,
} from './profiles.js';

function printHelp() {
  const agents = agentList()
    .map(({ name, alias, action }) => `    ${c.cyan}${alias.padEnd(13)}${c.reset}${c.dim}${action} ${name}${c.reset}`)
    .join('\n');

  console.log(`${renderBanner()}

  ${c.bold}Usage${c.reset}
    ${c.cyan}subc${c.reset} <command> [...args]

  ${c.bold}Auth${c.reset}
    ${c.cyan}login${c.reset}        Authenticate and save your API key
    ${c.cyan}update-key${c.reset}   Replace the selected profile's API key
    ${c.cyan}update-url${c.reset}   Update the active profile's gateway URL automatically
    ${c.cyan}logout${c.reset}       Remove saved credentials
    ${c.cyan}whoami${c.reset}       Show current authentication status

  ${c.bold}Setup and profiles${c.reset}
    ${c.cyan}help <agent>${c.reset}  Show coding-agent integration help and settings
    ${c.cyan}setup${c.reset}        Configure all or one coding-agent integration
    ${c.cyan}config${c.reset}       Show or update the selected runbook profile
    ${c.cyan}settings${c.reset}     Edit profile and per-agent settings interactively
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
    ${c.dim}$${c.reset} subc update-key sk-...
    ${c.dim}$${c.reset} subc update-url https://api.subconscious.dev
    ${c.dim}$${c.reset} subc setup
    ${c.dim}$${c.reset} subc settings
    ${c.dim}$${c.reset} subc models
    ${c.dim}$${c.reset} subc help codex
    ${c.dim}$${c.reset} subc claude
    ${c.dim}$${c.reset} subc --profile staging codex
    ${c.dim}$${c.reset} subc codex --model subconscious/glm-5.2

  ${c.dim}Arguments are forwarded to terminal agents or their runbook setup.${c.reset}
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
      continue;
    }
    if (arg.startsWith('--profile=')) {
      profileName = arg.slice('--profile='.length);
      continue;
    }
    args.push(arg);
  }
  validateProfileName(profileName);
  return { args, profileName };
}

function requireNamedProfile(profile) {
  if (profile.name !== DEFAULT_PROFILE && !profile.exists) {
    throw new Error(
      `Profile '${profile.name}' does not exist. Create it with ` +
        `subc --profile ${profile.name} config --api-key KEY`,
    );
  }
}

async function main() {
  const parsed = extractProfile(process.argv.slice(2));
  const { args, profileName } = parsed;
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'help') {
    if (!args[1]) {
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

  const authHandler = authCommands[command];
  if (authHandler) {
    const profile = await loadProfile(profileName);
    await authHandler(args.slice(1), { profile, profileName });
    return;
  }

  if (command === 'config') {
    await configCommand(args.slice(1), profileName);
    return;
  }

  if (command === 'settings') {
    if (['help', '-h', '--help'].includes(args[1])) {
      console.log(`
Usage:
  subc settings
  subc --profile NAME settings
  subc --profile NAME config interactive

Interactively choose or create a profile, then edit shared or per-agent settings.
`);
      return;
    }
    if (args.length > 1) throw new Error('Usage: subc [--profile NAME] settings');
    await configCommand(['interactive'], profileName);
    return;
  }

  if (command === 'models') {
    modelsCommand();
    return;
  }

  if (command === 'update-url') {
    await updateUrlCommand(args.slice(1), { profileName });
    return;
  }

  if (command === 'setup') {
    const setupArgs = args.slice(1);
    if (setupArgs[0] === '-h' || setupArgs[0] === '--help') {
      console.log(`
Usage:
  subc setup [install|status|uninstall]
  subc setup AGENT [install|status|uninstall] [agent options]

Examples:
  subc setup                    Configure every coding-agent integration
  subc setup status             Show every integration's setup status
  subc setup codex              Configure only Codex
  subc setup codex status       Show only Codex's setup status
  subc setup codex --subagents  Configure Codex's legacy subagent mode
  subc setup codex env          Print persistent Codex exports for sourcing
`);
      return;
    }
    const request = parseSetupRequest(setupArgs);
    const profile = await loadProfile(profileName);
    const targetHelp = request.targeted && isAgentHelpRequest(request.args);
    const persistentHelper = ['use', 'env', 'unset'].includes(request.action);
    const oneOffApiKey = request.targeted && request.args.includes('--api-key');
    if (!targetHelp && !persistentHelper && !oneOffApiKey) requireNamedProfile(profile);
    const failures = [];
    for (const agent of request.agents) {
      const code = await runAgent(agent, request.args, { profile, setup: true });
      if (code) failures.push(agent.name);
    }
    if (failures.length) {
      throw new Error(`Setup failed for: ${failures.join(', ')}`);
    }
    if (targetHelp || persistentHelper) return;
    const subject = request.targeted ? request.agents[0].name : 'Coding-agent';
    const message =
      request.action === 'status'
        ? `${subject} status check complete.`
        : request.action === 'uninstall'
          ? `${subject} integration${request.targeted ? '' : 's'} removed.`
          : `${subject} setup complete.`;
    console.log(`\n  ${c.green}${c.bold}✓ ${message}${c.reset}\n`);
    return;
  }

  const agent = resolveAgent(command);
  if (agent) {
    const profile = await loadProfile(profileName);
    if (!isAgentHelpRequest(args.slice(1))) requireNamedProfile(profile);
    await runAgent(agent, args.slice(1), { profile });
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
