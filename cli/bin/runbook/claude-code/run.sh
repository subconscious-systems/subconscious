#!/usr/bin/env bash
# Point the `claude` CLI at the Subconscious gateway — ephemerally.
#
# Uses env vars only (ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN) so nothing is
# written to ~/.claude/ config files.
#
# Usage:
#   ./run.sh                         # uses GATEWAY_URL/API_KEY from ../.env
#   ./run.sh --continue               # pass args through to claude
#   ./run.sh --compact-window 1000000 -- --continue
#   ./run.sh --model subconscious/glm-5.2 -p "hi"
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

DEFAULT_MODEL="subconscious/glm-5.2"
DEFAULT_COMPACT_WINDOW="1000000"
DEFAULT_MAX_CONTEXT_TOKENS="3000000"
DEFAULT_MAX_CONCURRENT_SUBAGENTS="4"
DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH="1"

GATEWAY_URL="${GATEWAY_URL:-}"
API_KEY="${CLAUDE_CODE_API_KEY:-${API_KEY:-}}"
MODEL="${MODEL:-$DEFAULT_MODEL}"
COMPACT_WINDOW="${CLAUDE_CODE_AUTO_COMPACT_WINDOW:-${COMPACT_WINDOW:-$DEFAULT_COMPACT_WINDOW}}"
MAX_CONTEXT_TOKENS="${CLAUDE_CODE_MAX_CONTEXT_TOKENS:-${MAX_CONTEXT_TOKENS:-$DEFAULT_MAX_CONTEXT_TOKENS}}"
MAX_CONCURRENT_SUBAGENTS="${MAX_CONCURRENT_SUBAGENTS:-$DEFAULT_MAX_CONCURRENT_SUBAGENTS}"
MAX_SUBAGENT_SPAWN_DEPTH="${MAX_SUBAGENT_SPAWN_DEPTH:-$DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH}"

# Claude's Opus/Sonnet/Haiku/Fable/custom slots must follow the live catalog
# (SUBCONSCIOUS_MODELS). Packaged DeepSeek/GLM defaults are not a capability.
PICKER_MODELS=()
if [[ -n "${SUBCONSCIOUS_MODELS:-}" ]]; then
  while IFS= read -r picker_model; do
    [[ -n "$picker_model" ]] && PICKER_MODELS+=("$picker_model")
  done <<< "$SUBCONSCIOUS_MODELS"
fi

picker_model_at() {
  local index="$1"
  local count="${#PICKER_MODELS[@]}"
  if [[ "$count" -eq 0 ]]; then
    printf '%s' "$MODEL"
    return
  fi
  if [[ "$index" -ge "$count" ]]; then
    index=$((count - 1))
  fi
  printf '%s' "${PICKER_MODELS[$index]}"
}

in_picker_catalog() {
  local candidate="$1" existing
  [[ -z "$candidate" ]] && return 1
  [[ "${#PICKER_MODELS[@]}" -eq 0 ]] && return 0
  for existing in "${PICKER_MODELS[@]}"; do
    [[ "$existing" == "$candidate" ]] && return 0
  done
  return 1
}

if [[ "${#PICKER_MODELS[@]}" -gt 0 ]]; then
  in_picker_catalog "${ANTHROPIC_DEFAULT_OPUS_MODEL:-}" || ANTHROPIC_DEFAULT_OPUS_MODEL=""
  in_picker_catalog "${ANTHROPIC_DEFAULT_SONNET_MODEL:-}" || ANTHROPIC_DEFAULT_SONNET_MODEL=""
  in_picker_catalog "${ANTHROPIC_DEFAULT_HAIKU_MODEL:-}" || ANTHROPIC_DEFAULT_HAIKU_MODEL=""
  in_picker_catalog "${ANTHROPIC_DEFAULT_FABLE_MODEL:-}" || unset ANTHROPIC_DEFAULT_FABLE_MODEL ANTHROPIC_DEFAULT_FABLE_MODEL_NAME ANTHROPIC_DEFAULT_FABLE_MODEL_DESCRIPTION
  if [[ "${#PICKER_MODELS[@]}" -lt 5 ]] || ! in_picker_catalog "${ANTHROPIC_CUSTOM_MODEL_OPTION:-}"; then
    unset ANTHROPIC_CUSTOM_MODEL_OPTION ANTHROPIC_CUSTOM_MODEL_OPTION_NAME ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION
  fi
fi

