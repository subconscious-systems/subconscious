/**
 * Synchronous agent endpoint.
 *
 * Calls client.run() which executes the agent end-to-end and returns
 * the final answer plus the full reasoning tree in one response.
 *
 * Good for simple integrations where you don't need live streaming.
 * For real-time progress, use the /api/agent/stream endpoint instead.
 *
 * Engine options: "tim", "tim-gpt", "tim-gpt-heavy", "tim-edge"
 * Docs: https://docs.subconscious.dev/engines
 */

import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/subconscious";
import { getTools } from "@/lib/tools";
import {
  buildInstructions,
  extractToolCalls,
  type AgentRequest,
  type AgentResponse,
  type ReasoningNode,
} from "@/lib/types";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body: AgentRequest = await req.json();

    if (!body.message?.trim()) {
      return NextResponse.json(
        { error: "message is required" },
        { status: 400 },
      );
    }

    const client = getClient();
    const instructions = buildInstructions(
      body.message,
      body.conversationHistory,
    );

    const run = await client.run({
      engine: process.env.SUBCONSCIOUS_ENGINE ?? "tim-gpt",
      input: {
        instructions,
        tools: getTools(),
      },
      options: { awaitCompletion: true },
    });

    const response: AgentResponse = {
      answer: run.result?.answer ?? "",
      runId: run.runId,
      toolCalls: extractToolCalls(
        run.result?.reasoning as ReasoningNode,
      ),
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("[agent] error:", err);
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
