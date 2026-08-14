/**
 * Subconscious model client.
 *
 * Subconscious speaks the OpenAI Chat Completions protocol, so we point the
 * official `openai` SDK at its base URL and everything downstream just uses
 * a normal `OpenAI` instance.
 */

import OpenAI from "openai";

export const DEFAULT_BASE_URL = "https://api.subconscious.dev/v1";
export const DEFAULT_MODEL = "subconscious/tim-qwen3.6-27b";

/**
 * Resolve the Subconscious API key from the environment.
 * Throws a user-friendly error if no key is found.
 */
export function resolveApiKey(): string {
  const key = process.env.SUBCONSCIOUS_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "No Subconscious API key found.\n" +
        "  • Set the env var:  export SUBCONSCIOUS_API_KEY=your_key\n" +
        "Grab a key at https://www.subconscious.dev/platform",
    );
  }
  return key;
}

/**
 * Create an OpenAI client pointed at the Subconscious API.
 */
export function createClient(): OpenAI {
  return new OpenAI({
    apiKey: resolveApiKey(),
    baseURL: DEFAULT_BASE_URL,
  });
}
