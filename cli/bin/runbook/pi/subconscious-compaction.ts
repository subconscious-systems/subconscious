/**
 * Report Pi compactions to the Subconscious API Gateway.
 *
 * Why this exists: Pi summarizes by calling the configured provider (the
 * gateway) with a structured compaction prompt. Without a signal the gateway
 * counts that summarization as the largest main-thread turn, inflating peak
 * context and the traditional comparison at the boundary.
 *
 * Two extension events bracket it:
 *   session_before_compact -> phase "start"
 *   session_compact        -> phase "end"
 *
 * Observational only: never return { cancel } or a custom compaction summary.
 * conversation_id is ctx.sessionManager.getSessionId(), which should match the
 * x-session-affinity value used for conversation grouping when
 * sendSessionAffinityHeaders is enabled (openai-nosession).
 *
 * Capture note (2026-08): Pi compaction/branch-summary requests use a *fresh*
 * routing session id on the wire, so the summarization HTTP call lands in a
 * separate Conversations row. start/end still open the epoch on the parent
 * session via getSessionId(); the boundary charge on the parent may be empty.
 * Split-turn /compact (huge mid-turn) may only drop a few k tokens because
 * keepRecentTokens still retains most of the active turn.
 *
 * Fail open: a gateway that is down or slow must never disturb a coding session.
 *
 * Install: copy to ~/.pi/agent/extensions/ (global). `pi/install.sh` does this.
 * Credentials: process env, or ~/.pi/agent/subconscious.env (loaded here so
 * launching Pi without `source` still works).
 * Docs: https://pi.dev/docs/latest/compaction
 *       https://pi.dev/docs/latest/extensions
 */

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const TIMEOUT_MS = 2000

type CompactPhase = "start" | "end"

let envFileLoaded = false

function loadSubconsciousEnvFile(): void {
  if (envFileLoaded) return
  envFileLoaded = true
  if (process.env.SUBCONSCIOUS_GATEWAY_URL && process.env.SUBCONSCIOUS_API_KEY) {
    return
  }
  try {
    const path = join(homedir(), ".pi", "agent", "subconscious.env")
    const text = readFileSync(path, "utf8")
    for (const line of text.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const m = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
      if (!m) continue
      const key = m[1]
      let val = m[2]
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      if (process.env[key] === undefined) {
        process.env[key] = val
      }
    }
  } catch {
    // Missing file or unreadable: fall through to process env / no-op report.
  }
}

function gatewayUrl(): string | undefined {
  loadSubconsciousEnvFile()
  const raw = process.env.SUBCONSCIOUS_GATEWAY_URL ?? process.env.GATEWAY_URL
  return raw ? raw.replace(/\/+$/, "") : undefined
}

function apiKey(): string | undefined {
  loadSubconsciousEnvFile()
  return process.env.SUBCONSCIOUS_API_KEY ?? process.env.API_KEY ?? process.env.PI_API_KEY
}

async function report(
  sessionID: string,
  phase: CompactPhase,
  hookEventName: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const url = gatewayUrl()
  const key = apiKey()
  if (!url || !key || !sessionID) return

  // Unique per event, stable for a transport-level retry of this same POST.
  const dedupeKey = `${sessionID}:${phase}:${Date.now()}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    await fetch(`${url}/v1/agent-hooks`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        "x-subconscious-client": "pi",
      },
      body: JSON.stringify({
        event: "conversation_compaction",
        conversation_id: sessionID,
        phase,
        hook_event_name: hookEventName,
        dedupe_key: dedupeKey,
        metadata: metadata ?? undefined,
      }),
      signal: controller.signal,
    })
  } catch {
    // Fail open on timeout, offline gateway, or auth failure.
  } finally {
    clearTimeout(timer)
  }
}

// Pi auto-discovers default-exported extension factories from
// ~/.pi/agent/extensions/*.ts. See https://pi.dev/docs/latest/extensions
export default function (pi: {
  on: (event: string, handler: (...args: any[]) => any) => void
}) {
  pi.on("session_before_compact", async (event: any, ctx: any) => {
    const sessionID = ctx?.sessionManager?.getSessionId?.()
    if (sessionID) {
      await report(sessionID, "start", "session_before_compact", {
        reason: event?.reason ?? null,
        tokens_before: event?.preparation?.tokensBefore ?? null,
      })
    }
    // Deliberately return nothing: do not cancel or replace summarization.
  })

  pi.on("session_compact", async (event: any, ctx: any) => {
    const sessionID = ctx?.sessionManager?.getSessionId?.()
    if (sessionID) {
      await report(sessionID, "end", "session_compact", {
        reason: event?.reason ?? null,
        from_extension: event?.fromExtension ?? null,
      })
    }
  })
}
