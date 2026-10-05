#!/usr/bin/env bash
# ── Subconscious API Gateway — Claude Code leftovers ──────────────────────────
# Claude Code is launch-only: `subc claude` passes everything as env and flags
# and writes nothing. Older persistent setups wrote
# ~/.claude/subconscious-gateway.env; this script reports and removes it.
#
#   subc claude status
#   subc claude uninstall
#
# Claude Code sends native x-claude-code-session-id headers, so the gateway
# correlates requests without help from subc.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

CLAUDE_DIR="${HOME}/.claude"
ENV_FILE="${CLAUDE_DIR}/subconscious-gateway.env"
COMMAND="status"

usage() {
  cat <<'EOF'
Usage:
  subc claude status
  subc claude uninstall
  subc claude help

Claude Code is launch-only: subc claude. Uninstall removes leftover
~/.claude/subconscious-gateway.env from older persistent setup.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    uninstall|status|help)
      COMMAND="$1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

status() {
  echo "scope: user"
  echo "claude dir: $CLAUDE_DIR"
  echo "env file: $ENV_FILE"
  if [[ -f "$ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    echo "gateway: ${ANTHROPIC_BASE_URL:-unset}"
    if [[ -n "${ANTHROPIC_AUTH_TOKEN:-}" ]]; then
      echo "api key: set (${#ANTHROPIC_AUTH_TOKEN} chars)"
    else
      echo "api key: unset"
    fi
    echo "model: ${ANTHROPIC_MODEL:-unset}"
    echo "model picker: ${ANTHROPIC_DEFAULT_OPUS_MODEL_NAME:-unset}, ${ANTHROPIC_DEFAULT_SONNET_MODEL_NAME:-unset}, ${ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME:-unset}"
    echo "max concurrent subagents: ${CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS:-unset}"
    echo "max subagent spawn depth: ${CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH:-unset}"
    echo "compact window: ${CLAUDE_CODE_AUTO_COMPACT_WINDOW:-unset}"
    echo "max context tokens: ${CLAUDE_CODE_MAX_CONTEXT_TOKENS:-unset}"
  else
    echo "env file: missing"
    echo "Launch Claude with: subc claude"
  fi
}

case "$COMMAND" in
  uninstall)
    rm -f "$ENV_FILE"
    echo "Removed $ENV_FILE"
    ;;
  status)
    status
    ;;
  help)
    usage
    ;;
esac
