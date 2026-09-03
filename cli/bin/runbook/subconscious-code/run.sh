#!/usr/bin/env bash
# Launch Subconscious Code without changing ~/.sc or project settings.

set -euo pipefail

GATEWAY_URL="${GATEWAY_URL:-}"
API_KEY="${SC_API_KEY:-${API_KEY:-}}"
MODEL="${MODEL:-subconscious/glm-5.2}"

if [[ -z "$GATEWAY_URL" || -z "$API_KEY" ]]; then
  echo "error: GATEWAY_URL and API_KEY are required to launch Subconscious Code" >&2
  exit 1
fi

export SC_API_KEY="$API_KEY"
export SC_BASE_URL="${GATEWAY_URL%/}/v1"
export SC_DLR_URL="${GATEWAY_URL%/}"
export SC_DLR_ENABLED=true
export SC_MODEL="$MODEL"

exec sc "$@"
