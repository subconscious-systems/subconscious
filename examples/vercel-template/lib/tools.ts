/**
 * Tool definitions passed to the Subconscious agent.
 *
 * Subconscious supports two kinds of tools:
 *
 *   Platform tools — hosted by Subconscious, referenced by ID.
 *     Example: { type: "platform", id: "web_search" }
 *     Full list: https://docs.subconscious.dev/tools/platform
 *
 *   Self-hosted (function) tools — your own HTTP endpoints.
 *     All self-hosted tools share a single dispatch endpoint at
 *     /api/tools. Subconscious POSTs { tool_name, parameters }
 *     and the dispatcher routes to the right handler.
 *
 * To add a new tool:
 *   1. Add a handler in app/api/tools/route.ts
 *   2. Add the tool definition to getSelfHostedTools() below
 *   3. Add it to lib/tool-registry.ts so the UI sidebar shows it
 */

import type { Tool } from "subconscious";

function getBaseUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.VERCEL_URL)
    return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

export const platformTools: Tool[] = [
  { type: "platform", id: "web_search", options: {} },
];

export function getSelfHostedTools(): Tool[] {
  const base = getBaseUrl();
  const url = `${base}/api/tools`;
  const isDev = !process.env.VERCEL_URL;
  const tunnelHeaders = isDev
    ? { "Bypass-Tunnel-Reminder": "true" }
    : undefined;

  return [
    {
      type: "function",
      name: "Calculator",
      description:
        "Evaluate a mathematical expression and return the numeric result",
      url,
      method: "POST",
      timeout: 10,
      ...(tunnelHeaders && { headers: tunnelHeaders }),
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
      ...(tunnelHeaders && { headers: tunnelHeaders }),
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

    // ── Add your own tools here ──────────────────────────────
    // All tools share the same dispatch URL. Just add a matching
    // handler in app/api/tools/route.ts.
  ];
}

export function getTools(): Tool[] {
  return [...platformTools, ...getSelfHostedTools()];
}
