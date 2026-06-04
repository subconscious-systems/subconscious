/**
 * Streaming agent endpoint.
 *
 * Implements a server-side tool-calling loop against the Subconscious
 * OpenAI-compatible API using native OpenAI function tools. The loop:
 *   1. Sends the conversation to the model with tool definitions
 *   2. If the model calls tools, executes them locally and loops
 *   3. Once the model produces a final answer, streams the text to the client
 *
 * SSE event shapes emitted to the client:
 *   { type: "tool_call",   tool: string; args: Record<string, unknown> }
 *   { type: "tool_result", tool: string; result: unknown }
 *   { type: "delta",       content: string }   — streaming answer text chunk
 *   { type: "done" }
 *   { type: "error",       message: string }
 */

import { NextRequest } from "next/server";
import type OpenAI from "openai";
import { getClient, SUBCONSCIOUS_MODEL } from "@/lib/subconscious";
import { callTool, OPENAI_TOOLS } from "@/lib/tools";
import { buildMessages, type AgentRequest } from "@/lib/types";

export const maxDuration = 60;

const MAX_STEPS = 12;
const SYSTEM_PROMPT = "You are a helpful AI assistant with access to tools. Use them whenever they would help answer the user's request.";

// ─── SSE helpers ─────────────────────────────────────────────────

function encodeEvent(encoder: TextEncoder, event: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

// ─── Handler ─────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<Response> {
  let body: AgentRequest;
  try {
    body = (await req.json()) as AgentRequest;
  } catch {
    return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  if (!body.message?.trim()) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  let openai: OpenAI;
  try {
    openai = getClient();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }

  const encoder = new TextEncoder();

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...buildMessages(body.message, body.conversationHistory),
  ];

  const readable = new ReadableStream({
    async start(controller) {
      const emit = (event: Record<string, unknown>): void => {
        controller.enqueue(encodeEvent(encoder, event));
      };

      try {
        for (let step = 0; step < MAX_STEPS; step++) {
          // Non-streaming call to inspect tool_calls before streaming the answer
          const completion = await openai.chat.completions.create({
            model: SUBCONSCIOUS_MODEL,
            messages,
            tools: OPENAI_TOOLS,
            // @ts-expect-error chat_template_kwargs is a Subconscious extension
            chat_template_kwargs: { enable_thinking: false },
          });

          const message = completion.choices[0]?.message;
          if (!message) {
            emit({ type: "error", message: "Model returned an empty response" });
            controller.close();
            return;
          }

          // No tool calls → stream the final answer content
          if (!message.tool_calls?.length) {
            const answer = message.content ?? "";
            // Emit in small chunks to give a streaming feel
            const CHUNK_SIZE = 20;
            for (let i = 0; i < answer.length; i += CHUNK_SIZE) {
              emit({ type: "delta", content: answer.slice(i, i + CHUNK_SIZE) });
            }
            emit({ type: "done" });
            controller.close();
            return;
          }

          // Push the assistant turn (with tool_calls) into history
          messages.push({
            role: "assistant",
            content: message.content,
            tool_calls: message.tool_calls,
          });

          // Execute each tool call, emit events, push results into history
          for (const tc of message.tool_calls) {
            const toolName = tc.function.name;
            let args: Record<string, unknown>;
            try {
              args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
            } catch {
              args = {};
            }

            emit({ type: "tool_call", tool: toolName, args });

            const toolResult = await callTool(toolName, args);

            emit({ type: "tool_result", tool: toolName, result: toolResult });

            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify(toolResult),
            });
          }
        }

        // Exceeded max steps
        emit({
          type: "error",
          message: `Agent exceeded ${MAX_STEPS} steps without producing a final answer.`,
        });
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Stream error";
        console.error("[agent/stream] error:", err);
        emit({ type: "error", message: msg });
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
