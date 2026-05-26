import type { SlashCommand } from "./types.js";

export const toolsCommand: SlashCommand = {
  name: "tools",
  description: "list the tools the agent can use",
  run: (ctx) => {
    const tools = ctx.mcp.getTools();
    if (tools.length === 0) {
      ctx.say("no tools connected.");
      return;
    }
    const lines = tools.map((t) => `  ${t.qualifiedName} — ${t.description || "(no description)"}`);
    ctx.say(["tools:", ...lines, "", "add more tools in src/commands/chat.tsx (see the README)."].join("\n"));
  },
};
