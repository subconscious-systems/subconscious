#!/usr/bin/env bash
# Launch Pi with the Subconscious provider configured by `subc pi install`.
# This script is deliberately read-only: it never installs Pi, writes config,
# or updates the persistent integration.

set -euo pipefail

MODEL="${MODEL:-subconscious/glm-5.2}"
PI_DIR="${PI_CODING_AGENT_DIR:-${HOME}/.pi/agent}"
MODELS_JSON="${PI_DIR}/models.json"

if [[ ! -f "$MODELS_JSON" ]] || ! grep -q 'x-subconscious-client' "$MODELS_JSON" 2>/dev/null; then
  echo "Pi is not configured for Subconscious. Run 'subc pi install' first." >&2
  exit 1
fi

if command -v jq >/dev/null 2>&1 && ! jq -e \
  --arg model "$MODEL" \
  '.providers.subconscious.models[]? | select(.id == $model)' \
  "$MODELS_JSON" >/dev/null 2>&1; then
  echo "Model '$MODEL' is not present in the Pi catalog. Run 'subc pi install' to refresh it." >&2
  exit 1
fi

exec pi --provider subconscious --model "$MODEL" "$@"
