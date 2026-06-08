// 👉 EXAMPLE TOOL #2 — a filesystem server over stdio.
//
// This is the second built-in tool (the agent gets it automatically). Where
// weather.ts shows a tool that calls an external API, THIS shows a tool that does
// real local work — reading and writing files — and how to do it SAFELY.
//
// It's scoped to one folder, passed as a command-line argument:
//     node filesystem.js /some/folder      (sub passes this for you)
// Every path the agent gives us is resolved against that root and rejected if it
// tries to escape (no `../../etc/passwd`). That path check is the important lesson:
// never trust a path that came from a model or a user.
//
// Reminder: stdin/stdout is the protocol channel — never console.log here.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// The folder we're allowed to touch (argv[2]), or the current dir as a fallback.
const ROOT = resolve(process.argv[2] ?? process.cwd());

// Resolve a user-supplied path against ROOT and refuse anything that escapes it.
function safePath(p: string): string {
  const abs = resolve(ROOT, p);
  const rel = relative(ROOT, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`"${p}" is outside the allowed folder.`);
  }
  return abs;
}

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });

const server = new McpServer({ name: "filesystem", version: "1.0.0" });

server.registerTool(
  "list_directory",
  {
    description: "List the files and folders in a directory (relative to the project root).",
    inputSchema: { path: z.string().default(".").describe("directory path, e.g. '.' or 'src'") },
  },
  async ({ path }) => {
    const entries = await readdir(safePath(path), { withFileTypes: true });
    const lines = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
    return text(lines.join("\n") || "(empty)");
  },
);

server.registerTool(
  "read_file",
  {
    description: "Read a UTF-8 text file and return its contents.",
    inputSchema: { path: z.string().describe("file path, e.g. 'README.md'") },
  },
  async ({ path }) => text(await readFile(safePath(path), "utf-8")),
);

server.registerTool(
  "write_file",
  {
    description: "Write (or overwrite) a UTF-8 text file.",
    inputSchema: { path: z.string(), content: z.string() },
  },
  async ({ path, content }) => {
    await writeFile(safePath(path), content, "utf-8");
    return text(`Wrote ${content.length} chars to ${path}.`);
  },
);

await server.connect(new StdioServerTransport());
