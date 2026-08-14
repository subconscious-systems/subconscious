#!/usr/bin/env bash
# Point the `codex` CLI at the Subconscious gateway — ephemerally.
#
# Uses `codex -c key=value` overrides so nothing is written to ~/.codex/config.toml.
# web_search is disabled so Codex doesn't send hosted tools the gateway can't execute.
# The model catalog (needed to suppress the "model metadata not found" warning)
# is written to a temp file that is cleaned up on exit.
#
# Subagents are OFF by default. Current Codex (>=0.144) wraps subagent tools in a
# `type: "namespace"` wire format that non-OpenAI providers can't resolve, causing
# "unsupported call: spawn_agent" (upstream #32318, #26977). The fix (PR #29602) is
# not yet merged.
#
# To run with subagents, pass --subagents — this runs the pinned legacy
# codex@0.132.0 with multi-agent v1 config (plain tool names) that the model can
# resolve. Requires npx.
#
# Usage:
#   ./run.sh                         # uses GATEWAY_URL/API_KEY from ../.env
#   ./run.sh --context-window 5000000 -- --resume
#   ./run.sh --subagents              # run codex@0.132.0 with subagents enabled
#   ./run.sh --subagents -- --resume  # subagents + passthrough args
#   ./run.sh --external-tools          # include Codex apps/plugins (may exceed gateway tool limits)
#
# Config: copy ../env.example to ../.env and edit. .env is gitignored.
# All agents share one coding-agents/.env file.
#
# Or source it to just export the env:
#   source run.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load shared env from coding-agents/.env (gitignored) or env.example.
SHARED_ENV="${MBTA_ENV_FILE:-${SCRIPT_DIR}/../.env}"
[[ -f "$SHARED_ENV" ]] || SHARED_ENV="${SCRIPT_DIR}/../env.example"
if [[ -f "$SHARED_ENV" ]]; then set -a; source "$SHARED_ENV"; set +a; fi

GATEWAY_URL="${GATEWAY_URL:-}"
API_KEY="${CODEX_API_KEY:-${API_KEY:-}}"
MODEL="${MODEL:-subconscious/glm-5.2}"
MAX_CONCURRENT_SUBAGENTS="${MAX_CONCURRENT_SUBAGENTS:-4}"
SUBAGENTS=false
EXTERNAL_TOOLS="${CODEX_EXTERNAL_TOOLS:-false}"
CODEX_CONTEXT_WINDOW="${CODEX_CONTEXT_WINDOW:-5000000}"
CODEX_MAX_CONTEXT_WINDOW="${CODEX_MAX_CONTEXT_WINDOW:-}"
CODEX_AUTO_COMPACT_TOKEN_LIMIT="${CODEX_AUTO_COMPACT_TOKEN_LIMIT:-4500000}"
CODEX_REASONING_EFFORT="${CODEX_REASONING_EFFORT:-max}"

# Codex version that supports the legacy multi-agent v1 config (plain tool names).
SUBAGENT_CODEX_VERSION="0.132.0"

# Parse args (only when executed, not sourced)
PASSTHRU=()
if [[ "${BASH_SOURCE[0]:-$0}" == "${0}" ]]; then
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --context-window)
        CODEX_CONTEXT_WINDOW="${2:-}"
        shift 2
        ;;
      --max-context-window)
        CODEX_MAX_CONTEXT_WINDOW="${2:-}"
        shift 2
        ;;
      --auto-compact-token-limit)
        CODEX_AUTO_COMPACT_TOKEN_LIMIT="${2:-}"
        shift 2
        ;;
      --reasoning-effort)
        CODEX_REASONING_EFFORT="${2:-}"
        shift 2
        ;;
      --subagents)
        SUBAGENTS=true
        shift
        ;;
      --external-tools)
        EXTERNAL_TOOLS=true
        shift
        ;;
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

CODEX_MAX_CONTEXT_WINDOW="${CODEX_MAX_CONTEXT_WINDOW:-${CODEX_CONTEXT_WINDOW}}"
case "$CODEX_REASONING_EFFORT" in
  none|low|medium|high|max) ;;
  *)
    echo "error: reasoning effort must be one of: none, low, medium, high, max" >&2
    exit 1
    ;;
esac

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

# Keep the requested model first while exposing the complete Subconscious
# catalog in Codex's /model picker. The CLI supplies this list from the registry;
# the fallback keeps the vendored runbook useful on its own.
add_supported_model "$MODEL"
while IFS= read -r model_id; do
  add_supported_model "$model_id"
done <<< "${SUBCONSCIOUS_MODELS:-$DEFAULT_SUBCONSCIOUS_MODELS}"

write_model_catalog() {
  local catalog_file="$1" model_id index=0
  {
    printf '{\n  "models": [\n'
    for model_id in "${SUPPORTED_MODELS[@]}"; do
      if [[ "$index" -gt 0 ]]; then
        printf ',\n'
      fi
      cat <<EOF
    {
      "slug": "${model_id}",
      "display_name": "${model_id}",
      "description": "Subconscious API Gateway model ${model_id}",
      "context_window": ${CODEX_CONTEXT_WINDOW},
      "max_context_window": ${CODEX_MAX_CONTEXT_WINDOW},
      "auto_compact_token_limit": ${CODEX_AUTO_COMPACT_TOKEN_LIMIT},
      "effective_context_window_percent": 95,
      "supported_reasoning_levels": [],
      "shell_type": "shell_command",
      "visibility": "list",
      "supported_in_api": true,
      "priority": 0,
      "availability_nux": null,
      "upgrade": null,
      "base_instructions": "You are Codex, a coding agent.",
      "supports_reasoning_summaries": false,
      "support_verbosity": false,
      "default_verbosity": null,
      "apply_patch_tool_type": "freeform",
      "truncation_policy": { "mode": "tokens", "limit": 10000 },
      "supports_parallel_tool_calls": true,
      "experimental_supported_tools": []
    }
EOF
      index=$((index + 1))
    done
    printf '\n  ]\n}\n'
  } >"$catalog_file"
}

