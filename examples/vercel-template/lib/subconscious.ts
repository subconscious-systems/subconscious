/**
 * Subconscious SDK client (singleton).
 *
 * The SDK provides two ways to run an agent:
 *   - client.run()    → waits for the full result (answer + reasoning tree)
 *   - client.stream() → streams reasoning events as they happen via SSE
 *
 * Get your API key at: https://subconscious.dev/platform
 */

import { Subconscious } from "subconscious";

let client: Subconscious;

export function getClient(): Subconscious {
  if (!client) {
    const apiKey = process.env.SUBCONSCIOUS_API_KEY;
    if (!apiKey) {
      throw new Error(
        "SUBCONSCIOUS_API_KEY is not set. " +
          "Get your key at https://subconscious.dev/platform",
      );
    }
    client = new Subconscious({ apiKey });
  }
  return client;
}
