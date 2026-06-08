// The model client. Subconscious speaks the OpenAI Chat Completions protocol, so
// we point the official `openai` SDK at its base URL and we're done. Everything
// downstream (the agent loop) just uses a normal `OpenAI` instance — if you've
// used the OpenAI SDK before, you already know this shape.
//
// Subconscious supports standard OpenAI function tools, but it does NOT execute
// them — so the agent loop runs the tool calls itself (against MCP servers). See
// `agent/loop.ts` and the README section "How tools work" for the full story.

import OpenAI from "openai";
import { type Config, resolveApiKey } from "./config.js";

export function createClient(config: Config): OpenAI {
  return new OpenAI({
    apiKey: resolveApiKey(config),
    baseURL: config.baseUrl,
  });
}
