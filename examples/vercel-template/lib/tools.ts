/**
 * Client-side tool implementations for the agent ReAct loop.
 *
 * The Subconscious API supports standard OpenAI function tools.
 * Tools are executed here in the agent loop after the model requests them.
 *
 * Add new tools by:
 *   1. Writing an async handler function below
 *   2. Adding an OpenAI.Chat.Completions.ChatCompletionTool entry to OPENAI_TOOLS
 *   3. Adding the handler to TOOL_HANDLERS
 */

import type OpenAI from "openai";

// ─── Types ───────────────────────────────────────────────────────

export interface ToolRegistry {
  name: string;
  description: string;
  type: "local";
}

// ─── Tool implementations ────────────────────────────────────────

const ALLOWED_EXPR = /^[0-9+\-*/().,%\s^e]+$/i;

async function calculator(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { expression } = params;
  if (!expression || typeof expression !== "string") {
    return { error: "expression is required" };
  }
  if (!ALLOWED_EXPR.test(expression)) {
    return { error: "Expression contains invalid characters" };
  }
  const normalized = expression.replace(/\^/g, "**");
  const result = new Function(`"use strict"; return (${normalized})`)() as unknown;
  if (typeof result !== "number" || !isFinite(result)) {
    return { error: "Expression did not produce a finite number" };
  }
  return { result };
}

async function webReader(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
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

// ─── Tool registry ────────────────────────────────────────────────

/**
 * Tool definitions in the standard OpenAI function tool shape.
 * Pass directly to `client.chat.completions.create({ tools: OPENAI_TOOLS })`.
 */
export const OPENAI_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "Calculator",
      description: "Evaluate a mathematical expression and return the numeric result",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "Mathematical expression to evaluate, e.g. '(12 + 8) * 3'",
          },
        },
        required: ["expression"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "WebReader",
      description: "Fetch a webpage URL and return its text content (title + body)",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Fully qualified URL to read, e.g. https://example.com",
          },
        },
        required: ["url"],
      },
    },
  },
];

export const TOOL_HANDLERS: Record<
  string,
  (params: Record<string, unknown>) => Promise<Record<string, unknown>>
> = {
  Calculator: calculator,
  WebReader: webReader,
};

/** Execute a named tool. Returns an error object if the tool is unknown. */
export async function callTool(
  name: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const handler = TOOL_HANDLERS[name];
  if (!handler) {
    return { error: `Unknown tool: ${name}` };
  }
  return handler(params);
}

/** Sidebar metadata derived from OPENAI_TOOLS. */
export function getToolRegistry(): ToolRegistry[] {
  return OPENAI_TOOLS.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description ?? "",
    type: "local" as const,
  }));
}
