#!/usr/bin/env bash
# Fail-open VS Code Copilot hook: announce prompts and auto-compactions to the
# gateway. Never blocks the agent.
# Stdin: VS Code hook JSON. Stdout: permissive JSON for VS Code.
#
# Docs: https://code.visualstudio.com/docs/copilot/customization/hooks
# PreCompact: https://code.visualstudio.com/docs/agents/reference/hooks-reference#precompact
#
# Two events:
#   UserPromptSubmit -> conversation_ensure { conversation_id, prompt }
#                      + conversation_compaction phase "end" when a pending
#                        auto-compact marker exists for this session
#   PreCompact       -> conversation_compaction { conversation_id, phase: start }
#
# Copilot compaction is an LLM request through the Custom Endpoint. There is no
# PostCompact, so PreCompact opens a window and the next UserPromptSubmit closes
# it. That brackets the summarization turn between the two signals.
#
# Known gap: PreCompact does not fire for manual compact. Auto-compact only.
#
# Deliberately NOT registered: SessionStart / SubagentStart / SubagentStop /
# Stop / PreToolUse / PostToolUse. UserPromptSubmit already fires for subagent
# prompts, and subagents are correlated gateway-side from the parent's
# runSubagent tool call.

set -u

CONFIG="${SUBCONSCIOUS_HOOKS_ENV:-${HOME}/.copilot/subconscious-hooks.env}"
if [[ -f "$CONFIG" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG"
fi

GATEWAY_URL="${SUBCONSCIOUS_GATEWAY_URL:-}"
API_KEY="${SUBCONSCIOUS_API_KEY:-}"
PENDING_DIR="${SUBCONSCIOUS_COMPACT_PENDING_DIR:-${HOME}/.copilot/subconscious-compact-pending}"

fail_open() {
  printf '%s\n' '{"continue":true}'
  exit 0
}

post_hook() {
  local payload="$1"
  if [[ -z "$payload" ]]; then
    return 0
  fi
  curl -sS -m 2 \
    -H "Authorization: Bearer ${API_KEY}" \
    -H "Content-Type: application/json" \
    -H "x-subconscious-client: copilot" \
    -d "$payload" \
    "${GATEWAY_URL%/}/v1/agent-hooks" >/dev/null 2>&1 || true
}

pending_path() {
  local session_id="$1"
  # Session ids are opaque strings; keep the filename filesystem-safe.
  local safe
  safe="$(printf '%s' "$session_id" | tr -c 'A-Za-z0-9._-' '_')"
  printf '%s/%s' "$PENDING_DIR" "$safe"
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
  UserPromptSubmit | PreCompact) ;;
  *) fail_open ;;
esac

SESSION_ID="$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)"
if [[ -z "$SESSION_ID" ]]; then
  fail_open
fi

if [[ "$HOOK_EVENT" == "PreCompact" ]]; then
  TRIGGER="$(printf '%s' "$INPUT" | jq -r '.trigger // "auto"' 2>/dev/null || true)"
  # Unique per event; wall clock alone can collide within one second.
  NOW_MS="$(date +%s)-$$-$RANDOM"
  PAYLOAD="$(jq -n \
    --arg conversation_id "$SESSION_ID" \
    --arg hook_event_name "$HOOK_EVENT" \
    --arg trigger "$TRIGGER" \
    --arg dedupe_key "${SESSION_ID}:start:${TRIGGER}:${NOW_MS}" \
    '{
      event: "conversation_compaction",
      conversation_id: $conversation_id,
      phase: "start",
      hook_event_name: $hook_event_name,
      dedupe_key: $dedupe_key,
      metadata: { trigger: $trigger }
    }'
  )"
  post_hook "$PAYLOAD"

  mkdir -p "$PENDING_DIR"
  # Marker tells the next UserPromptSubmit to close this compaction window.
  printf '%s\n' "$NOW_MS" >"$(pending_path "$SESSION_ID")" 2>/dev/null || true
  fail_open
fi

# UserPromptSubmit
PROMPT="$(printf '%s' "$INPUT" | jq -r '.prompt // empty' 2>/dev/null || true)"
CWD="$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)"
WORKSPACE=""
if [[ -n "$CWD" ]]; then
  WORKSPACE="$(basename "$CWD")"
fi

# Nothing to anchor on without a prompt.
if [[ -z "$PROMPT" ]]; then
  fail_open
fi

ENSURE_PAYLOAD="$(jq -n \
  --arg event "conversation_ensure" \
  --arg conversation_id "$SESSION_ID" \
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

# Response body is intentionally ignored: the gateway resolves the VS Code
# session id to its own UUID on every call, so there is no mapping to cache.
post_hook "$ENSURE_PAYLOAD"

MARKER="$(pending_path "$SESSION_ID")"
if [[ -f "$MARKER" ]]; then
  START_TOKEN="$(tr -d '[:space:]' <"$MARKER" 2>/dev/null || true)"
  rm -f "$MARKER" 2>/dev/null || true
  NOW_MS="$(date +%s)-$$-$RANDOM"
  END_PAYLOAD="$(jq -n \
    --arg conversation_id "$SESSION_ID" \
    --arg hook_event_name "$HOOK_EVENT" \
    --arg start_token "${START_TOKEN:-}" \
    --arg dedupe_key "${SESSION_ID}:end:${START_TOKEN:-0}:${NOW_MS}" \
    '{
      event: "conversation_compaction",
      conversation_id: $conversation_id,
      phase: "end",
      hook_event_name: $hook_event_name,
      dedupe_key: $dedupe_key,
      metadata: { closes_start_token: (if $start_token == "" then null else $start_token end) }
        | with_entries(select(.value != null))
    }'
  )"
  post_hook "$END_PAYLOAD"
fi

fail_open
