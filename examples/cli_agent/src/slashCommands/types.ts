// What a `/slash` command looks like. Each command is one small file that exports a
// SlashCommand; the registry in index.ts collects them. The `ctx` gives a command
// everything it needs to do its job (talk to the user, see the tools, clear, quit).

import type { McpManager } from "../mcp/client.js";

export interface SlashContext {
  /** Text after the command word, e.g. for "/foo bar baz" → "bar baz". */
  args: string;
  /** All registered commands (so /help can list them). */
  commands: SlashCommand[];
  /** The connected tools (for /tools). */
  mcp: McpManager;
  /** Print a normal (dim) line to the transcript. */
  say: (text: string) => void;
  /** Print a red error line. */
  error: (text: string) => void;
  /** Clear the conversation. */
  clear: () => void;
  /** Quit the REPL (closes tool servers cleanly). */
  exit: () => void;
}

export interface SlashCommand {
  name: string; // the word after "/", e.g. "tools"
  aliases?: string[]; // alternate names, e.g. ["quit"] for exit
  description: string; // shown in /help
  run: (ctx: SlashContext) => void | Promise<void>;
}
