import type { SlashCommand } from "./types.js";

// /help builds its list from the registry, so new commands show up automatically.
export const helpCommand: SlashCommand = {
  name: "help",
  description: "show this help",
  run: (ctx) => {
    const lines = ctx.commands.map((c) => {
      const names = [c.name, ...(c.aliases ?? [])].map((n) => `/${n}`).join(", ");
      return `  ${names.padEnd(16)} ${c.description}`;
    });
    ctx.say(["commands:", ...lines, "otherwise, just type a message to talk to the agent."].join("\n"));
  },
};
