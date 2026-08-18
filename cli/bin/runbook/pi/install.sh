#!/usr/bin/env bash
# ── Subconscious API Gateway — Pi setup ───────────────────────────────────────
# Point the Pi CLI at your gateway. Writes a model config with session headers
# so the gateway can correlate Pi requests into Conversations.
#
# Quick start:
#   ./install.sh --gateway-url https://your-gateway.example --api-key sk-gw-...
#   ./install.sh status                 # show current config
#   ./install.sh uninstall              # revert to default model config
#
# Writes ~/.pi/agent/models.json (user config). Restart Pi after install.
#
# ── What this does under the hood ────────────────────────────────────────────
# Equivalent manual setup (writes ~/.pi/agent/models.json):
#
#   {
#     "providers": {
#       "subconscious": {
#         "baseUrl": "https://your-gateway.example/v1",
#         "api": "openai-completions",
#         "apiKey": "sk-gw-...",
#         "headers": { "x-subconscious-client": "pi" },
#         "models": [{
#           "id": "subconscious/glm-5.2",
#           "contextWindow": 5000000,
#           "maxTokens": 65536,
#           "compat": {
#             "sendSessionAffinityHeaders": true,
#             "sessionAffinityFormat": "openai-nosession"
#           }
#         }]
#       }
#     }
#   }
#
# The compat flags make Pi send x-session-affinity headers (openai-nosession)
# so the gateway groups requests into Conversations.
#
# Also installs ~/.pi/agent/extensions/subconscious-compaction.ts so Pi reports
# session_before_compact / session_compact to /v1/agent-hooks. Pi summarizes
# through the configured provider; without the extension that turn looks like
# a normal main-thread peak.
# Docs: https://pi.dev/docs/latest/compaction
#       https://pi.dev/docs/latest/extensions
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_SRC="${SCRIPT_DIR}/subconscious-compaction.ts"

# Load shared env from SUBC_ENV_FILE, or a sibling .env / env.example.
SHARED_ENV="${SUBC_ENV_FILE:-${SCRIPT_DIR}/../.env}"
[[ -f "$SHARED_ENV" ]] || SHARED_ENV="${SCRIPT_DIR}/../env.example"
if [[ -f "$SHARED_ENV" ]]; then set -a; source "$SHARED_ENV"; set +a; fi

COMMAND="install"
GATEWAY_URL="${GATEWAY_URL:-}"
API_KEY="${PI_API_KEY:-${API_KEY:-}}"
MODEL="${MODEL:-subconscious/glm-5.2}"
CONTEXT_WINDOW="${PI_CONTEXT_WINDOW:-5000000}"
MAX_TOKENS="${PI_MAX_TOKENS:-65536}"

usage() {
  cat <<'EOF'
Usage:
  subc pi install [--gateway-url URL] [--api-key KEY] [--model MODEL]
             [--context-window N] [--max-tokens N]
  subc pi uninstall
  subc pi status

Merges a Subconscious provider into ~/.pi/agent/models.json without replacing
other providers. Launch Pi with subc pi after install.

Requires: jq. Restart Pi after install (or /reload for the extension).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    install|uninstall|status)
      COMMAND="$1"
      shift
      ;;
    --gateway-url)
      GATEWAY_URL="${2:-}"
      shift 2
      ;;
    --api-key)
      API_KEY="${2:-}"
      shift 2
      ;;
    --model)
      MODEL="${2:-}"
      shift 2
      ;;
    --context-window)
      CONTEXT_WINDOW="${2:-}"
      shift 2
      ;;
    --max-tokens)
      MAX_TOKENS="${2:-}"
      shift 2
      ;;
    -h|--help|help)
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

MODEL_ENTRIES_JSON=""
for model_id in "${SUPPORTED_MODELS[@]}"; do
  model_json="{\"id\":\"${model_id}\",\"contextWindow\":${CONTEXT_WINDOW},\"maxTokens\":${MAX_TOKENS},\"compat\":{\"sendSessionAffinityHeaders\":true,\"sessionAffinityFormat\":\"openai-nosession\"}}"
  if [[ -n "$MODEL_ENTRIES_JSON" ]]; then
    MODEL_ENTRIES_JSON="${MODEL_ENTRIES_JSON},${model_json}"
  else
    MODEL_ENTRIES_JSON="$model_json"
  fi
done

