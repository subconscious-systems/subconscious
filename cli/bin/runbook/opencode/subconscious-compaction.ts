/**
 * Report OpenCode compactions to the Subconscious API Gateway.
 *
 * Why this exists: OpenCode summarizes by issuing an ordinary completion through the
 * configured provider, which is the gateway, carrying the same session headers as every
 * other turn. Without a signal the gateway would count that summarization as the largest
 * main-thread turn of the conversation, inflating peak context and the traditional
 * comparison at exactly the turn where accuracy matters most.
 *
 * Two callbacks bracket it:
 *   experimental.session.compacting -> phase "start" (awaited, so it is ordered before
 *                                     the summarization request reaches the gateway)
 *   session.compacted event         -> phase "end"
 *
 * Requests between them are the compaction. `sessionID` is the same value OpenCode sends
 * as x-session-affinity / x-session-id, which is already the gateway's grouping key, so
 * no fingerprinting is involved.
 *
 * Fail open: a gateway that is down or slow must never disturb a coding session.
 *
 * Install: copy to ~/.config/opencode/plugins/ (global) or .opencode/plugins/ (project).
 * `opencode/install.sh` does this for you.
 */

import type { Plugin } from "@opencode-ai/plugin"

const TIMEOUT_MS = 2000

function gatewayUrl(): string | undefined {
  const raw = process.env.SUBCONSCIOUS_GATEWAY_URL ?? process.env.GATEWAY_URL
  return raw ? raw.replace(/\/+$/, "") : undefined
}

function apiKey(): string | undefined {
  return process.env.SUBCONSCIOUS_API_KEY ?? process.env.API_KEY
}

async function report(
  sessionID: string,
  phase: "start" | "end",
  hookEventName: string,
): Promise<void> {
  const url = gatewayUrl()
  const key = apiKey()
  if (!url || !key || !sessionID) return

  // Idempotency key for this one event. It must be unique per compaction but stable for
  // a redelivery of this same POST, so it is derived from the wall clock rather than any
  // in-process counter: a counter resets when OpenCode restarts, and a resumed session
  // compacting again would then reuse a key the gateway has already seen and silently
  // drop the signal. Computed once here, before the request, so a transport-level retry
  // carries the identical body.
  const dedupeKey = `${sessionID}:${phase}:${Date.now()}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    await fetch(`${url}/v1/agent-hooks`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        "x-subconscious-client": "opencode",
      },
      body: JSON.stringify({
        event: "conversation_compaction",
        conversation_id: sessionID,
        phase,
        hook_event_name: hookEventName,
        dedupe_key: dedupeKey,
      }),
      signal: controller.signal,
    })
  } catch {
    // Fail open on timeout, offline gateway, or auth failure.
  } finally {
    clearTimeout(timer)
  }
}

export const SubconsciousCompaction: Plugin = async () => {
  return {
    "experimental.session.compacting": async (input) => {
      // Deliberately does not touch `output`: mutating `context` would change the
      // customer's compaction prompt, and setting `prompt` would replace it entirely.
      await report(input.sessionID, "start", "session.compacting")
    },
    event: async ({ event }) => {
      if (event.type === "session.compacted") {
        const sessionID = (event as { properties?: { sessionID?: string } }).properties
          ?.sessionID
        if (sessionID) {
          // No shared id with the matching `start` is needed: the gateway pairs a start
          // with the next end by server-stamped time, not by key.
          await report(sessionID, "end", "session.compacted")
        }
      }
    },
  }
}
