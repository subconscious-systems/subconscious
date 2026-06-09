#!/usr/bin/env bash
# Run Aider on Subconscious. Model: $SUBCONSCIOUS_MODEL (swap freely).
set -euo pipefail
: "${SUBCONSCIOUS_API_KEY:?Set SUBCONSCIOUS_API_KEY — https://subconscious.dev/platform}"

export OPENAI_API_BASE="${SUBCONSCIOUS_BASE_URL:-https://api.subconscious.dev/v1}"
export OPENAI_API_KEY="$SUBCONSCIOUS_API_KEY"
MODEL="${SUBCONSCIOUS_MODEL:-subconscious/tim-qwen3.6-27b}"

command -v aider >/dev/null || {
  echo "Aider not found. Install (isolated, avoids system-Python issues):" >&2
  echo "  python -m pip install aider-install && aider-install   # official" >&2
  echo "  uv tool install aider-chat                             # or via uv" >&2
  exit 127
}
exec aider --model "openai/$MODEL" "$@"
