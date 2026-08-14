/**
 * Subconscious OpenAI-compatible client (singleton).
 *
 * Subconscious exposes an OpenAI Chat Completions API at:
 *   https://api.subconscious.dev/v1
 *
 * Use the official `openai` npm package and point `baseURL` at the
 * Subconscious endpoint. The only model is `subconscious/tim-qwen3.6-27b`.
 *
 * Get your API key at: https://subconscious.dev/platform
 */

import OpenAI from "openai";

export const SUBCONSCIOUS_BASE_URL = "https://api.subconscious.dev/v1";
export const SUBCONSCIOUS_MODEL = "subconscious/tim-qwen3.6-27b";

let client: OpenAI | undefined;

export function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.SUBCONSCIOUS_API_KEY;
    if (!apiKey) {
      throw new Error(
        "SUBCONSCIOUS_API_KEY is not set. " +
          "Get your key at https://subconscious.dev/platform",
      );
    }
    client = new OpenAI({
      baseURL: SUBCONSCIOUS_BASE_URL,
      apiKey,
    });
  }
  return client;
}
