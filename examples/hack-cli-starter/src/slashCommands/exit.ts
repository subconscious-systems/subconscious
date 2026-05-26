import type { SlashCommand } from "./types.js";

export const exitCommand: SlashCommand = {
  name: "exit",
  aliases: ["quit"],
  description: "quit (Ctrl-C also works)",
  run: (ctx) => ctx.exit(),
};
