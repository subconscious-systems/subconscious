import {
  agentCommandName,
  agentInputs,
  agentSetupActions,
} from './agent-data.js';
import { c } from './colors.js';
import { profileSettingsForAgent, resolvedProfileValues } from './profiles.js';

export function isAgentHelpRequest(argv = []) {
  return ['help', '-h', '--help'].includes(argv[0]);
}

function displayProfileValue(setting, value, values) {
  if (setting.type === 'secret') {
    if (value) return '(set)';
    return setting.key !== 'API_KEY' && values.API_KEY
      ? '(shared key)'
      : '(not set)';
  }
  if (!value && setting.model) return 'UNSET';
  return value || '(auto)';
}

function optionText(description) {
  if (typeof description === 'string') return description;
  return description[process.platform] ?? description.default;
}

/** Static options, then documented flags, then the pass-through argument. */
function helpOptions(agent) {
  const { options, args } = agent.help;
  const flags = agentInputs(agent)
    .filter((input) => input.flag && input.help)
    .map((input) => [
      input.metavar ? `${input.flag} ${input.metavar}` : input.flag,
      input.help,
    ]);
  const listed = [...options, ...flags, ...(args ? [args] : [])].map(
    ([option, description]) => [option, optionText(description)],
  );
  const headless =
    agent.launch?.headless_argv &&
    !listed.some(([option]) => option.startsWith('headless'));
  return headless
    ? [
        ...listed,
        ['headless PROMPT', 'Run one task without prompting, then exit'],
      ]
    : listed;
}

function printSettings(agent, profile) {
  const settings = profileSettingsForAgent(agent.id);
  const values = resolvedProfileValues(profile);
  const width = Math.max(0, ...settings.map((setting) => setting.key.length));
  console.log(
    `  ${c.bold}Profile settings${c.reset} ${c.dim}(${profile?.name || 'default'})${c.reset}`,
  );
  for (const setting of settings) {
    const value = displayProfileValue(setting, values[setting.key], values);
    console.log(
      `    ${c.cyan}${setting.key.padEnd(width)}${c.reset}  ${value}`,
    );
    console.log(
      `    ${' '.repeat(width)}  ${c.dim}${setting.description}${c.reset}`,
    );
  }
}

function printSetupHints(agent, profile) {
  const command = agentCommandName(agent);
  console.log(
    `\n  Edit the env file with ${c.cyan}subc -p ${profile?.name || 'default'} config edit${c.reset}.`,
  );
  const actions = agentSetupActions(agent);
  if (actions.includes('install')) {
    const what = agent.runbook.binary_install_script
      ? 'Install the agent binary with'
      : 'Install the persistent integration with';
    console.log(`  ${what} ${c.cyan}subc ${command} install${c.reset}.`);
  }
  if (actions.includes('uninstall')) {
    console.log(
      `  Remove it with ${c.cyan}subc ${command} uninstall${c.reset}.`,
    );
  }
}

export function printAgentHelp(agent, profile) {
  const options = helpOptions(agent);
  const width = Math.max(0, ...options.map(([option]) => option.length));
  console.log(`\n  ${c.bold}${agent.name} + Subconscious${c.reset}\n`);
  console.log(`  ${agent.help.behavior}\n`);
  console.log(`  ${c.bold}Usage${c.reset}\n    ${agent.help.usage}\n`);
  if (options.length) {
    console.log(`  ${c.bold}Commands and options${c.reset}`);
    for (const [option, description] of options)
      console.log(
        `    ${c.cyan}${option.padEnd(width)}${c.reset}  ${description}`,
      );
    console.log();
  }
  printSettings(agent, profile);
  printSetupHints(agent, profile);
  console.log();
}
