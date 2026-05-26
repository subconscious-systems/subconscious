// 👉 THE AGENT'S TOOLS LIVE HERE — this one list is everything the agent can do.
//
// To add a tool:
//   • local: write a server in this folder (copy weather.ts), then add a line below.
//   • hosted: add a `serverFromUrl(...)` line (import it from ../lib/servers.js).
// Rebuild (or `npm run dev`) and it's live.

import { bundledToolServer, type McpServer } from "../lib/servers.js";

/** Every tool server the agent connects to. `dir` is the folder filesystem can touch. */
export function builtinTools(dir: string): McpServer[] {
  return [
    bundledToolServer("filesystem", "filesystem", [dir]), // → src/tools/filesystem.ts
    bundledToolServer("weather", "weather"), //               → src/tools/weather.ts

    // 👉 Add yours here, e.g.:
    //   bundledToolServer("mine", "myTool"),                     // your src/tools/myTool.ts
    //   serverFromUrl("https://mcp.deepwiki.com/mcp"),           // a hosted server (add the import)
    //   serverFromUrl("https://api.githubcopilot.com/mcp", "github", "ghp_token"), // ...with auth
  ];
}
