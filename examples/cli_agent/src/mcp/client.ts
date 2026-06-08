// The MCP manager. Because Subconscious does tool-calling client-side (see
// agent/loop.ts), THIS file is where tools actually come from. It connects to one
// or more MCP servers, flattens their tools into a single list with qualified
// names (`<server>__<tool>`), and runs a tool when the agent asks for it.
//
// To add a new transport, add one branch to `makeTransport`. Nothing else changes.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServer } from "../lib/servers.js";

export interface ToolDefinition {
  qualifiedName: string; // "<server>__<tool>" — what the agent calls it
  server: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON schema, fed to the model verbatim
}

export class McpManager {
  private clients = new Map<string, Client>();
  private toolList: ToolDefinition[] = [];
  // qualifiedName -> which server + raw tool name to invoke
  private toolIndex = new Map<string, { server: string; name: string }>();

  /**
   * Connect to every server, tolerating individual failures. One misconfigured
   * MCP must never take down the REPL — users WILL misconfigure them,
   * so we log to stderr and keep going.
   */
  async connectAll(servers: McpServer[]): Promise<void> {
    await Promise.all(
      servers.map(async (server) => {
        try {
          await this.connect(server);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          process.stderr.write(`⚠  MCP "${server.name}" failed to connect: ${message}\n`);
        }
      }),
    );
  }

  /** Connect to a single server and register its tools. */
  async connect(server: McpServer): Promise<void> {
    const transport = makeTransport(server);
    const client = new Client({ name: "sub", version: "0.1.0" }, { capabilities: {} });
    await client.connect(transport);

    const { tools } = await client.listTools();
    this.clients.set(server.name, client);

    for (const tool of tools) {
      const qualifiedName = `${server.name}__${tool.name}`;
      this.toolList.push({
        qualifiedName,
        server: server.name,
        name: tool.name,
        description: tool.description ?? "",
        inputSchema: (tool.inputSchema as Record<string, unknown>) ?? { type: "object" },
      });
      this.toolIndex.set(qualifiedName, { server: server.name, name: tool.name });
    }
  }

  /** Every available tool, across all connected servers. Returns a fresh array. */
  getTools(): ToolDefinition[] {
    return [...this.toolList];
  }

  /** Run a tool by its qualified name. Throws on unknown tool or tool-reported error. */
  async callTool(qualifiedName: string, args: Record<string, unknown>): Promise<unknown> {
    const entry = this.toolIndex.get(qualifiedName);
    if (!entry) {
      const known = [...this.toolIndex.keys()].join(", ") || "(none)";
      throw new Error(`Unknown tool "${qualifiedName}". Available: ${known}`);
    }
    const client = this.clients.get(entry.server);
    if (!client) throw new Error(`MCP server "${entry.server}" is not connected.`);

    const result = await client.callTool({ name: entry.name, arguments: args });
    if (result.isError) {
      throw new Error(contentToText(result.content) || "tool reported an error");
    }
    // structuredContent is the nicest thing to hand the model when present;
    // otherwise the text/blob content array is fine — the loop JSON-stringifies it.
    return result.structuredContent ?? result.content ?? result;
  }

  /** Close every connection. Safe to call multiple times; never throws. */
  async close(): Promise<void> {
    await Promise.allSettled([...this.clients.values()].map((c) => c.close()));
    this.clients.clear();
    this.toolList = [];
    this.toolIndex.clear();
  }

  serverCount(): number {
    return this.clients.size;
  }

  toolCount(): number {
    return this.toolList.length;
  }
}

// ---------------------------------------------------------------------------
// Transports — one branch per transport kind.
// ---------------------------------------------------------------------------

function makeTransport(server: McpServer): Transport {
  switch (server.transport) {
    case "stdio": {
      if (!server.command) throw new Error(`stdio server "${server.name}" needs a "command".`);
      return new StdioClientTransport({
        command: server.command,
        args: server.args ?? [],
        // Forward a safe default environment merged with any configured vars so
        // the child process keeps $PATH (npx-style commands need it) plus secrets.
        env: { ...getDefaultEnvironment(), ...(server.env ?? {}) },
      });
    }
    case "sse": {
      if (!server.url) throw new Error(`sse server "${server.name}" needs a "url".`);
      return new SSEClientTransport(
        new URL(server.url),
        server.headers ? { requestInit: { headers: server.headers } } : undefined,
      );
    }
    case "http": {
      if (!server.url) throw new Error(`http server "${server.name}" needs a "url".`);
      return new StreamableHTTPClientTransport(
        new URL(server.url),
        server.headers ? { requestInit: { headers: server.headers } } : undefined,
      );
    }
  }
}

function contentToText(content: unknown): string {
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : JSON.stringify(c)))
      .join("\n");
  }
  return typeof content === "string" ? content : JSON.stringify(content);
}
