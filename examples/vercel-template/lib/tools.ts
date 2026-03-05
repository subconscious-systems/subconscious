/**
 * Tool definitions using the Subconscious SDK types directly.
 *
 * To add a tool:
 *   - Function tool: add a FunctionTool entry + handler in app/api/tools/route.ts
 *   - Platform tool: add a PlatformTool entry (hosted by Subconscious)
 *   - MCP tool:      add an McpTool entry pointing at any MCP server
 */

import type { Tool } from "subconscious";

function getBaseUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.VERCEL_URL)
    return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

export function getTools(): Tool[] {
  const base = getBaseUrl();
  const url = `${base}/api/tools`;
  const isDev = !process.env.VERCEL_URL;

  return [
    // ── Platform tools (built-in to Subconscious) ──────────
    { type: "platform", id: "web_search", options: {} },

    // ── Self-hosted tools (your custom tools) ──────────────

    {
      type: "function",
      name: "Calculator",
      description:
        "Evaluate a mathematical expression and return the numeric result",
      url,
      method: "POST",
      timeout: 10,
      ...(isDev && { headers: { "Bypass-Tunnel-Reminder": "true" } }),
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description:
              "Mathematical expression to evaluate, e.g. '(12 + 8) * 3'",
          },
        },
        required: ["expression"],
      },
    },

    {
      type: "function",
      name: "WebReader",
      description:
        "Fetch a webpage URL and return its text content (title + body)",
      url,
      method: "POST",
      timeout: 10,
      ...(isDev && { headers: { "Bypass-Tunnel-Reminder": "true" } }),
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description:
              "Fully qualified URL to read, e.g. https://example.com",
          },
        },
        required: ["url"],
      },
    },

    // ── MCP tools (any MCP-compatible server) ──────────────
    //
    // { type: "mcp", url: "https://mcp.example.com" },
    // { type: "mcp", url: "https://mcp.example.com", allow: ["query_database"] },

    // ┌────────────────────────────────────────────────────────┐
    // │  ADD YOUR TOOLS HERE — copy any shape above.           │
    // └────────────────────────────────────────────────────────┘
  ];
}

/** Sidebar metadata — derived from getTools(). */
export function getToolRegistry() {
  return getTools().map((tool) => {
    if (tool.type === "platform") {
      return { name: tool.id, description: tool.id, type: "platform" as const };
    }
    if (tool.type === "function") {
      return {
        name: tool.name,
        description: tool.description,
        type: "self-hosted" as const,
      };
    }
    const host = new URL(tool.url).host;
    return { name: host, description: `MCP server at ${host}`, type: "mcp" as const };
  });
}
