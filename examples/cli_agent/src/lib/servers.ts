// Plumbing for tool servers: what a server looks like (McpServer) and two helpers to
// build one. You list which servers the agent gets in src/tools/index.ts — you rarely
// need to edit this file.

import { fileURLToPath } from "node:url";
import { z } from "zod";

// A server definition. `stdio` launches a local program; `sse`/`http` hit a URL.
export const McpServerSchema = z.object({
  name: z.string().min(1),
  transport: z.enum(["stdio", "sse", "http"]),
  command: z.string().optional(), // stdio
  args: z.array(z.string()).optional(), // stdio
  env: z.record(z.string(), z.string()).optional(), // stdio
  url: z.string().optional(), // sse / http
  headers: z.record(z.string(), z.string()).optional(), // sse / http
  enabled: z.boolean().default(true),
});
export type McpServer = z.infer<typeof McpServerSchema>;

/**
 * Launch a bundled tool server from `src/tools/`. Use this to attach a tool you wrote:
 * `bundledToolServer("mine", "myTool")` runs `src/tools/myTool.ts`. We resolve the file
 * relative to this module so it works whether we're running compiled JS (dist/, via
 * `node`) or TS (src/, via `tsx` in `npm run dev`).
 */
export function bundledToolServer(name: string, file: string, extraArgs: string[] = []): McpServer {
  const isTs = import.meta.url.endsWith(".ts");
  const path = fileURLToPath(new URL(`../tools/${file}.${isTs ? "ts" : "js"}`, import.meta.url));
  return {
    name,
    transport: "stdio",
    command: isTs ? "npx" : process.execPath, // `npx tsx file.ts` in dev, `node file.js` when built
    args: isTs ? ["tsx", path, ...extraArgs] : [path, ...extraArgs],
    enabled: true,
  };
}

/**
 * Build a hosted MCP server config from a URL. Transport is inferred: SSE if the path
 * contains "/sse", otherwise streamable HTTP. Pass a `token` for servers that need
 * auth — it's sent as an `Authorization: Bearer <token>` header (GitHub, etc.).
 */
export function serverFromUrl(url: string, name?: string, token?: string): McpServer {
  const headers = token?.trim() ? { Authorization: `Bearer ${token.trim()}` } : undefined;
  return {
    name: name?.trim() || inferNameFromUrl(url),
    transport: url.includes("/sse") ? "sse" : "http",
    url,
    ...(headers && { headers }),
    enabled: true,
  };
}

function inferNameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/[^\w]+/g, "-") || "server";
  } catch {
    return "server";
  }
}
