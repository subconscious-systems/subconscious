/**
 * Client-side tool metadata for the sidebar UI.
 *
 * When you add a tool in lib/tools.ts, add a matching entry here
 * so it shows up in the sidebar. The `name` must match exactly.
 */

export interface RegisteredTool {
  name: string;
  description: string;
  type: "platform" | "self-hosted";
}

export const TOOL_REGISTRY: RegisteredTool[] = [
  {
    name: "web_search",
    description: "Search the web for information",
    type: "platform",
  },
  {
    name: "Calculator",
    description: "Evaluate mathematical expressions",
    type: "self-hosted",
  },
  {
    name: "WebReader",
    description: "Fetch and read webpage content",
    type: "self-hosted",
  },
];
