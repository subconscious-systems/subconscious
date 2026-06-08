// 👉 COPY ME to add a new `/slash` command.
//
//   1. Copy this file, rename it (e.g. `history.ts`).
//   2. Fill in name / description / run below.
//   3. Add it to the SLASH_COMMANDS array in `index.ts` (one line).
//
// Your `run` gets `ctx`: ctx.say(text), ctx.error(text), ctx.args (text after the
// command), ctx.mcp (the tools), ctx.clear(), ctx.exit().

import type { SlashCommand } from "./types.js";

export const templateCommand: SlashCommand = {
  name: "template", // TODO(you): rename, e.g. "history"
  description: "TODO(you): what your command does",
  run: (ctx) => {
    // TODO(you): do your thing. Delete this placeholder.
    ctx.say(ctx.args ? `you said: ${ctx.args}` : "hello from your slash command!");
  },
};
