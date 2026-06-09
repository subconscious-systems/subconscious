#!/usr/bin/env bash
# Run Claude Code on Subconscious. Model: $SUBCONSCIOUS_MODEL (swap freely).
set -euo pipefail
: "${SUBCONSCIOUS_API_KEY:?Set SUBCONSCIOUS_API_KEY — https://subconscious.dev/platform}"

export ANTHROPIC_BASE_URL="${SUBCONSCIOUS_ANTHROPIC_URL:-https://api.subconscious.dev}"
export ANTHROPIC_AUTH_TOKEN="$SUBCONSCIOUS_API_KEY"
export ANTHROPIC_MODEL="${SUBCONSCIOUS_MODEL:-subconscious/tim-qwen3.6-27b}"
export ANTHROPIC_SMALL_FAST_MODEL="$ANTHROPIC_MODEL"

command -v claude >/dev/null || { echo "Install: npm i -g @anthropic-ai/claude-code" >&2; exit 127; }
exec claude "$@"
