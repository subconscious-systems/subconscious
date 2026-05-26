// The REPL. This component owns the screen: a scrollback of entries (rendered via
// Ink's <Static> so committed lines never flicker) plus a live region at the bottom
// with a header bar and either the spinner (busy) or the input prompt (idle).
//
// 👉 Add a slash command: drop a file in src/slashCommands/ (copy _template.ts).
// Add a new way to render agent progress: add an Entry kind + a case in `EntryView`.
// The agent loop and MCP manager don't change.

import type OpenAI from "openai";
import { Box, Static, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import { useRef, useState } from "react";
import { type AgentEvent, isAbortError, runAgent } from "../agent/loop.js";
import type { McpManager } from "../mcp/client.js";
import { runSlashCommand } from "../slashCommands/index.js";
import { Banner, type BannerProps } from "./Banner.js";

export interface ChatProps {
  client: OpenAI;
  mcp: McpManager;
  model: string;
  enableThinking: boolean;
}

// One thing printed in the transcript. `id` keys it for <Static>.
type EntryData =
  | { kind: "banner" }
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool_call"; tool: string; args: string }
  | { kind: "tool_result"; summary: string }
  | { kind: "tool_error"; tool: string; error: string }
  | { kind: "system"; text: string }
  | { kind: "error"; text: string };
type Entry = EntryData & { id: number };

const TRUNCATE = 120; // chars shown for tool args/results — keeps lines tidy

export function Chat({ client, mcp, model, enableThinking }: ChatProps) {
  const { exit } = useApp();
  const [entries, setEntries] = useState<Entry[]>(() => [{ id: 0, kind: "banner" }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Thinking…");
  const [generation, setGeneration] = useState(0); // bumped on /clear to remount <Static>

  // Refs hold values our async handlers must read without going stale.
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const historyRef = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const idRef = useRef(0);

  const bannerProps: BannerProps = { model, toolCount: mcp.toolCount(), serverCount: mcp.serverCount() };

  const push = (data: EntryData) => setEntries((prev) => [...prev, { ...data, id: (idRef.current += 1) }]);
  const setBusyBoth = (value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  };

  const shutdown = async () => {
    await mcp.close(); // kill any MCP subprocesses before we leave — no dangling procs
    exit();
  };

  // Ctrl-C: cancel an in-flight run, or exit cleanly if idle. (We set
  // exitOnCtrlC:false when rendering so we own this behavior.)
  useInput((char, key) => {
    if (key.ctrl && char === "c") {
      if (busyRef.current) abortRef.current?.abort();
      else void shutdown();
    }
  });

  const clearConversation = () => {
    historyRef.current = [];
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H"); // clear screen + scrollback
    idRef.current = 0;
    setEntries([{ id: 0, kind: "banner" }]);
    setGeneration((g) => g + 1);
    push({ kind: "system", text: "context cleared." });
  };

  const handleSlash = (text: string) => {
    void runSlashCommand(text, {
      mcp,
      say: (t) => push({ kind: "system", text: t }),
      error: (t) => push({ kind: "error", text: t }),
      clear: clearConversation,
      exit: () => void shutdown(),
    });
  };

  const runTurn = async (userMessage: string) => {
    push({ kind: "user", text: userMessage });
    setBusyBoth(true);
    setStatus("Thinking…");

    const controller = new AbortController();
    abortRef.current = controller;
    let emittedError = false;

    const onEvent = (event: AgentEvent) => {
      switch (event.type) {
        case "thinking":
          setStatus("Thinking…");
          break;
        case "tool_call":
          push({ kind: "tool_call", tool: event.tool, args: truncate(stringify(event.args)) });
          setStatus(`Calling ${event.tool}…`);
          break;
        case "tool_result":
          push({ kind: "tool_result", summary: truncate(stringify(event.result)) });
          setStatus("Reading response…");
          break;
        case "tool_error":
          push({ kind: "tool_error", tool: event.tool, error: truncate(event.error) });
          break;
        case "final":
          push({ kind: "assistant", text: event.content });
          break;
        case "error":
          push({ kind: "error", text: event.error });
          emittedError = true;
          break;
      }
    };

    try {
      const final = await runAgent({
        client,
        mcp,
        model,
        enableThinking,
        userMessage,
        history: historyRef.current,
        onEvent,
        signal: controller.signal,
      });
      historyRef.current = [
        ...historyRef.current,
        { role: "user", content: userMessage },
        { role: "assistant", content: final },
      ];
    } catch (err) {
      if (isAbortError(err)) push({ kind: "system", text: "✗ cancelled" });
      else if (!emittedError) push({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      abortRef.current = null;
      setBusyBoth(false);
    }
  };

  const handleSubmit = (value: string) => {
    if (busyRef.current) return;
    const text = value.trim();
    setInput("");
    if (!text) return;
    if (text.startsWith("/")) handleSlash(text);
    else void runTurn(text);
  };

  return (
    <Box flexDirection="column">
      <Static key={generation} items={entries}>
        {(entry) => <EntryView key={entry.id} entry={entry} banner={bannerProps} />}
      </Static>

      <Box flexDirection="column" marginTop={1}>
        <Box borderStyle="round" borderColor="gray" paddingX={1}>
          <Text dimColor>
            {model} · {mcp.serverCount()} server{mcp.serverCount() === 1 ? "" : "s"} · {mcp.toolCount()} tool
            {mcp.toolCount() === 1 ? "" : "s"}
          </Text>
        </Box>

        {busy ? (
          <Box marginTop={1}>
            <Text color="cyan">
              <Spinner type="dots" />
            </Text>
            <Text> {status}</Text>
          </Box>
        ) : (
          <Box marginTop={1}>
            <Text color="cyan">› </Text>
            <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} placeholder="message, or /help" />
          </Box>
        )}
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Rendering one entry. Colors: cyan = you/structure, magenta = agent,
// yellow = tools, red = errors, dim = system notices.
// ---------------------------------------------------------------------------

function EntryView({ entry, banner }: { entry: Entry; banner: BannerProps }) {
  switch (entry.kind) {
    case "banner":
      return <Banner {...banner} />;
    case "user":
      return (
        <Text>
          <Text color="cyan" bold>
            you{" "}
          </Text>
          {entry.text}
        </Text>
      );
    case "assistant":
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color="magenta" bold>
            sub
          </Text>
          <Text>{entry.text}</Text>
        </Box>
      );
    case "tool_call":
      return (
        <Text>
          <Text color="yellow">→ {entry.tool} </Text>
          <Text dimColor>{entry.args}</Text>
        </Text>
      );
    case "tool_result":
      return (
        <Text>
          <Text color="yellow" dimColor>
            ←{" "}
          </Text>
          <Text dimColor>{entry.summary}</Text>
        </Text>
      );
    case "tool_error":
      return (
        <Text color="red">
          ✗ {entry.tool ? `${entry.tool} ` : ""}
          {entry.error}
        </Text>
      );
    case "system":
      return (
        <Box paddingLeft={2}>
          <Text dimColor>{entry.text}</Text>
        </Box>
      );
    case "error":
      return <Text color="red">{entry.text}</Text>;
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(text: string, max = TRUNCATE): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}
