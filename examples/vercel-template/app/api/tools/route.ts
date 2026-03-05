/**
 * ── Tool Handlers & Dispatcher ────────────────────────────────
 *
 * When Subconscious calls one of your self-hosted tools it POSTs
 * { tool_name, parameters, request_id } to this route. The
 * dispatcher at the bottom matches `tool_name` to a handler.
 *
 * HOW TO ADD A HANDLER
 * ────────────────────
 * 1. Write an async function that receives `params` and returns
 *    a plain object. The object is sent back to the agent as
 *    the tool result.
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

// ── Handlers ─────────────────────────────────────────────────

const ALLOWED_EXPR = /^[0-9+\-*/().,%\s\^e]+$/i;

async function calculator(params: Record<string, unknown>) {
  const { expression } = params;
  if (!expression || typeof expression !== "string") {
    return { error: "expression is required" };
  }
  if (!ALLOWED_EXPR.test(expression)) {
    return { error: "Expression contains invalid characters" };
  }
  const normalized = expression.replace(/\^/g, "**");
  const result = new Function(`"use strict"; return (${normalized})`)();
  if (typeof result !== "number" || !isFinite(result)) {
    return { error: "Expression did not produce a finite number" };
  }
  return { result };
}

async function webReader(params: Record<string, unknown>) {
  const { url } = params;
  if (!url || typeof url !== "string") {
    return { error: "url is required" };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "Invalid URL" };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { error: "Only http and https URLs are supported" };
  }
  const res = await fetch(url, {
    headers: { "User-Agent": "SubconsciousAgent/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    return { error: `Fetch failed with status ${res.status}` };
  }
  const html = await res.text();
  const MAX_LENGTH = 8000;
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  const text = stripped.slice(0, MAX_LENGTH);
  const title =
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
  return {
    url: parsed.href,
    title,
    content: text,
    truncated: stripped.length > MAX_LENGTH,
  };
}

// ── Register handlers here (name must match tools.ts) ────────

const handlers: Record<
  string,
  (params: Record<string, unknown>) => Promise<Record<string, unknown>>
> = {
  Calculator: calculator,
  WebReader: webReader,
};

// ── Dispatcher (don't edit below) ────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tool_name, parameters, request_id } = body;

    console.log(`[tool:${tool_name}]`, { parameters, request_id });

    const handler = handlers[tool_name];
    if (!handler) {
      return NextResponse.json(
        { error: `Unknown tool: ${tool_name}` },
        { status: 400 },
      );
    }

    const result = await handler(parameters ?? {});
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Tool execution failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
