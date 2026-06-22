#!/usr/bin/env node

/**
 * Subconscious CLI — log in, then launch coding agents on your hosted models.
 *
 *   subconscious login | logout | whoami     — manage your API key
 *   subconscious <agent> [...args]            — launch a coding agent
 *
 * Auth lives in ./auth.js, the agent launcher + registry in ./agents.js.
 */

import fs from 'node:fs/promises';
import { c } from './colors.js';
import { loginCommand, logoutCommand, whoamiCommand } from './auth.js';
import { resolveAgent, runAgent, agentList } from './agents.js';

function printHelp() {
  const agents = agentList()
    .map(({ name, alias }) => `    ${c.cyan}${alias.padEnd(13)}${c.reset}${c.dim}Launch ${name}${c.reset}`)
    .join('\n');

  console.log(`
  ${c.magenta}${c.bold}Subconscious CLI${c.reset}

  ${c.bold}Usage${c.reset}
    ${c.cyan}subconscious${c.reset} <command> [...args]

  ${c.bold}Auth${c.reset}
    ${c.cyan}login${c.reset}        Authenticate and save your API key
    ${c.cyan}logout${c.reset}       Remove saved credentials
    ${c.cyan}whoami${c.reset}       Show current authentication status

  ${c.bold}Coding agents${c.reset}
${agents}

  ${c.bold}Options${c.reset}
    ${c.dim}--model <id>${c.reset}   Model to use (default subconscious/tim-qwen3.6-27b)
    ${c.dim}-h, --help${c.reset}     Show this help
    ${c.dim}-v, --version${c.reset}  Show version

  ${c.bold}Examples${c.reset}
    ${c.dim}$${c.reset} subconscious login
    ${c.dim}$${c.reset} subconscious claude-code
    ${c.dim}$${c.reset} subconscious open-code --model subconscious/tim-qwen3.6-27b

  ${c.dim}Anything after the agent name is forwarded to the underlying CLI.${c.reset}
`);
}

const authCommands = { login: loginCommand, logout: logoutCommand, whoami: whoamiCommand };

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
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
    await authHandler(args.slice(1));
    return;
  }

  const agent = resolveAgent(command);
  if (agent) {
    await runAgent(agent, args.slice(1));
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
