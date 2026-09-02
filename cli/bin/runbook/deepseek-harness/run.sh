#!/usr/bin/env bash
# Launch DeepSeek Harness with a temporary Cordis overlay that adds the live
# Subconscious catalog. The user's DSH settings and profiles are not rewritten.

set -euo pipefail

GATEWAY_URL="${GATEWAY_URL:-}"
API_KEY="${DEEPSEEK_HARNESS_API_KEY:-${API_KEY:-}}"
MODEL="${MODEL:-subconscious/glm-5.2}"
CONTEXT_WINDOW="${DEEPSEEK_HARNESS_CONTEXT_WINDOW:-5000000}"
MAX_TOKENS="${DEEPSEEK_HARNESS_MAX_TOKENS:-65536}"

DEFAULT_SUBCONSCIOUS_MODELS="subconscious/glm-5.2
subconscious/tim-qwen3.6-27b
subconscious/deepseek-v4-flash-marathon"

if [[ -z "$GATEWAY_URL" || -z "$API_KEY" ]]; then
  echo "error: GATEWAY_URL and API_KEY are required to launch DeepSeek Harness" >&2
  exit 1
fi
if [[ ! "$CONTEXT_WINDOW" =~ ^[1-9][0-9]*$ ]]; then
  echo "error: DEEPSEEK_HARNESS_CONTEXT_WINDOW must be a positive integer" >&2
  exit 1
fi
if [[ ! "$MAX_TOKENS" =~ ^[1-9][0-9]*$ ]]; then
  echo "error: DEEPSEEK_HARNESS_MAX_TOKENS must be a positive integer" >&2
  exit 1
fi

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

OVERLAY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/subc-dsh.XXXXXX")"
OVERLAY_FILE="${OVERLAY_DIR}/subconscious.cordis.yml"
cleanup() {
  rm -f "$OVERLAY_FILE"
  rmdir "$OVERLAY_DIR" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

{
  printf '%s\n' \
    '# Generated temporarily by subc. Contains no API key.' \
    '- id: llm-pi-ai' \
    '  config:' \
    '    providers:' \
    '      subconscious:' \
    '        apiKeyEnv: SUBCONSCIOUS_API_KEY' \
    '        displayName: Subconscious Gateway' \
    '        api: openai-completions' \
    '        baseURL: !!js process.env.SUBCONSCIOUS_DSH_BASE_URL' \
    '        headers:' \
    '          x-subconscious-client: deepseek-harness' \
    '        compat:' \
    '          supportsDeveloperRole: false' \
    '          maxTokensField: max_tokens' \
    "        defaultContextWindow: ${CONTEXT_WINDOW}" \
    "        defaultMaxTokens: ${MAX_TOKENS}" \
    '        models:'
  for model_id in "${SUPPORTED_MODELS[@]}"; do
    printf "          - id: '%s'\n" "$model_id"
    printf "            name: '%s'\n" "$model_id"
    printf "            contextWindow: %s\n" "$CONTEXT_WINDOW"
    printf "            maxTokens: %s\n" "$MAX_TOKENS"
  done
  printf '%s\n' \
    '- id: agent-default-model' \
    '  config:' \
    '    provider: subconscious' \
    "    model: '${MODEL}'"
} >"$OVERLAY_FILE"
chmod 600 "$OVERLAY_FILE"

export SUBCONSCIOUS_API_KEY="$API_KEY"
export SUBCONSCIOUS_DSH_BASE_URL="${GATEWAY_URL%/}/v1"

mode="web"
if [[ "${1:-}" == "web" || "${1:-}" == "headless" ]]; then
  mode="$1"
  shift
fi

set +e
if [[ "$mode" == "headless" ]]; then
  dsh --profile headless --patch "$OVERLAY_FILE" "$@"
else
  dsh web --patch "$OVERLAY_FILE" "$@"
fi
status=$?
set -e
exit "$status"
