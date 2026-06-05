// ⭐ THE AGENT LOOP — read this file top to bottom. It's the heart of the starter.
//
// Subconscious exposes an OpenAI-compatible chat endpoint that supports standard
// function tools — but it does NOT execute them for you. So we run the whole
// ReAct loop (Reason -> Act -> Observe) HERE, on the client:
//
//   1. We hand the model our MCP tools as OpenAI function tools (`tools: [...]`).
//   2. If the model replies with `tool_calls`, we run each one via the MCP
//      manager, feed the results back as `role: "tool"` messages, and loop.
//   3. If it replies with plain content (no tool_calls), that's the final answer.
//
// This is the pattern you'll reuse for your hackathon project. To change where
// tools come from or how they run, edit mcp/client.ts — this file stays the same.

import type OpenAI from "openai";
import type { McpManager, ToolDefinition } from "../mcp/client.js";
import { buildSystemPrompt } from "../prompt.js";

// Events the loop emits so the UI can render progress live. Want a new kind of
// progress indicator? Add a variant here and handle it in components/Chat.tsx —
// the loop and the MCP manager stay untouched.
export type AgentEvent =
  | { type: "thinking" }
  | { type: "tool_call"; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; tool: string; result: unknown }
  | { type: "tool_error"; tool: string; error: string }
  | { type: "final"; content: string }
  | { type: "error"; error: string };

export interface RunOptions {
  client: OpenAI;
  mcp: McpManager;
  model: string;
  userMessage: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  maxSteps?: number; // default 12 — guards against infinite tool loops
  enableThinking?: boolean;
  onEvent?: (event: AgentEvent) => void;
  signal?: AbortSignal;
}

/**
 * Run one user turn to completion: keep calling the model (and tools) until it
 * produces a final answer or we hit `maxSteps`. Returns the final answer text.
 */
export async function runAgent(opts: RunOptions): Promise<string> {
  const { client, mcp, model, userMessage, history, onEvent, signal } = opts;
  const maxSteps = opts.maxSteps ?? 12;
  const enableThinking = opts.enableThinking ?? false;
  const emit = (event: AgentEvent) => onEvent?.(event);

  // Hand the model every MCP tool as a standard OpenAI function tool. The model
  // gets each tool's name + JSON schema natively — no prose protocol needed.
  const tools = toOpenAiTools(mcp.getTools());

  // The running transcript for THIS turn. We seed it with prior conversation
  // (plain user/assistant text) and grow it as the agent calls tools.
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt() },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: userMessage },
  ];

  for (let step = 0; step < maxSteps; step++) {
    throwIfAborted(signal);
    emit({ type: "thinking" });

    // --- Reason: ask the model what to do next ----------------------------
    const completion = await client.chat.completions.create(buildBody(model, messages, tools, enableThinking), {
      signal,
    });
    const message = completion.choices[0]?.message;
    if (!message) throw new Error("Model returned no choices.");

    const toolCalls = message.tool_calls ?? [];

    // --- Final answer? We're done. ---------------------------------------
    if (toolCalls.length === 0) {
      const content = message.content ?? "";
      emit({ type: "final", content });
      return content;
    }

    // Record the assistant turn that requested the tools, verbatim, so the next
    // turn has full continuity (the API requires this before tool results).
    messages.push({ role: "assistant", content: message.content ?? "", tool_calls: toolCalls });

    // --- Act + Observe: run each requested tool, feed the result back -----
    // 👉 Want per-tool approval prompts? This is where you'd pause and ask the
    // user "run <tool> with <args>? [y/N]" before executing. v1 auto-executes.
    for (const toolCall of toolCalls) {
      if (toolCall.type !== "function") continue; // we only register function tools
      const tool = toolCall.function.name;
      const args = parseArgs(toolCall.function.arguments);
      emit({ type: "tool_call", tool, args });

      try {
        const result = await mcp.callTool(tool, args);
        emit({ type: "tool_result", tool, result });
        messages.push({ role: "tool", tool_call_id: toolCall.id, content: safeJson(result) });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        emit({ type: "tool_error", tool, error });
        // Tool errors aren't fatal — we tell the model so it can recover or apologize.
        messages.push({ role: "tool", tool_call_id: toolCall.id, content: `Tool failed: ${error}` });
      }
    }
  }

  throw new Error(`Agent exceeded maxSteps (${maxSteps}) without reaching a final answer.`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Turn our MCP tool list into OpenAI function-tool definitions. */
function toOpenAiTools(tools: ToolDefinition[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.qualifiedName, // "<server>__<tool>" — valid as an OpenAI tool name
      description: tool.description || undefined,
      parameters: tool.inputSchema,
    },
  }));
}

function buildBody(
  model: string,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  enableThinking: boolean,
): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
  return {
    model,
    messages,
    tools: tools.length > 0 ? tools : undefined,
    // `chat_template_kwargs` is a Subconscious vendor extension; the OpenAI SDK's
    // types don't know about it, so we suppress the type error on purpose.
    // @ts-expect-error - chat_template_kwargs is Subconscious-specific, not in the OpenAI types
    chat_template_kwargs: { enable_thinking: enableThinking },
  };
}

/** Tool-call arguments arrive as a JSON string. Parse defensively. */
function parseArgs(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AbortError();
}

class AbortError extends Error {
  constructor() {
    super("Agent run aborted.");
    this.name = "AbortError";
  }
}

/** True if an error came from Ctrl-C / AbortSignal (ours or the OpenAI SDK's). */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "APIUserAbortError");
}