PI_DIR="${HOME}/.pi/agent"
MODELS_JSON="${PI_DIR}/models.json"
EXTENSIONS_DIR="${PI_DIR}/extensions"
EXTENSION_DST="${EXTENSIONS_DIR}/subconscious-compaction.ts"
ENV_FILE="${PI_DIR}/subconscious.env"
MARKER='x-subconscious-client'

require_cmds() {
  local missing=0
  for c in jq; do
    if ! command -v "$c" >/dev/null 2>&1; then
      echo "missing required command: $c" >&2
      missing=1
    fi
  done
  if [[ "$missing" -ne 0 ]]; then
    exit 1
  fi
}

write_config() {
  mkdir -p "$PI_DIR"
  local base_url="${GATEWAY_URL%/}/v1"
  local provider
  provider=$(cat <<EOF
{
  "baseUrl": "${base_url}",
  "api": "openai-completions",
  "apiKey": "${API_KEY}",
  "headers": {
    "x-subconscious-client": "pi"
  },
  "models": [${MODEL_ENTRIES_JSON}]
}
EOF
)
  if [[ -f "$MODELS_JSON" ]]; then
    local tmp
    tmp="$(mktemp)"
    jq --argjson provider "$provider" '
      .providers = (.providers // {})
      | .providers.subconscious = $provider
    ' "$MODELS_JSON" >"$tmp"
    mv "$tmp" "$MODELS_JSON"
  else
    jq -n --argjson provider "$provider" '{providers: {subconscious: $provider}}' >"$MODELS_JSON"
  fi
  chmod 600 "$MODELS_JSON"

  umask 077
  cat >"$ENV_FILE" <<EOF
# Generated by subc — do not commit secrets.
# Loaded by subconscious-compaction.ts if process env is unset.
export SUBCONSCIOUS_GATEWAY_URL='${GATEWAY_URL%/}'
export SUBCONSCIOUS_API_KEY='${API_KEY}'
EOF
  chmod 600 "$ENV_FILE"
}

write_extension() {
  if [[ ! -f "$EXTENSION_SRC" ]]; then
    echo "warning: ${EXTENSION_SRC} missing; skipping compaction extension" >&2
    return
  fi
  mkdir -p "$EXTENSIONS_DIR"
  cp "$EXTENSION_SRC" "$EXTENSION_DST"
}

uninstall_config() {
  if [[ -f "$MODELS_JSON" ]]; then
    local tmp
    tmp="$(mktemp)"
    jq 'del(.providers.subconscious)' "$MODELS_JSON" >"$tmp"
    mv "$tmp" "$MODELS_JSON"
    echo "Removed Subconscious provider from $MODELS_JSON"
  else
    echo "No Pi models.json at $MODELS_JSON"
  fi
  rm -f "$EXTENSION_DST" "$ENV_FILE"
}

status() {
  echo "scope: user"
  echo "pi dir: $PI_DIR"
  echo "config: $MODELS_JSON"
  if [[ -f "$MODELS_JSON" ]] && grep -q "$MARKER" "$MODELS_JSON" 2>/dev/null; then
    echo "status: installed"
    echo "models: $(jq -r '[.providers.subconscious.models[].id] | join(", ")' "$MODELS_JSON" 2>/dev/null || echo 'unknown')"
    echo "contextWindow: $(jq -r '.providers.subconscious.models[0].contextWindow // "unset"' "$MODELS_JSON" 2>/dev/null || echo 'unknown')"
  else
    echo "status: not installed"
  fi
  if [[ -f "$EXTENSION_DST" ]]; then
    echo "compaction extension: $EXTENSION_DST (installed)"
  else
    echo "compaction extension: not installed"
  fi
  if [[ -f "$ENV_FILE" ]]; then
    echo "env: $ENV_FILE (present)"
  else
    echo "env: missing"
  fi
}

case "$COMMAND" in
  install)
    require_cmds
    if [[ -z "$GATEWAY_URL" || -z "$API_KEY" ]]; then
      echo "--gateway-url and --api-key are required for install" >&2
      exit 1
    fi
    write_config
    write_extension
    echo "Merged Subconscious Pi provider into $MODELS_JSON"
    if [[ -f "$EXTENSION_DST" ]]; then
      echo "Installed compaction reporting extension at $EXTENSION_DST"
    fi
    echo "Compaction extension reads ${ENV_FILE} automatically (sourcing optional)."
    echo "Restart any running Pi sessions (or /reload for the extension)."
    ;;
  uninstall)
    uninstall_config
    ;;
  status)
    status
    ;;
esac
