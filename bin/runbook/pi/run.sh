#!/usr/bin/env bash
# Refresh the Subconscious provider from the live catalog, then launch Pi.
# Other providers in models.json are preserved.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HEADLESS_PROMPT=""
if [[ "${1:-}" == "headless" ]]; then
  prompt_text="${2:-}"
  if [[ -z "${prompt_text//[[:space:]]/}" || "$2" == "-h" || "$2" == "--help" ]]; then
    echo "usage: subc pi headless PROMPT [args...]" >&2
    exit 2
  fi
  HEADLESS_PROMPT="$2"
  shift 2
  # Headless takes no input; an open stdin can leave the agent waiting for EOF.
  exec </dev/null
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

# Drop the first "--": everything after it already belongs to the agent.
AGENT_ARGS=()
separator_dropped=false
for arg in "$@"; do
  if [[ "$separator_dropped" == false && "$arg" == "--" ]]; then
    separator_dropped=true
    continue
  fi
  AGENT_ARGS+=("$arg")
done

if [[ -n "$HEADLESS_PROMPT" ]]; then
  # On stdin the prompt is used as-is; as an argument a leading "@" would
  # name a file.
  exec pi --provider subconscious --model "$MODEL" --print ${AGENT_ARGS[@]+"${AGENT_ARGS[@]}"} < <(printf '%s' "$HEADLESS_PROMPT")
fi
exec pi --provider subconscious --model "$MODEL" ${AGENT_ARGS[@]+"${AGENT_ARGS[@]}"}
