/**
 * Tool webhook endpoint (optional / advanced).
 *
 * Tools in this template run inline inside the agent loop (see
 * app/api/agent/stream/route.ts). This route exists as a reference
 * for teams that want to expose their tools as a standalone HTTP
 * endpoint — for example, to call from external orchestrators or
 * during local debugging.
 *
 * Request body: { tool_name: string, parameters: Record<string, unknown> }
 * Response:     the tool result as JSON
 *
 * HOW TO ADD A HANDLER
 * ────────────────────
 * 1. Write an async function that receives `params` and returns
 *    a plain object. The object is sent back as the tool result.
 *
 * 2. Add it to the `handlers` map — the key MUST match the
 *    `name` you used in lib/tools.ts.
 *
 * EXAMPLE:
 *
 *   async function weatherLookup(params: Record<string, unknown>) {
 *     const { city } = params;
 *     const res = await fetch(`https://wttr.in/${city}?format=j1`);
 *     return await res.json();
 *   }
 *
 *   // then in the handlers map:
 *   WeatherLookup: weatherLookup,
 */

import { NextRequest, NextResponse } from "next/server";
import { callTool } from "@/lib/tools";

// ── Dispatcher ───────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { tool_name?: unknown; parameters?: unknown };
  try {
    body = (await req.json()) as { tool_name?: unknown; parameters?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  const { tool_name, parameters } = body;

  if (!tool_name || typeof tool_name !== "string") {
    return NextResponse.json({ error: "tool_name is required" }, { status: 400 });
  }

  const params =
    parameters && typeof parameters === "object" && !Array.isArray(parameters)
      ? (parameters as Record<string, unknown>)
      : {};

  try {
    const result = await callTool(tool_name, params);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tool execution failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
