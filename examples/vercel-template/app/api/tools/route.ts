/**
 * Unified tool dispatcher.
 *
 * Subconscious POSTs { tool_name, parameters, request_id } to a single URL.
 * This route dispatches to the right handler based on tool_name.
 *
 * To add a new tool:
 *   1. Write a handler function below
 *   2. Add it to the `handlers` map
 *   3. Define the tool schema in lib/tools.ts
 *   4. Add it to lib/tool-registry.ts so the sidebar shows it
 */

import { NextRequest, NextResponse } from "next/server";

// ── Tool handlers ────────────────────────────────────────────

type ToolParams = Record<string, unknown>;

const ALLOWED_EXPR = /^[0-9+\-*/().,%\s\^e]+$/i;

async function handleCalculator(params: ToolParams) {
  const { expression } = params as { expression: string };

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

const MAX_LENGTH = 8000;

async function handleWebReader(params: ToolParams) {
  const { url } = params as { url: string };

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

// ── Dispatcher ───────────────────────────────────────────────

const handlers: Record<string, (params: ToolParams) => Promise<Record<string, unknown>>> = {
  Calculator: handleCalculator,
  WebReader: handleWebReader,
};

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
    const message = err instanceof Error ? err.message : "Tool execution failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
