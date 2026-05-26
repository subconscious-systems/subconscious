// The `chat` command — the default. Wires up the model client + MCP manager, then
// hands control to the Ink REPL in components/Chat.tsx.

import { render } from "ink";
import type { Command } from "commander";
import { createClient } from "../lib/client.js";
import { getConfig } from "../lib/config.js";
import { McpManager } from "../mcp/client.js";
import { builtinTools } from "../tools/index.js";
import { Chat } from "../components/Chat.js";

interface ChatOptions {
  dir?: string;
  noTools?: boolean;
  model?: string;
  thinking?: boolean;
}

export function registerChat(program: Command): void {
  program
    .command("chat", { isDefault: true })
    .description("open the interactive agent REPL")
    .option("--dir <path>", "folder the built-in filesystem tool can access (default: current dir)")
    .option("--no-tools", "run with no tools (plain chat)")
    .option("--model <model>", "override the configured model")
    .option("--thinking", "enable extended thinking (chat_template_kwargs.enable_thinking)")
    .action((opts: ChatOptions) => runChat(opts));
}

async function runChat(opts: ChatOptions): Promise<void> {
  const config = getConfig();
  const model = opts.model ?? config.model;
  const enableThinking = Boolean(opts.thinking) || config.enableThinking;

  // Resolve the client first — this throws a friendly error if no API key is set,
  // before we bother spinning up the tools or the UI.
  const client = createClient(config);

  // The agent's tools live in src/tools/index.ts — edit that list to add your own.
  const servers = opts.noTools ? [] : builtinTools(opts.dir ?? process.cwd());

  const mcp = new McpManager();
  await mcp.connectAll(servers); // tolerant — per-server failures just warn to stderr

  const { waitUntilExit } = render(
    <Chat client={client} mcp={mcp} model={model} enableThinking={enableThinking} />,
    { exitOnCtrlC: false }, // we handle Ctrl-C ourselves (cancel vs exit)
  );
  await waitUntilExit();
  await mcp.close();
}
