/**
 * Main entrypoint for the E2B CLI agent.
 *
 * Usage: bun run agent
 *        bun run src/index.ts
 */

import { runAgent_cli } from "./cli/run.js";

runAgent_cli().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal error: ${message}\n`);
  if (error instanceof Error && error.stack) {
    process.stderr.write(`${error.stack}\n`);
  }
  process.exit(1);
});
