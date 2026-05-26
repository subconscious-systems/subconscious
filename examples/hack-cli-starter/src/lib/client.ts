// The model client. Subconscious speaks the OpenAI Chat Completions protocol, so
// we point the official `openai` SDK at its base URL and we're done. Everything
// downstream (the agent loop) just uses a normal `OpenAI` instance — if you've
// used the OpenAI SDK before, you already know this shape.
//
// Why not server-side tools? The Subconscious endpoint doesn't accept a `tools`
// field, so all tool-calling happens client-side in `agent/loop.ts`. See the
// README section "The constraint" for the full story.

import OpenAI from "openai";
import { type Config, resolveApiKey } from "./config.js";

export function createClient(config: Config): OpenAI {
  return new OpenAI({
    apiKey: resolveApiKey(config),
    baseURL: config.baseUrl,
  });
}
