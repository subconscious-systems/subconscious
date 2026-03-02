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
 *     Subconscious POSTs to the URL you provide, passing the
 *     parameters as JSON. Your endpoint returns a JSON result.
 *
 * To add a new tool:
 *   1. Create the endpoint at app/api/tools/<name>/route.ts
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

  return [
    {
      type: "function",
      name: "Calculator",
      description:
        "Evaluate a mathematical expression and return the numeric result",
      url: `${base}/api/tools/calculator`,
      method: "POST",
      timeout: 5,
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
      url: `${base}/api/tools/web-reader`,
      method: "POST",
      timeout: 10,
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
    //
    // {
    //   type: "function",
    //   name: "MyTool",
    //   description: "What the tool does",
    //   url: `${base}/api/tools/my-tool`,
    //   method: "POST",
    //   timeout: 10,
    //   parameters: {
    //     type: "object",
    //     properties: {
    //       query: { type: "string", description: "..." },
    //     },
    //     required: ["query"],
    //   },
    // },
  ];
}

export function getTools(): Tool[] {
  return [...platformTools, ...getSelfHostedTools()];
}
