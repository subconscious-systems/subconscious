#!/usr/bin/env bash
# Fail-open Codex hook: report PreCompact / PostCompact to the gateway.
# Never blocks compaction (do not return continue: false).
#
# Docs: https://developers.openai.com/codex/hooks
#
#   PreCompact  -> conversation_compaction { phase: start }
#   PostCompact -> conversation_compaction { phase: end }
#
# Custom (non-OpenAI-named) providers compact locally through the configured
# Responses endpoint, so the summarization request hits the gateway between
# these two signals. conversation_id is the hook session_id, which Codex
# examples show as thr_… — the same value the gateway uses as thread-id
# grouping. Capture after upgrades if that ever diverges.
#
# Stdin: Codex hook JSON. Stdout: empty success (or {} ). Exit 0 always.

set -u

CONFIG="${SUBCONSCIOUS_HOOKS_ENV:-${HOME}/.codex/subconscious-hooks.env}"
if [[ -f "$CONFIG" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG"
fi
# install.sh also writes subconscious.env with the API key for the CLI.
if [[ -f "${HOME}/.codex/subconscious.env" ]]; then
  # shellcheck disable=SC1090
  source "${HOME}/.codex/subconscious.env"
fi

GATEWAY_URL="${SUBCONSCIOUS_GATEWAY_URL:-}"
API_KEY="${SUBCONSCIOUS_API_KEY:-}"

fail_open() {
  exit 0
}

if [[ -z "$GATEWAY_URL" || -z "$API_KEY" ]]; then
  echo "subconscious codex hook: missing SUBCONSCIOUS_GATEWAY_URL or SUBCONSCIOUS_API_KEY" >&2
  fail_open
fi

for tool in jq curl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "subconscious codex hook: ${tool} is required" >&2
    fail_open
  fi
done

INPUT="$(cat || true)"
if [[ -z "$INPUT" ]]; then
  fail_open
fi

# Local fire-log for capture/debug (never blocks).
FIRE_LOG_DIR="${SUBCONSCIOUS_CODEX_HOOK_LOG_DIR:-${HOME}/.codex/subconscious-hook-logs}"
mkdir -p "$FIRE_LOG_DIR" 2>/dev/null || true

HOOK_EVENT="$(printf '%s' "$INPUT" | jq -r '.hook_event_name // empty' 2>/dev/null || true)"
case "$HOOK_EVENT" in
  PreCompact) PHASE="start" ;;
  PostCompact) PHASE="end" ;;
  *) fail_open ;;
esac

SESSION_ID="$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)"
if [[ -z "$SESSION_ID" ]]; then
  fail_open
fi

{
  printf '%s event=%s session_id=%s payload=' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HOOK_EVENT" "$SESSION_ID"
  printf '%s\n' "$INPUT"
} >>"${FIRE_LOG_DIR}/${SESSION_ID}.log" 2>/dev/null || true

TURN_ID="$(printf '%s' "$INPUT" | jq -r '.turn_id // empty' 2>/dev/null || true)"
TRIGGER="$(printf '%s' "$INPUT" | jq -r '.trigger // empty' 2>/dev/null || true)"
NOW_MS="$(date +%s)-$$-$RANDOM"
if [[ -n "$TURN_ID" ]]; then
  DEDUPE_KEY="${SESSION_ID}:${PHASE}:${TURN_ID}"
else
  DEDUPE_KEY="${SESSION_ID}:${PHASE}:${NOW_MS}"
fi

PAYLOAD="$(jq -n \
  --arg conversation_id "$SESSION_ID" \
  --arg phase "$PHASE" \
  --arg hook_event_name "$HOOK_EVENT" \
  --arg dedupe_key "$DEDUPE_KEY" \
  --arg trigger "$TRIGGER" \
  --arg turn_id "$TURN_ID" \
  '{
    event: "conversation_compaction",
    conversation_id: $conversation_id,
    phase: $phase,
    hook_event_name: $hook_event_name,
    dedupe_key: $dedupe_key,
    metadata: {
      trigger: (if $trigger == "" then null else $trigger end),
      turn_id: (if $turn_id == "" then null else $turn_id end)
    } | with_entries(select(.value != null))
  }'
)"

curl -sS -m 2 \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -H "x-subconscious-client: codex" \
  -d "$PAYLOAD" \
  "${GATEWAY_URL%/}/v1/agent-hooks" >/dev/null 2>&1 || true

fail_open
