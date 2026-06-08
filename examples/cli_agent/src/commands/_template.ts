// 👉 COPY ME to add a new `sub <command>`.
//
// Three steps to a working subcommand:
//   1. Copy this file, rename it (e.g. `commands/history.ts`).
//   2. Rename `registerTemplate` + the command string below.
//   3. Add it to the COMMANDS array in `commands/index.ts` (one line).

import type { Command } from "commander";

export function registerTemplate(program: Command): void {
  program
    .command("template") // TODO(you): rename this to your command, e.g. "history"
    .description("TODO(you): describe what your command does") // shows up in `sub --help`
    .option("--loud", "example flag") // TODO(you): add real flags, or delete this
    .action((opts: { loud?: boolean }) => {
      // TODO(you): do your thing here. Delete this placeholder when done.
      const message = "hello from your new command!";
      process.stdout.write(`${opts.loud ? message.toUpperCase() : message}\n`);
    });
}
