/**
 * Shared types for Subconscious agent requests and responses.
 */

import type OpenAI from "openai";

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
  toolCalls?: ToolCallInfo[];
}

export interface ToolCallInfo {
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
}

/**
 * Build an OpenAI-style messages array from chat history + latest message.
 * The Subconscious API is OpenAI Chat Completions compatible.
 */
export function buildMessages(
  message: string,
  history?: ChatMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  for (const turn of history ?? []) {
    messages.push({ role: turn.role, content: turn.content });
  }

  messages.push({ role: "user", content: message });
  return messages;
}
