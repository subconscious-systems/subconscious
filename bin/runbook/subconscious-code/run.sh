#!/usr/bin/env bash
# Launch Marathon without changing ~/.sc or project settings.

set -euo pipefail

HEADLESS_PROMPT=""
if [[ "${1:-}" == "headless" ]]; then
  if [[ -z "${2:-}" || "$2" == "-h" || "$2" == "--help" ]]; then
    echo "usage: subc marathon headless PROMPT [args...]" >&2
    exit 2
  fi
  HEADLESS_PROMPT="$2"
  shift 2
  # Headless takes no input; an open stdin can leave the agent waiting for EOF.
  exec </dev/null
fi

GATEWAY_URL="${GATEWAY_URL:-}"
API_KEY="${SC_API_KEY:-${API_KEY:-}}"
MODEL="${MODEL:-subconscious/glm-5.3-marathon}"

if [[ -z "$GATEWAY_URL" || -z "$API_KEY" ]]; then
  echo "error: GATEWAY_URL and API_KEY are required to launch Marathon" >&2
  exit 1
fi

export SC_API_KEY="$API_KEY"
export SC_BASE_URL="${GATEWAY_URL%/}/v1"
export SC_DLR_URL="${GATEWAY_URL%/}"
export SC_DLR_ENABLED=true
export SC_MODEL="$MODEL"

if [[ -n "$HEADLESS_PROMPT" ]]; then
  # The = form keeps a prompt that starts with "-" from parsing as a flag.
  exec marathon "--print=${HEADLESS_PROMPT}" "$@"
fi
exec marathon "$@"
