#!/usr/bin/env bash
# Refresh the Subconscious provider from the live catalog, then launch Pi.
# Other providers in models.json are preserved.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HEADLESS_PROMPT=""
if [[ "${1:-}" == "headless" ]]; then
  if [[ -z "${2:-}" ]]; then
    echo "usage: subc pi headless PROMPT [args...]" >&2
    exit 2
  fi
  HEADLESS_PROMPT="$2"
  shift 2
fi

GATEWAY_URL="${GATEWAY_URL:-}"
API_KEY="${PI_API_KEY:-${API_KEY:-}}"
MODEL="${MODEL:-subconscious/glm-5.3-marathon}"
PI_DIR="${PI_CODING_AGENT_DIR:-${HOME}/.pi/agent}"
MODELS_JSON="${PI_DIR}/models.json"

if [[ -z "$GATEWAY_URL" || -z "$API_KEY" ]]; then
  echo "error: GATEWAY_URL and API_KEY are required to configure Pi" >&2
  exit 1
fi

"${SCRIPT_DIR}/install.sh" install \
  --gateway-url "$GATEWAY_URL" \
  --api-key "$API_KEY" \
  --model "$MODEL" \
  >/dev/null

if [[ -n "$HEADLESS_PROMPT" ]]; then
  exec pi --provider subconscious --model "$MODEL" --print "$@" "$HEADLESS_PROMPT"
fi
exec pi --provider subconscious --model "$MODEL" "$@"
