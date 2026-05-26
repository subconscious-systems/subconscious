// ⭐ THE AGENT LOOP — read this file top to bottom. It's the heart of the starter.
//
// Subconscious exposes an OpenAI-compatible chat endpoint, but it does NOT accept a
// `tools` field — there is no server-side function-calling. So we run the whole
// ReAct loop (Reason -> Act -> Observe) HERE, on the client:
//
//   1. We hand the model a list of MCP tools in the system prompt.
//   2. We force its reply to be structured JSON ("call a tool" OR "final answer")
//      using `response_format: json_schema`, so we never parse fragile prose.
//   3. If it asks for a tool, we run it via the MCP manager, feed the result back,
//      and loop. If it gives a final answer, we're done.
//
// This is the pattern you'll reuse for your hackathon project. The day Subconscious
// ships native tool-calling, you'd rewrite ONLY this file — nothing else moves.

import type OpenAI from "openai";
import type { McpManager } from "../mcp/client.js";
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

// The structured shape we force the model into. We use a FLAT object with a
// discriminator field (`action`) rather than a JSON-Schema `oneOf`, because flat
// schemas are far more reliable across constrained-decoding implementations.
const RESPONSE_FORMAT: OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"] = {
  type: "json_schema",
  json_schema: {
    name: "agent_response",
    strict: true,
    schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["tool_call", "final_answer"] },
        tool: { type: "string" }, // present when action === "tool_call"
        arguments: { type: "object" }, // present when action === "tool_call"
        content: { type: "string" }, // present when action === "final_answer"
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
};

interface AgentResponse {
  action: "tool_call" | "final_answer";
  tool?: string;
  arguments?: Record<string, unknown>;
  content?: string;
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

  // The system prompt lists every tool by qualified name + JSON schema. Edit how
  // this reads in src/prompt.ts.
  const system = buildSystemPrompt(mcp.getTools());

  // The running transcript for THIS turn. We seed it with prior conversation
  // (plain user/assistant text) and grow it as the agent calls tools.
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: userMessage },
  ];

  for (let step = 0; step < maxSteps; step++) {
    throwIfAborted(signal);
    emit({ type: "thinking" });

    // --- Reason: ask the model what to do next ----------------------------
    const completion = await client.chat.completions.create(buildBody(model, messages, enableThinking), { signal });
    const raw = completion.choices[0]?.message?.content ?? "";

    let parsed: AgentResponse;
    try {
      parsed = parseResponse(raw);
    } catch (err) {
      // strict json_schema makes this rare, but never trust the wire blindly.
      emit({ type: "error", error: `Model returned unparseable output: ${raw.slice(0, 200)}` });
      throw err;
    }

    // --- Final answer? We're done. ---------------------------------------
    if (parsed.action === "final_answer") {
      const content = parsed.content ?? "";
      emit({ type: "final", content });
      return content;
    }

    // --- Act: the model wants to call a tool ------------------------------
    const tool = parsed.tool ?? "";
    const args = parsed.arguments ?? {};
    emit({ type: "tool_call", tool, args });

    // Record what the model said verbatim, so its next turn has full continuity.
    messages.push({ role: "assistant", content: raw });

    // 👉 Want per-tool approval prompts? This is where you'd pause and ask the
    // user "run <tool> with <args>? [y/N]" before executing. v1 auto-executes.
    try {
      const result = await mcp.callTool(tool, args);
      emit({ type: "tool_result", tool, result });
      // --- Observe: feed the result back as the next user turn ------------
      messages.push({ role: "user", content: `Tool "${tool}" returned:\n${safeJson(result)}` });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      emit({ type: "tool_error", tool, error });
      // Tool errors aren't fatal — we tell the model so it can recover or apologize.
      messages.push({ role: "user", content: `Tool "${tool}" failed with error:\n${error}` });
    }
  }

  throw new Error(`Agent exceeded maxSteps (${maxSteps}) without reaching a final answer.`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildBody(
  model: string,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  enableThinking: boolean,
): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
  return {
    model,
    messages,
    response_format: RESPONSE_FORMAT,
    // `chat_template_kwargs` is a Subconscious vendor extension; the OpenAI SDK's
    // types don't know about it, so we suppress the type error on purpose.
    // @ts-expect-error - chat_template_kwargs is Subconscious-specific, not in the OpenAI types
    chat_template_kwargs: { enable_thinking: enableThinking },
  };
}

function parseResponse(raw: string): AgentResponse {
  const obj = JSON.parse(extractJson(raw)) as AgentResponse;
  if (obj.action !== "tool_call" && obj.action !== "final_answer") {
    throw new Error(`Unexpected "action": ${JSON.stringify(obj.action)}`);
  }
  return obj;
}

// Defensive: if the model ever wraps its JSON in stray text, grab the object.
function extractJson(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) return trimmed.slice(start, end + 1);
  return trimmed; // let JSON.parse throw a clear error
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
