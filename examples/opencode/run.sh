#!/usr/bin/env bash
# Run OpenCode on Subconscious. Model: $SUBCONSCIOUS_MODEL (swap freely).
#
# We register Subconscious as a custom provider by injecting an inline config via
# OPENCODE_CONFIG_CONTENT, which OpenCode deep-merges on top of the user's own
# config at startup — nothing is written to ~/.config/opencode, and the key never
# lands on disk. (This is exactly how the Subconscious desktop app wires OpenCode.)
set -euo pipefail
: "${SUBCONSCIOUS_API_KEY:?Set SUBCONSCIOUS_API_KEY — https://subconscious.dev/platform}"

command -v opencode >/dev/null || { echo "Install: npm i -g opencode-ai" >&2; exit 127; }

BASE="${SUBCONSCIOUS_BASE_URL:-https://api.subconscious.dev/v1}"
MODEL="${SUBCONSCIOUS_MODEL:-subconscious/tim-qwen3.6-27b}"

# `tools: true` is required for OpenCode's agentic features (file edits, shell) to
# enable function calling. Model is referenced as <provider>/<model-id>.
OPENCODE_CONFIG_CONTENT=$(cat <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "provider": {
    "subconscious": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Subconscious",
      "options": { "baseURL": "${BASE}", "apiKey": "${SUBCONSCIOUS_API_KEY}" },
      "models": { "${MODEL}": { "name": "Subconscious (${MODEL})", "tools": true } }
    }
  },
  "model": "subconscious/${MODEL}"
}
JSON
)
export OPENCODE_CONFIG_CONTENT
exec opencode "$@"
