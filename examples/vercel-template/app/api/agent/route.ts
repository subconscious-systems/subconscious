/**
 * Synchronous agent endpoint.
 *
 * Calls client.run() with awaitCompletion: true which executes the agent end-to-end and returns
 * the final answer plus the full reasoning tree in one response.
 *
 * Good for simple integrations where you don't need live streaming.
 * For real-time progress, use the /api/agent/stream endpoint instead.
 *
 * Engine options: "tim", "tim-edge", "tim-claude", "tim-claude-heavy"
 * Docs: https://docs.subconscious.dev/engines
 *
 * Advanced knobs available on this call:
 *  - input.skills       — reusable prompt fragments resolved server-side by name
 *  - options.timeout    — max run duration (seconds, 1–3600)
 *  - options.maxStepTokens — per-step token cap (256–20000)
 *  - options.output.callbackUrl — webhook for async completion
 *  - options.output.responseContent — "full" | "answer_only"
 * See https://docs.subconscious.dev/core-concepts/runs#runtime-options
 */

import { NextRequest, NextResponse } from 'next/server';
import { getClient } from '@/lib/subconscious';
import { getTools } from '@/lib/tools';
import { buildInstructions, extractToolCalls, type AgentRequest, type AgentResponse } from '@/lib/types';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body: AgentRequest = await req.json();

    if (!body.message?.trim()) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    const client = getClient();
    const instructions = buildInstructions(body.message, body.conversationHistory);

    const run = await client.run({
      engine: process.env.SUBCONSCIOUS_ENGINE ?? 'tim',
      input: {
        instructions,
        tools: getTools(),
      },
      options: { awaitCompletion: true },
    });

    const response: AgentResponse = {
      answer: typeof run.result?.answer === 'string' ? run.result.answer : '',
      runId: run.runId,
      toolCalls: extractToolCalls(run.result?.reasoning),
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('[agent] error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
