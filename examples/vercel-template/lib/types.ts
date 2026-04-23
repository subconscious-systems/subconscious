/**
 * Shared types for Subconscious agent requests and responses.
 */

import type { ReasoningTask } from "subconscious";

export interface AgentRequest {
  message: string;
  conversationHistory?: ChatMessage[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentResponse {
  answer: string;
  runId: string;
  toolCalls?: ToolCallInfo[];
}

export interface ToolCallInfo {
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
}

/**
 * The Subconscious SDK takes a single `instructions` string, not a
 * messages array. This helper flattens chat history into one prompt.
 */
export function buildInstructions(
  message: string,
  history?: ChatMessage[],
): string {
  if (!history?.length) return message;

  const conversation = history
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  return `${conversation}\n\nUser: ${message}\n\nRespond to the user's latest message.`;
}

/** Recursively walk the reasoning tree and collect every tool invocation. */
export function extractToolCalls(reasoning?: ReasoningTask[]): ToolCallInfo[] {
  if (!reasoning) return [];
  const calls: ToolCallInfo[] = [];

  function traverse(node: ReasoningTask) {
    const tu = node.tooluse;
    if (tu?.tool_name) {
      calls.push({
        name: tu.tool_name,
        input: tu.parameters ?? {},
        output: tu.tool_result,
      });
    }
    for (const sub of node.subtasks ?? []) {
      traverse(sub);
    }
  }

  for (const node of reasoning) traverse(node);
  return calls;
}
