#!/usr/bin/env bash
# Shared OpenCode provider metadata for subc launch and install paths.

# OpenCode groups /models entries by provider.name. Keep this stable and human
# readable.
SUBC_OPENCODE_PROVIDER_ID="subconscious"
SUBC_OPENCODE_PROVIDER_NAME="Subconscious Gateway"

subc_opencode_model_display_name() {
  local slug="${1:-}"
  slug="${slug#subconscious/}"
  echo "$slug" | awk -F '[-_]' '
    function format_token(token, lower) {
      lower = tolower(token)
      if (lower ~ /^(gpt|oss|api|gguf|ggml|nomic|vl|it|mlx)$/) return toupper(token)
      if (token ~ /^[0-9]+[bBkKmMgG]$/) return toupper(token)
      if (token ~ /^[qQ][0-9]+$/) return toupper(token)
      if (token ~ /^[0-9]+\.[0-9]+/) return token
      if (token ~ /^[A-Za-z][0-9]+[A-Za-z]$/ || token ~ /^[0-9]+[A-Za-z]$/) return toupper(token)
      return toupper(substr(token, 1, 1)) tolower(substr(token, 2))
    }
    {
      out = ""
      for (i = 1; i <= NF; i++) {
        if ($i == "") continue
        out = out (out == "" ? "" : " ") format_token($i)
      }
      print out
    }
  '
}

subc_opencode_build_whitelist_json() {
  local model_id
  WHITELIST_JSON=""
  for model_id in "${SUPPORTED_MODELS[@]}"; do
    if [[ -n "$WHITELIST_JSON" ]]; then
      WHITELIST_JSON="${WHITELIST_JSON},\"${model_id}\""
    else
      WHITELIST_JSON="\"${model_id}\""
    fi
  done
  WHITELIST_JSON="[${WHITELIST_JSON}]"
}

subc_opencode_build_models_json() {
  local model_id display_name vision_fields model_json
  MODELS_JSON=""
  for model_id in "${SUPPORTED_MODELS[@]}"; do
    display_name="$(subc_opencode_model_display_name "$model_id")"
    vision_fields=""
    if subc_model_supports_vision "$model_id"; then
      vision_fields=',"attachment":true,"modalities":{"input":["text","image"],"output":["text"]}'
    fi
    model_json="\"${model_id}\":{\"name\":\"${display_name}\",\"tools\":true,\"limit\":{\"context\":${CONTEXT_LIMIT},\"output\":${OUTPUT_LIMIT}}${vision_fields}}"
    if [[ -n "$MODELS_JSON" ]]; then
      MODELS_JSON="${MODELS_JSON},${model_json}"
    else
      MODELS_JSON="$model_json"
    fi
  done
  subc_opencode_build_whitelist_json
}

subc_opencode_build_config_json() {
  local base_url="${1:?base url required}"
  local model="${2:?model required}"
  cat <<EOF
{"\$schema":"https://opencode.ai/config.json","disabled_providers":["subconscious-cli"],"provider":{"${SUBC_OPENCODE_PROVIDER_ID}":{"npm":"@ai-sdk/openai-compatible","name":"${SUBC_OPENCODE_PROVIDER_NAME}","whitelist":${WHITELIST_JSON},"options":{"baseURL":"${base_url}","apiKey":"{env:SUBCONSCIOUS_API_KEY}","headers":{"x-subconscious-client":"opencode"},"modelsDiscovery":{"enabled":false}},"models":{${MODELS_JSON}}}},"model":"${SUBC_OPENCODE_PROVIDER_ID}/${model}"}
EOF
}

subc_opencode_build_provider_json() {
  local base_url="${1:?base url required}"
  cat <<EOF
{
  "npm": "@ai-sdk/openai-compatible",
  "name": "${SUBC_OPENCODE_PROVIDER_NAME}",
  "whitelist": ${WHITELIST_JSON},
  "options": {
    "baseURL": "${base_url}",
    "apiKey": "{env:SUBCONSCIOUS_API_KEY}",
    "headers": {
      "x-subconscious-client": "opencode"
    },
    "modelsDiscovery": {
      "enabled": false
    }
  },
  "models": {${MODELS_JSON}}
}
EOF
}
