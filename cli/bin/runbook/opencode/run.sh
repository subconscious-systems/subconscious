#!/usr/bin/env bash
# Point OpenCode at the Subconscious gateway — ephemerally.
#
# Exports SUBCONSCIOUS_API_KEY and OPENCODE_CONFIG_CONTENT as env vars so
# nothing is written to ~/.opencode/opencode.json. OpenCode reads the
# config from the OPENCODE_CONFIG_CONTENT env var at startup.
#
# Usage:
#   ./run.sh                         # uses GATEWAY_URL/API_KEY from ../.env
#   ./run.sh -- auth                 # pass args through to opencode
#
# Config: copy ../env.example to ../.env and edit. .env is gitignored.
# Profile env is injected by subc. A sibling .env is only used when SUBC_ENV_FILE is unset.
#
# Or source it to just export the env:
#   source run.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load shared env from SUBC_ENV_FILE, or a sibling .env / env.example.
SHARED_ENV="${SUBC_ENV_FILE:-${SCRIPT_DIR}/../.env}"
[[ -f "$SHARED_ENV" ]] || SHARED_ENV="${SCRIPT_DIR}/../env.example"
if [[ -f "$SHARED_ENV" ]]; then set -a; source "$SHARED_ENV"; set +a; fi

GATEWAY_URL="${GATEWAY_URL:-}"
API_KEY="${OPENCODE_API_KEY:-${API_KEY:-}}"
MODEL="${MODEL:-subconscious/glm-5.2}"
CONTEXT_LIMIT="${OPENCODE_CONTEXT_LIMIT:-5000000}"
OUTPUT_LIMIT="${OPENCODE_OUTPUT_LIMIT:-65536}"

DEFAULT_SUBCONSCIOUS_MODELS="subconscious/glm-5.2
subconscious/tim-qwen3.6-27b
subconscious/deepseek-v4-flash-marathon"
SUPPORTED_MODELS=()

add_supported_model() {
  local model_id="$1" existing
  [[ -n "$model_id" ]] || return 0
  if [[ ! "$model_id" =~ ^[-A-Za-z0-9._:/+]+$ ]]; then
    echo "error: invalid model id: $model_id" >&2
    exit 1
  fi
  if [[ "${#SUPPORTED_MODELS[@]}" -gt 0 ]]; then
    for existing in "${SUPPORTED_MODELS[@]}"; do
      [[ "$existing" == "$model_id" ]] && return 0
    done
  fi
  SUPPORTED_MODELS+=("$model_id")
}

add_supported_model "$MODEL"
while IFS= read -r model_id; do
  add_supported_model "$model_id"
done <<< "${SUBCONSCIOUS_MODELS:-$DEFAULT_SUBCONSCIOUS_MODELS}"

MODELS_JSON=""
for model_id in "${SUPPORTED_MODELS[@]}"; do
  model_json="\"${model_id}\":{\"name\":\"${model_id}\",\"tools\":true,\"limit\":{\"context\":${CONTEXT_LIMIT},\"output\":${OUTPUT_LIMIT}}}"
  if [[ -n "$MODELS_JSON" ]]; then
    MODELS_JSON="${MODELS_JSON},${model_json}"
  else
    MODELS_JSON="$model_json"
  fi
done

if [[ -z "$GATEWAY_URL" || -z "$API_KEY" ]]; then
  echo "error: GATEWAY_URL and API_KEY must be set in ../.env" >&2
  exit 1
fi

# Parse args (only when executed, not sourced)
PASSTHRU=()
if [[ "${BASH_SOURCE[0]:-$0}" == "${0}" ]]; then
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --)
        shift
        PASSTHRU+=("$@")
        break
        ;;
      *)
        PASSTHRU+=("$1")
        shift
        ;;
    esac
  done
fi

BASE_URL="${GATEWAY_URL%/}/v1"
RUNTIME_PROVIDER_ID="subconscious-cli"

export SUBCONSCIOUS_API_KEY="$API_KEY"
# Compaction reporting needs the plugin on disk; this launch path writes nothing.
export SUBCONSCIOUS_GATEWAY_URL="${GATEWAY_URL%/}"
export OPENCODE_CONFIG_CONTENT=$(cat <<EOF
{"\$schema":"https://opencode.ai/config.json","disabled_providers":["subconscious"],"provider":{"${RUNTIME_PROVIDER_ID}":{"npm":"@ai-sdk/openai-compatible","name":"Subconscious Gateway","options":{"baseURL":"${BASE_URL}","apiKey":"{env:SUBCONSCIOUS_API_KEY}","headers":{"x-subconscious-client":"opencode"}},"models":{${MODELS_JSON}}}},"model":"${RUNTIME_PROVIDER_ID}/${MODEL}"}
EOF
)

# If sourced, just export env and return.
if [[ "${BASH_SOURCE[0]:-$0}" != "${0}" ]]; then
  return 0 2>/dev/null || true
fi

exec opencode ${PASSTHRU[@]+"${PASSTHRU[@]}"}