DEFAULT_OPUS_MODEL="$(picker_model_at 0)"
DEFAULT_SONNET_MODEL="$(picker_model_at 1)"
DEFAULT_HAIKU_MODEL="$(picker_model_at 2)"
DEFAULT_FABLE_MODEL="$(picker_model_at 3)"
OPUS_MODEL="${ANTHROPIC_DEFAULT_OPUS_MODEL:-$DEFAULT_OPUS_MODEL}"
OPUS_MODEL_NAME="${ANTHROPIC_DEFAULT_OPUS_MODEL_NAME:-$OPUS_MODEL}"
OPUS_MODEL_DESCRIPTION="${ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION:-Subconscious model ${OPUS_MODEL}}"
SONNET_MODEL="${ANTHROPIC_DEFAULT_SONNET_MODEL:-$DEFAULT_SONNET_MODEL}"
SONNET_MODEL_NAME="${ANTHROPIC_DEFAULT_SONNET_MODEL_NAME:-$SONNET_MODEL}"
SONNET_MODEL_DESCRIPTION="${ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION:-Subconscious model ${SONNET_MODEL}}"
HAIKU_MODEL="${ANTHROPIC_DEFAULT_HAIKU_MODEL:-$DEFAULT_HAIKU_MODEL}"
HAIKU_MODEL_NAME="${ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME:-$HAIKU_MODEL}"
HAIKU_MODEL_DESCRIPTION="${ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION:-Subconscious model ${HAIKU_MODEL}}"
FABLE_MODEL="${ANTHROPIC_DEFAULT_FABLE_MODEL:-$DEFAULT_FABLE_MODEL}"
FABLE_MODEL_NAME="${ANTHROPIC_DEFAULT_FABLE_MODEL_NAME:-$FABLE_MODEL}"
FABLE_MODEL_DESCRIPTION="${ANTHROPIC_DEFAULT_FABLE_MODEL_DESCRIPTION:-Subconscious model ${FABLE_MODEL}}"

# Model IDs are already restricted to [-A-Za-z0-9._:/+], so they are JSON-safe.
build_claude_picker_settings() {
  local ids=() model_id first options allowlist
  if [[ "${#PICKER_MODELS[@]}" -gt 0 ]]; then
    ids=("${PICKER_MODELS[@]}")
  else
    ids=("$MODEL")
  fi
  options=""
  allowlist=""
  first=1
  for model_id in "${ids[@]}"; do
    [[ -n "$model_id" ]] || continue
    if [[ "$first" -eq 1 ]]; then
      first=0
    else
      options="${options},"
      allowlist="${allowlist},"
    fi
    options="${options}{\"model\":\"${model_id}\",\"label\":\"${model_id}\",\"description\":\"Subconscious model ${model_id}\"}"
    allowlist="${allowlist}\"${model_id}\""
  done
  printf '{"availableModels":[%s],"modelPicker":{"replaceBuiltInOptions":true,"options":[%s]}}' "$allowlist" "$options"
}

if [[ -z "${SUBC_CLAUDE_SETTINGS:-}" ]]; then
  SUBC_CLAUDE_SETTINGS="$(build_claude_picker_settings)"
fi

