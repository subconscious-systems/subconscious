#!/usr/bin/env bun

/**
 * Main entrypoint for the CLI agent.
 * 
 * Usage: bun run agent
 *        bun run src/index.ts
 */

import { runAgent } from "./cli/run";

// Run the agent
runAgent().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
