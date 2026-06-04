/**
 * Client-side native-tools agent loop.
 *
 * Uses the standard OpenAI function-calling protocol that the Subconscious
 * endpoint supports natively:
 *
 *   1. Send messages + tools to the model.
 *   2. If the reply contains `tool_calls`, execute each E2B operation and
 *      push both the assistant turn (with tool_calls) and a `role:"tool"`
 *      result message back onto the conversation.
 *   3. Call the API again with the updated history.
 *   4. Repeat until the model returns a plain `content` reply (no tool_calls).
 */

import type OpenAI from "openai";
import type { E2BSandbox } from "../e2b/sandbox.js";
import type { ValidationConfig } from "../utils/validation.js";
import { buildSystemPrompt } from "./prompt.js";
import { E2B_TOOLS } from "./tools.js";
import { executeTool } from "./executor.js";
import { defaultConfig } from "../config.js";
import { DEFAULT_MODEL } from "../lib/client.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Events the loop emits so the CLI can render progress live. */
export type AgentEvent =
  | { type: "thinking" }
  | { type: "tool_call"; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; tool: string; result: string }
  | { type: "tool_error"; tool: string; error: string }
  | { type: "final"; content: string }
  | { type: "error"; error: string };

export interface RunAgentOptions {
  client: OpenAI;
  sandbox: E2BSandbox;
  userMessage: string;
  /** Conversation history from previous turns (role/content pairs). */
  history: Array<{ role: "user" | "assistant"; content: string }>;
  /** Maximum tool-call steps before giving up (default: 20). */
  maxSteps?: number;
  enableThinking?: boolean;
  validationConfig?: ValidationConfig;
  onEvent?: (event: AgentEvent) => void;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Run one user turn to completion. Returns the final answer text.
 * Loops over tool calls until the model produces a plain content reply
 * with no `tool_calls`, or we hit `maxSteps`.
 */
export async function runAgent(opts: RunAgentOptions): Promise<string> {
  const {
    client,
    sandbox,
    userMessage,
    history,
    onEvent,
    signal,
  } = opts;

  const maxSteps = opts.maxSteps ?? 20;
  const enableThinking = opts.enableThinking ?? false;
  const validationConfig = opts.validationConfig ?? defaultConfig.validation;
  const emit = (event: AgentEvent): void => { onEvent?.(event); };

  const system = buildSystemPrompt();

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: userMessage },
  ];

  for (let step = 0; step < maxSteps; step++) {
    throwIfAborted(signal);
    emit({ type: "thinking" });

    const completion = await client.chat.completions.create(
      buildRequestBody(messages, enableThinking),
      { signal },
    );

    const message = completion.choices[0]?.message;
    if (!message) {
      throw new Error("Model returned an empty response.");
    }

    // No tool calls — this is the final answer.
    if (!message.tool_calls || message.tool_calls.length === 0) {
      const content = message.content ?? "";
      emit({ type: "final", content });
      return content;
    }

    // Push the assistant turn (including tool_calls) onto the conversation.
    messages.push({
      role: "assistant",
      content: message.content ?? null,
      tool_calls: message.tool_calls,
    });

    // Execute each tool call and push the result messages.
    for (const tc of message.tool_calls) {
      const toolName = tc.function.name;

      let parsedArgs: Record<string, unknown>;
      try {
        parsedArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      } catch {
        const errMsg = `Invalid JSON in tool arguments: ${tc.function.arguments.slice(0, 200)}`;
        emit({ type: "tool_error", tool: toolName, error: errMsg });
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ error: errMsg }),
        });
        continue;
      }

      emit({ type: "tool_call", tool: toolName, args: parsedArgs });

      let resultContent: string;
      try {
        const result = await executeTool(toolName, parsedArgs, sandbox, validationConfig);
        emit({ type: "tool_result", tool: toolName, result });
        resultContent = result;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        emit({ type: "tool_error", tool: toolName, error });
        resultContent = JSON.stringify({ error });
      }

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: resultContent,
      });
    }
  }

  throw new Error(`Agent exceeded maxSteps (${maxSteps}) without a final answer.`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRequestBody(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  enableThinking: boolean,
): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
  return {
    model: DEFAULT_MODEL,
    messages,
    tools: E2B_TOOLS,
    // `chat_template_kwargs` is a Subconscious vendor extension — not in OpenAI types.
    // @ts-expect-error - chat_template_kwargs is Subconscious-specific, not in the OpenAI types
    chat_template_kwargs: { enable_thinking: enableThinking },
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AgentAbortError();
}

class AgentAbortError extends Error {
  constructor() {
    super("Agent run aborted.");
    this.name = "AgentAbortError";
  }
}

/** True if the error came from Ctrl-C / AbortSignal. */
export function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AgentAbortError" ||
      err.name === "AbortError" ||
      err.name === "APIUserAbortError")
  );
}