usage() {
  cat <<'EOF'
Usage:
  run.sh [options] [-- CLAUDE_ARGS...]
  run.sh [options] CLAUDE_ARGS...

Options (same as install.sh; flags override env for this run):
  --gateway-url URL      Gateway origin (e.g. https://gateway.example)
  --api-key KEY          Gateway API key (sk-gw-...)
  --model MODEL          Model name (default: subconscious/glm-5.2)
  --compact-window N     CLAUDE_CODE_AUTO_COMPACT_WINDOW (default: 1000000; Claude Code clamps to 100000–1000000)
                         See https://code.claude.com/docs/en/env-vars and
                         https://code.claude.com/docs/en/context-window#set-the-auto-compact-window
  --max-context-tokens N CLAUDE_CODE_MAX_CONTEXT_TOKENS (default: 3000000)
                         See https://code.claude.com/docs/en/env-vars
  -h, --help             Show this help

Anything after --, or unrecognized flags/args, is passed through to `claude`.
EOF
}

# Parse args (only when executed, not sourced)
PASSTHRU=()
if [[ "${BASH_SOURCE[0]:-$0}" == "${0}" ]]; then
  while [[ $# -gt 0 ]]; do
    case "$1" in
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
      --compact-window)
        COMPACT_WINDOW="${2:-}"
        shift 2
        ;;
      --max-context-tokens)
        MAX_CONTEXT_TOKENS="${2:-}"
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
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

if [[ -z "$GATEWAY_URL" || -z "$API_KEY" ]]; then
  echo "error: GATEWAY_URL and API_KEY must be set in ../.env (or pass --gateway-url / --api-key)" >&2
  exit 1
fi

# Optional CLAUDE_GATEWAY_URL in shared .env overrides GATEWAY_URL for Claude only
# (CLI --gateway-url already updated GATEWAY_URL above).
EFFECTIVE_GATEWAY_URL="${CLAUDE_GATEWAY_URL:-$GATEWAY_URL}"

export ANTHROPIC_BASE_URL="$EFFECTIVE_GATEWAY_URL"
export ANTHROPIC_AUTH_TOKEN="$API_KEY"
export ANTHROPIC_MODEL="${ANTHROPIC_MODEL:-$MODEL}"
export ANTHROPIC_SMALL_FAST_MODEL="${ANTHROPIC_SMALL_FAST_MODEL:-$MODEL}"
export ANTHROPIC_DEFAULT_OPUS_MODEL="${ANTHROPIC_DEFAULT_OPUS_MODEL:-$OPUS_MODEL}"
export ANTHROPIC_DEFAULT_OPUS_MODEL_NAME="${ANTHROPIC_DEFAULT_OPUS_MODEL_NAME:-$OPUS_MODEL_NAME}"
export ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION="${ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION:-$OPUS_MODEL_DESCRIPTION}"
export ANTHROPIC_DEFAULT_SONNET_MODEL="${ANTHROPIC_DEFAULT_SONNET_MODEL:-$SONNET_MODEL}"
export ANTHROPIC_DEFAULT_SONNET_MODEL_NAME="${ANTHROPIC_DEFAULT_SONNET_MODEL_NAME:-$SONNET_MODEL_NAME}"
export ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION="${ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION:-$SONNET_MODEL_DESCRIPTION}"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="${ANTHROPIC_DEFAULT_HAIKU_MODEL:-$HAIKU_MODEL}"
export ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME="${ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME:-$HAIKU_MODEL_NAME}"
export ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION="${ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION:-$HAIKU_MODEL_DESCRIPTION}"
export ANTHROPIC_DEFAULT_FABLE_MODEL="${ANTHROPIC_DEFAULT_FABLE_MODEL:-$FABLE_MODEL}"
export ANTHROPIC_DEFAULT_FABLE_MODEL_NAME="${ANTHROPIC_DEFAULT_FABLE_MODEL_NAME:-$FABLE_MODEL_NAME}"
export ANTHROPIC_DEFAULT_FABLE_MODEL_DESCRIPTION="${ANTHROPIC_DEFAULT_FABLE_MODEL_DESCRIPTION:-$FABLE_MODEL_DESCRIPTION}"
export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY="${CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY:-0}"
export CLAUDE_CODE_SUBAGENT_MODEL="${CLAUDE_CODE_SUBAGENT_MODEL:-$MODEL}"
export CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS="${MAX_CONCURRENT_SUBAGENTS}"
export CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH="${MAX_SUBAGENT_SPAWN_DEPTH}"
export CLAUDE_CODE_AUTO_COMPACT_WINDOW="${COMPACT_WINDOW}"
export CLAUDE_CODE_MAX_CONTEXT_TOKENS="${MAX_CONTEXT_TOKENS}"
# Claude Code purpose attribution only: api_request logs → gateway POST /v1/logs
# (not a general logs API). Docs:
# https://code.claude.com/docs/en/monitoring-usage#api-request-event
# Requires Claude Code >= 2.1.152.
export CLAUDE_CODE_ENABLE_TELEMETRY="${CLAUDE_CODE_ENABLE_TELEMETRY:-1}"
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="${CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:-1}"
# claude.ai connectors require subscription OAuth and cannot be used while the
# Subconscious bearer token and gateway URL are active.
export ENABLE_CLAUDEAI_MCP_SERVERS=false
export OTEL_LOGS_EXPORTER="${OTEL_LOGS_EXPORTER:-otlp}"
export OTEL_EXPORTER_OTLP_PROTOCOL="${OTEL_EXPORTER_OTLP_PROTOCOL:-http/json}"
export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT="${EFFECTIVE_GATEWAY_URL%/}/v1/logs"
export OTEL_EXPORTER_OTLP_HEADERS="x-api-key=${API_KEY}"
export OTEL_EXPORTER_OTLP_TIMEOUT="${OTEL_EXPORTER_OTLP_TIMEOUT:-2000}"
export OTEL_LOGS_EXPORT_INTERVAL="${OTEL_LOGS_EXPORT_INTERVAL:-2000}"
# Do not set OTEL_TRACES_EXPORTER / OTEL_METRICS_EXPORTER (including to "none") -
# Claude's telemetry init can abort the whole pipeline on unknown exporter types.
# If sourced, export env and return (caller can unset when done).
if [[ "${BASH_SOURCE[0]:-$0}" != "${0}" ]]; then
  return 0 2>/dev/null || true
fi

# If executed, launch claude with any passed-through args.
# --settings is additional JSON: it replaces the built-in Fable/Opus lineup
# with the live catalog and allowlists only those models.
exec claude --settings "${SUBC_CLAUDE_SETTINGS}" ${PASSTHRU[@]+"${PASSTHRU[@]}"}
