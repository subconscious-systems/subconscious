#!/usr/bin/env bash
# Fail-open VS Code Copilot hook: announce each prompt to the gateway. Never
# blocks the agent.
# Stdin: VS Code hook JSON. Stdout: permissive JSON for VS Code.
#
# Docs: https://code.visualstudio.com/docs/copilot/customization/hooks
#
# One event:
#   UserPromptSubmit -> conversation_ensure { conversation_id, prompt }
#
# The gateway fingerprints this prompt to chain Copilot turns into one
# conversation. The hook stays until a capture proves that turn chaining
# survives Copilot auto-compaction without it.
#
# Deliberately NOT registered: PreCompact, SessionStart, SubagentStart,
# SubagentStop, Stop, PreToolUse, PostToolUse. The gateway does not track
# compactions or subagents, so they need no hook.

set -u

CONFIG="${SUBCONSCIOUS_HOOKS_ENV:-${HOME}/.copilot/subconscious-hooks.env}"
if [[ -f "$CONFIG" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG"
fi

GATEWAY_URL="${SUBCONSCIOUS_GATEWAY_URL:-}"
API_KEY="${SUBCONSCIOUS_API_KEY:-}"

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
if [[ "$HOOK_EVENT" != "UserPromptSubmit" ]]; then
  fail_open
fi

SESSION_ID="$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)"
if [[ -z "$SESSION_ID" ]]; then
  fail_open
fi

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

fail_open
