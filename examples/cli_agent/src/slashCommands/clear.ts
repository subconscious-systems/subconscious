import type { SlashCommand } from "./types.js";

export const clearCommand: SlashCommand = {
  name: "clear",
  description: "clear the conversation",
  run: (ctx) => ctx.clear(),
};