# The gateway accepts at most 128 tools per request. Codex apps and installed
# plugins can collectively exceed that before any core coding tools are added,
# so keep those external catalogs off for Subconscious by default. Users can
# opt back in with --external-tools if their gateway supports a larger limit.
EXTERNAL_TOOL_ARGS=()
if [[ "$EXTERNAL_TOOLS" != "true" ]]; then
  EXTERNAL_TOOL_ARGS=(
    -c features.apps=false
    -c features.plugins=false
    -c apps._default.enabled=false
  )
fi

if [[ -z "$GATEWAY_URL" || -z "$API_KEY" ]]; then
  echo "error: GATEWAY_URL and API_KEY must be set in ../.env" >&2
  exit 1
fi

export SUBCONSCIOUS_API_KEY="$API_KEY"
export SUBCONSCIOUS_GATEWAY_URL="${GATEWAY_URL%/}"

# Ensure compaction hooks are present for ephemeral runs too. Codex discovers
# ~/.codex/hooks.json alongside config layers; trust them once via /hooks.
HOOK_SRC="${SCRIPT_DIR}/hook.sh"
HOOKS_TEMPLATE="${SCRIPT_DIR}/hooks.json"
CODEX_DIR="${HOME}/.codex"
HOOK_DST="${CODEX_DIR}/subconscious-hook.sh"
HOOKS_JSON="${CODEX_DIR}/hooks.json"
HOOKS_ENV_FILE="${CODEX_DIR}/subconscious-hooks.env"
if [[ -f "$HOOK_SRC" && -f "$HOOKS_TEMPLATE" ]]; then
  mkdir -p "$CODEX_DIR"
  cp "$HOOK_SRC" "$HOOK_DST"
  chmod +x "$HOOK_DST"
  sed "s|HOOK_SH_PATH|${HOOK_DST}|g" "$HOOKS_TEMPLATE" >"$HOOKS_JSON"
  umask 077
  cat >"$HOOKS_ENV_FILE" <<EOF
# Generated by ol-runbook/coding-agents/codex/run.sh — do not commit secrets.
export SUBCONSCIOUS_GATEWAY_URL='${GATEWAY_URL%/}'
export SUBCONSCIOUS_API_KEY='${API_KEY}'
EOF
  chmod 600 "$HOOKS_ENV_FILE"
fi

# Write a temp model catalog so Codex doesn't print "model metadata not found".
# This is the one thing that can't be passed via -c flags.
CATALOG_FILE="$(mktemp -t codex-model-catalog.XXXXXX.json)"
cleanup() { rm -f "$CATALOG_FILE"; }
trap cleanup EXIT
write_model_catalog "$CATALOG_FILE"

# If sourced, just export env and return.
if [[ "${BASH_SOURCE[0]:-$0}" != "${0}" ]]; then
  export GATEWAY_URL CATALOG_FILE MAX_CONCURRENT_SUBAGENTS SUBAGENTS
  return 0 2>/dev/null || true
fi

# Ephemeral config via -c flags — nothing is written to ~/.codex/config.toml.
if [[ "$SUBAGENTS" == "true" ]]; then
  # Legacy multi-agent v1 config — plain tool names the model can resolve.
  echo "Starting codex@${SUBAGENT_CODEX_VERSION} with subagents enabled (max ${MAX_CONCURRENT_SUBAGENTS} threads)..." >&2
  exec npx -y "@openai/codex@${SUBAGENT_CODEX_VERSION}" \
    -c model="${MODEL}" \
    -c model_provider=subconscious \
    -c model_catalog_json="${CATALOG_FILE}" \
    -c model_reasoning_effort="${CODEX_REASONING_EFFORT}" \
    -c web_search=disabled \
    ${EXTERNAL_TOOL_ARGS[@]+"${EXTERNAL_TOOL_ARGS[@]}"} \
    -c features.multi_agent=true \
    -c agents.max_threads="${MAX_CONCURRENT_SUBAGENTS}" \
    -c agents.max_depth=1 \
    -c agents.interrupt_message=true \
    -c model_providers.subconscious.name=Subconscious \
    -c model_providers.subconscious.base_url="${GATEWAY_URL}/v1" \
    -c model_providers.subconscious.wire_api=responses \
    -c model_providers.subconscious.env_key=SUBCONSCIOUS_API_KEY \
    -c model_providers.subconscious.stream_idle_timeout_ms=300000 \
    ${PASSTHRU[@]+"${PASSTHRU[@]}"}
else
  exec codex \
    -c model="${MODEL}" \
    -c model_provider=subconscious \
    -c model_catalog_json="${CATALOG_FILE}" \
    -c model_reasoning_effort="${CODEX_REASONING_EFFORT}" \
    -c web_search=disabled \
    ${EXTERNAL_TOOL_ARGS[@]+"${EXTERNAL_TOOL_ARGS[@]}"} \
    -c model_providers.subconscious.name=Subconscious \
    -c model_providers.subconscious.base_url="${GATEWAY_URL}/v1" \
    -c model_providers.subconscious.wire_api=responses \
    -c model_providers.subconscious.env_key=SUBCONSCIOUS_API_KEY \
    -c model_providers.subconscious.stream_idle_timeout_ms=300000 \
    ${PASSTHRU[@]+"${PASSTHRU[@]}"}
fi
