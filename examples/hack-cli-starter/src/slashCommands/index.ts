// The slash-command registry + dispatcher. To add a command: write a file (copy
// _template.ts), then add it to the SLASH_COMMANDS array below. That's it.

import type { SlashCommand, SlashContext } from "./types.js";
import { clearCommand } from "./clear.js";
import { exitCommand } from "./exit.js";
import { helpCommand } from "./help.js";
import { toolsCommand } from "./tools.js";

// 👉 Register new slash commands here.
export const SLASH_COMMANDS: SlashCommand[] = [helpCommand, toolsCommand, clearCommand, exitCommand];

/** Parse "/name rest..." and run the matching command (or report unknown). */
export async function runSlashCommand(
  input: string,
  ctx: Omit<SlashContext, "args" | "commands">,
): Promise<void> {
  const body = input.slice(1); // drop the leading "/"
  const space = body.indexOf(" ");
  const name = (space === -1 ? body : body.slice(0, space)).toLowerCase();
  const args = space === -1 ? "" : body.slice(space + 1).trim();

  const command = SLASH_COMMANDS.find((c) => c.name === name || c.aliases?.includes(name));
  const fullCtx: SlashContext = { ...ctx, args, commands: SLASH_COMMANDS };

  if (!command) {
    fullCtx.say(`unknown command: /${name}. try /help.`);
    return;
  }
  await command.run(fullCtx);
}
