/**
 * Streaming agent endpoint.
 *
 * Calls client.stream() which returns an async iterable of events:
 *   { type: "delta", content: "..." }  — a chunk of the reasoning JSON
 *   { type: "error", message: "..." }  — something went wrong
 *
 * The delta content chunks concatenate into a full JSON object containing
 * the agent's reasoning tree and final answer. The client-side parser
 * (lib/stream-parser.ts) handles incremental parsing so the UI can
 * show reasoning steps as they arrive.
 */

import { NextRequest } from "next/server";
import { getClient } from "@/lib/subconscious";
import { getTools } from "@/lib/tools";
import { buildInstructions, type AgentRequest } from "@/lib/types";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: AgentRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON in request body" },
      { status: 400 },
    );
  }

  if (!body.message?.trim()) {
    return Response.json(
      { error: "message is required" },
      { status: 400 },
    );
  }

  let client;
  try {
    client = getClient();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[agent] Client error:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }

  const instructions = buildInstructions(
    body.message,
    body.conversationHistory,
  );

  const tools = getTools();
  const toolSummary = tools.map((t) =>
    t.type === "function"
      ? `${t.name} → ${t.url}`
      : t.type === "platform" ? t.id : "mcp",
  );
  console.log("[agent] tools:", toolSummary);

  let stream;
  try {
    stream = client.stream({
      engine: process.env.SUBCONSCIOUS_ENGINE ?? "tim",
      input: {
        instructions,
        tools,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[agent] Stream init error:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          const chunk = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Stream error";
        const errorChunk = `data: ${JSON.stringify({
          type: "error",
          message: msg,
        })}\n\n`;
        controller.enqueue(encoder.encode(errorChunk));
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
