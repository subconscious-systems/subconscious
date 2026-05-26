#!/usr/bin/env node
// Entrypoint. Commander wires up the subcommands from the registry; `chat` is the
// default, so bare `sub` opens the REPL. Errors bubble up here and print cleanly.

import { Command } from "commander";
import { COMMANDS } from "./commands/index.js";

const program = new Command();

program
  .name("sub")
  .description("subconscious agent CLI — a hackathon starter")
  .version("0.1.0");

for (const register of COMMANDS) register(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  // Friendly, stack-free errors. The detail is in the message we threw.
  process.stderr.write(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
