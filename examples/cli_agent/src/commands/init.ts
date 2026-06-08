// `sub init` — the 60-second onboarding. Stores your API key, then points you at
// `sub`. The filesystem tool is built in, so there's nothing else to wire up.
// Uses plain readline (no extra deps) since it's a one-shot prompt, not a REPL.

import type { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { getConfig, resolveApiKey, setConfigValue } from "../lib/config.js";

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("first-run setup: store your API key")
    .action(runInit);
}

async function runInit(): Promise<void> {
  if (!process.stdin.isTTY) {
    process.stdout.write("`sub init` needs an interactive terminal. Use `sub config set apiKey ...` instead.\n");
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write("\nWelcome to sub — let's get you running.\n\n");

    if (hasApiKey()) {
      process.stdout.write("✓ API key already set.\n");
    } else {
      const key = (await rl.question("Paste your Subconscious API key (or leave blank to skip): ")).trim();
      if (key) {
        setConfigValue("apiKey", key);
        process.stdout.write("✓ Saved your API key.\n");
      } else {
        process.stdout.write("• Skipped. Set SUBCONSCIOUS_API_KEY in your shell before running `sub`.\n");
      }
    }

    process.stdout.write(
      "\nAll set! The agent has two built-in tools (filesystem + weather).\n" +
        'Run `sub` and try: "what files are in this directory?"\n\n',
    );
  } finally {
    rl.close();
  }
}

function hasApiKey(): boolean {
  try {
    resolveApiKey(getConfig());
    return true;
  } catch {
    return false;
  }
}
