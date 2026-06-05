/**
 * Synchronous agent endpoint.
 *
 * Runs a full tool-calling loop against the Subconscious OpenAI-compatible API
 * using native OpenAI function tools and returns the final answer in one
 * response. For real-time streaming progress, use /api/agent/stream instead.
 *
 * The loop:
 *   1. Calls the model with conversation history + tool definitions
 *   2. If the model emits tool_calls, executes each tool locally and loops
 *   3. Returns when the model produces a plain content response (no tool_calls)
 */

import { NextRequest, NextResponse } from "next/server";
import type OpenAI from "openai";
import { getClient, SUBCONSCIOUS_MODEL } from "@/lib/subconscious";
import { callTool, OPENAI_TOOLS } from "@/lib/tools";
import {
  buildMessages,
  type AgentRequest,
  type AgentResponse,
  type ToolCallInfo,
} from "@/lib/types";

export const maxDuration = 60;

const MAX_STEPS = 12;
const SYSTEM_PROMPT = "You are a helpful AI assistant with access to tools. Use them whenever they would help answer the user's request.";

// ─── Handler ─────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: AgentRequest;
  try {
    body = (await req.json()) as AgentRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  if (!body.message?.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  let openai: OpenAI;
  try {
    openai = getClient();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const toolCalls: ToolCallInfo[] = [];

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...buildMessages(body.message, body.conversationHistory),
  ];

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const completion = await openai.chat.completions.create({
        model: SUBCONSCIOUS_MODEL,
        messages,
        tools: OPENAI_TOOLS,
        // @ts-expect-error chat_template_kwargs is a Subconscious extension
        chat_template_kwargs: { enable_thinking: false },
      });

      const message = completion.choices[0]?.message;
      if (!message) {
        return NextResponse.json(
          { error: "Model returned an empty response" },
          { status: 500 },
        );
      }

      // No tool calls → this is the final answer
      if (!message.tool_calls?.length) {
        const response: AgentResponse = {
          answer: message.content ?? "",
          toolCalls,
        };
        return NextResponse.json(response);
      }

      // Push the assistant turn (with tool_calls) into history
      messages.push({
        role: "assistant",
        content: message.content,
        tool_calls: message.tool_calls,
      });

      // Execute each tool call and push a tool result message for each
      for (const tc of message.tool_calls) {
        const toolName = tc.function.name;
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          args = {};
        }

        const toolResult = await callTool(toolName, args);
        toolCalls.push({ name: toolName, input: args, output: toolResult });

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(toolResult),
        });
      }
    }

    return NextResponse.json(
      { error: `Agent exceeded ${MAX_STEPS} steps without producing a final answer.` },
      { status: 500 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[agent] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
