/**
 * Shared types for Subconscious agent requests and responses.
 */

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

/**
 * The reasoning tree that Subconscious returns after a run.
 *
 * Each node represents one step the agent took:
 *   - title:      what the agent is doing ("Research the topic")
 *   - thought:    its internal reasoning
 *   - tooluse:    tools it called and their results
 *   - subtask:    nested sub-steps (the agent breaking the problem down)
 *   - conclusion: the step's outcome
 */
export interface ReasoningNode {
  title?: string;
  thought?: string;
  tooluse?: Array<{
    tool_name?: string;
    parameters?: Record<string, unknown>;
    tool_result?: unknown;
  }>;
  subtask?: ReasoningNode[];
  conclusion?: string;
}

/** Recursively walk the reasoning tree and collect every tool invocation. */
export function extractToolCalls(reasoning?: ReasoningNode): ToolCallInfo[] {
  if (!reasoning) return [];
  const calls: ToolCallInfo[] = [];

  function traverse(node: ReasoningNode) {
    for (const tu of node.tooluse ?? []) {
      if (tu.tool_name) {
        calls.push({
          name: tu.tool_name,
          input: tu.parameters ?? {},
          output: tu.tool_result,
        });
      }
    }
    for (const sub of node.subtask ?? []) {
      traverse(sub);
    }
  }

  traverse(reasoning);
  return calls;
}
