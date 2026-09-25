#!/usr/bin/env bash
# Fail-open Cursor hook: announce prompts and compactions to the gateway. Never
# blocks the agent.
# Stdin: Cursor hook JSON. Stdout: permissive JSON for Cursor.
#
# Docs: https://cursor.com/docs/hooks
#
# Two events, one call each:
#   beforeSubmitPrompt -> conversation_ensure     { conversation_id, prompt }
#   preCompact         -> conversation_compaction { conversation_id, phase: point }
#
# The gateway fingerprints the raw prompt itself and chains every later turn of
# the conversation onto the first one, so this hook needs no hashing and no local
# state. Cursor cannot inject headers into model HTTP, which is why this
# announcement exists at all.
#
# preCompact is observational and Cursor has no postCompact, so compaction is
# reported as a zero-width "point": the gateway places the context boundary on the
# first following turn whose retained context actually shrinks. Cursor compacts
# mid-turn and keeps working without a new prompt, so a window closed at the next
# beforeSubmitPrompt would wrongly swallow real turns.
#
# Deliberately NOT registered: afterAgentThought / afterAgentResponse /
# preToolUse / stop / subagentStart / subagentStop. Subagents are correlated
# gateway-side from the parent's tool-call prompt. Tool-execution hooks are also
# the ones Cursor is known to emit with an empty conversation_id after a mid-turn
# compaction; conversation-lifecycle hooks like the two above are unaffected.

set -u

CONFIG="${SUBCONSCIOUS_HOOKS_ENV:-${HOME}/.cursor/subconscious-hooks.env}"
if [[ -f "$CONFIG" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG"
fi

GATEWAY_URL="${SUBCONSCIOUS_GATEWAY_URL:-}"
API_KEY="${SUBCONSCIOUS_API_KEY:-}"

# Cursor reads `user_message` on preCompact and a permission object on
# beforeSubmitPrompt, so the reply shape depends on the event.
HOOK_EVENT=""

fail_open() {
  if [[ "$HOOK_EVENT" == "preCompact" ]]; then
    printf '%s\n' '{}'
  else
    printf '%s\n' '{"continue":true,"permission":"allow"}'
  fi
  exit 0
}

if [[ -z "$GATEWAY_URL" || -z "$API_KEY" ]]; then
  echo "subconscious hook: missing SUBCONSCIOUS_GATEWAY_URL or SUBCONSCIOUS_API_KEY" >&2
  fail_open
fi

for tool in jq curl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "subconscious hook: ${tool} is required" >&2
    fail_open
  fi
done

INPUT="$(cat || true)"
if [[ -z "$INPUT" ]]; then
  fail_open
fi

HOOK_EVENT="$(printf '%s' "$INPUT" | jq -r '.hook_event_name // empty' 2>/dev/null || true)"
case "$HOOK_EVENT" in
  beforeSubmitPrompt | preCompact) ;;
  *) fail_open ;;
esac

CONVERSATION_ID="$(printf '%s' "$INPUT" | jq -r '.conversation_id // .session_id // empty' 2>/dev/null || true)"
if [[ -z "$CONVERSATION_ID" ]]; then
  fail_open
fi

if [[ "$HOOK_EVENT" == "preCompact" ]]; then
  # generation_id plus is_first_compaction keeps successive compactions distinct
  # while making a redelivery of the same one idempotent server-side.
  PAYLOAD="$(printf '%s' "$INPUT" | jq -c \
    --arg conversation_id "$CONVERSATION_ID" \
    --arg hook_event_name "$HOOK_EVENT" \
    '{
      event: "conversation_compaction",
      conversation_id: $conversation_id,
      phase: "point",
      hook_event_name: $hook_event_name,
      dedupe_key: ($conversation_id + ":" + ((.generation_id // "gen") | tostring)
                   + ":" + ((.is_first_compaction // false) | tostring)),
      metadata: {
        trigger: .trigger,
        context_tokens: .context_tokens,
        context_window_size: .context_window_size,
        context_usage_percent: .context_usage_percent,
        message_count: .message_count,
        messages_to_compact: .messages_to_compact,
        is_first_compaction: .is_first_compaction
      } | with_entries(select(.value != null))
    }' 2>/dev/null || true)"
else
  PROMPT="$(printf '%s' "$INPUT" | jq -r '.prompt // empty' 2>/dev/null || true)"
  WORKSPACE="$(printf '%s' "$INPUT" | jq -r '(.workspace_roots // [])[0] // empty' 2>/dev/null || true)"
  if [[ -n "$WORKSPACE" ]]; then
    WORKSPACE="$(basename "$WORKSPACE")"
  fi

  # Nothing to anchor on without a prompt.
  if [[ -z "$PROMPT" ]]; then
    fail_open
  fi

  PAYLOAD="$(jq -n \
    --arg event "conversation_ensure" \
    --arg conversation_id "$CONVERSATION_ID" \
    --arg prompt "$PROMPT" \
    --arg workspace "$WORKSPACE" \
    --arg hook_event_name "$HOOK_EVENT" \
    '{
      event: $event,
      conversation_id: $conversation_id,
      prompt: $prompt,
      workspace: (if $workspace == "" then null else $workspace end),
      hook_event_name: $hook_event_name
    } | with_entries(select(.value != null))'
  )"
fi

if [[ -z "$PAYLOAD" ]]; then
  fail_open
fi

# Response body is intentionally ignored: the gateway resolves the Cursor
# conversation id to its own UUID on every call, so there is no mapping to cache.
curl -sS -m 2 \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -H "x-subconscious-client: cursor" \
  -d "$PAYLOAD" \
  "${GATEWAY_URL%/}/v1/agent-hooks" >/dev/null 2>&1 || true

fail_open
