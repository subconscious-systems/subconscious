#!/usr/bin/env bash
# ── Subconscious API Gateway — Claude Code setup ──────────────────────────────
# Point Claude Code at your gateway. Claude reads env vars, so the "install"
# writes them to ~/.claude/subconscious-gateway.env and `use` launches claude.
#
# Quick start:
#   ./install.sh --gateway-url https://your-gateway.example --api-key sk-gw-...
#   ./install.sh use                    # launches claude with gateway env loaded
#   ./install.sh use -- --continue      # pass args through to claude
#
# Or source env into your shell:
#   source <(./install.sh env)          # load   ANTHROPIC_BASE_URL etc.
#   source <(./install.sh unset)        # remove ANTHROPIC_BASE_URL etc.
#
#   ./install.sh status                 # show current config
#   ./install.sh uninstall              # remove env file
#
# ── What this does under the hood ────────────────────────────────────────────
# Equivalent manual setup (no script needed):
#
#   export ANTHROPIC_BASE_URL=https://your-gateway.example
#   export ANTHROPIC_AUTH_TOKEN=sk-gw-...
#   export ANTHROPIC_MODEL=subconscious/glm-5.2
#   export ANTHROPIC_SMALL_FAST_MODEL=subconscious/glm-5.2
#   export CLAUDE_CODE_SUBAGENT_MODEL=subconscious/glm-5.2
#   export CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=4
#   export CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1
#   export CLAUDE_CODE_AUTO_COMPACT_WINDOW=1000000
#   export CLAUDE_CODE_MAX_CONTEXT_TOKENS=3000000
#   # AUTO_COMPACT_WINDOW range 100000–1000000 (leave on; TIMRUN keys rarely hit it):
#   # https://code.claude.com/docs/en/env-vars
#   # https://code.claude.com/docs/en/context-window#set-the-auto-compact-window
#   export CLAUDE_CODE_ENABLE_TELEMETRY=1
#   export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
#   export OTEL_LOGS_EXPORTER=otlp
#   export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
#   export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=https://your-gateway.example/v1/logs
#   export OTEL_EXPORTER_OTLP_HEADERS="x-api-key=sk-gw-..."
#   export OTEL_EXPORTER_OTLP_TIMEOUT=2000
#   export OTEL_LOGS_EXPORT_INTERVAL=2000
#   claude
#
# Claude Code sends native x-claude-code-session-id headers, so the gateway
# correlates requests automatically. OTEL api_request logs → Claude Code-only
# POST /v1/logs back-fill query_source (not a general logs API):
# https://code.claude.com/docs/en/monitoring-usage#api-request-event
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load shared env from coding-agents/.env (gitignored) or env.example.
SHARED_ENV="${MBTA_ENV_FILE:-${SCRIPT_DIR}/../.env}"
[[ -f "$SHARED_ENV" ]] || SHARED_ENV="${SCRIPT_DIR}/../env.example"
if [[ -f "$SHARED_ENV" ]]; then set -a; source "$SHARED_ENV"; set +a; fi

CLAUDE_DIR="${HOME}/.claude"
ENV_FILE="${CLAUDE_DIR}/subconscious-gateway.env"
DEFAULT_MODEL="subconscious/glm-5.2"
DEFAULT_COMPACT_WINDOW="1000000"
DEFAULT_MAX_CONTEXT_TOKENS="3000000"
DEFAULT_MAX_CONCURRENT_SUBAGENTS="4"
DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH="1"
DEFAULT_OPUS_MODEL="subconscious/glm-5.2"
DEFAULT_SONNET_MODEL="subconscious/tim-qwen3.6-27b"
DEFAULT_HAIKU_MODEL="subconscious/deepseek-v4-flash-marathon"

GATEWAY_URL="${GATEWAY_URL:-}"
API_KEY="${CLAUDE_CODE_API_KEY:-${API_KEY:-}}"
MODEL="${MODEL:-$DEFAULT_MODEL}"
COMPACT_WINDOW="${CLAUDE_CODE_AUTO_COMPACT_WINDOW:-${COMPACT_WINDOW:-$DEFAULT_COMPACT_WINDOW}}"
MAX_CONTEXT_TOKENS="${CLAUDE_CODE_MAX_CONTEXT_TOKENS:-${MAX_CONTEXT_TOKENS:-$DEFAULT_MAX_CONTEXT_TOKENS}}"
MAX_CONCURRENT_SUBAGENTS="${MAX_CONCURRENT_SUBAGENTS:-$DEFAULT_MAX_CONCURRENT_SUBAGENTS}"
MAX_SUBAGENT_SPAWN_DEPTH="${MAX_SUBAGENT_SPAWN_DEPTH:-$DEFAULT_MAX_SUBAGENT_SPAWN_DEPTH}"
OPUS_MODEL="${ANTHROPIC_DEFAULT_OPUS_MODEL:-$DEFAULT_OPUS_MODEL}"
OPUS_MODEL_NAME="${ANTHROPIC_DEFAULT_OPUS_MODEL_NAME:-$OPUS_MODEL}"
OPUS_MODEL_DESCRIPTION="${ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION:-Subconscious default model}"
SONNET_MODEL="${ANTHROPIC_DEFAULT_SONNET_MODEL:-$DEFAULT_SONNET_MODEL}"
SONNET_MODEL_NAME="${ANTHROPIC_DEFAULT_SONNET_MODEL_NAME:-$SONNET_MODEL}"
SONNET_MODEL_DESCRIPTION="${ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION:-Subconscious TIM Qwen 3.6 27B}"
HAIKU_MODEL="${ANTHROPIC_DEFAULT_HAIKU_MODEL:-$DEFAULT_HAIKU_MODEL}"
HAIKU_MODEL_NAME="${ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME:-$HAIKU_MODEL}"
HAIKU_MODEL_DESCRIPTION="${ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION:-Subconscious DeepSeek V4 Flash Marathon}"
COMMAND="install"

usage() {
  cat <<'EOF'
Usage:
  install.sh [install] --gateway-url URL --api-key KEY [--model MODEL] [--compact-window N]
  install.sh use [-- CLAUDE_ARGS...]
  install.sh env
  install.sh unset
  install.sh uninstall
  install.sh status

`install` is the default subcommand and may be omitted.

Commands:
  install     Write ~/.claude/subconscious-gateway.env with gateway settings
  use         Source the env file and exec claude (pass -- followed by claude args)
  env         Print export lines for sourcing: source <(./install.sh env)
  unset       Print unset lines for sourcing: source <(./install.sh unset)
  uninstall   Remove the env file
  status      Show current configuration

Options:
  --gateway-url URL     Gateway origin (e.g. https://gateway.example)
  --api-key KEY         Gateway API key (sk-gw-...)
  --model MODEL         Model name (default: subconscious/glm-5.2)
  --compact-window N    CLAUDE_CODE_AUTO_COMPACT_WINDOW (default: 1000000; Claude Code clamps to 100000–1000000)
                        See https://code.claude.com/docs/en/env-vars and
                        https://code.claude.com/docs/en/context-window#set-the-auto-compact-window
  --max-context-tokens N CLAUDE_CODE_MAX_CONTEXT_TOKENS (default: 3000000)
                        See https://code.claude.com/docs/en/env-vars
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    install|use|env|unset|uninstall|status)
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
      break
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

# Optional CLAUDE_GATEWAY_URL in shared .env overrides GATEWAY_URL for Claude only.
resolve_claude_gateway_url() {
  printf '%s' "${CLAUDE_GATEWAY_URL:-$GATEWAY_URL}"
}

write_env() {
  local effective_gateway_url
  effective_gateway_url="$(resolve_claude_gateway_url)"
  mkdir -p "$CLAUDE_DIR"
  umask 077
  cat >"$ENV_FILE" <<EOF
# Generated by ol-runbook/coding-agents/claude-code/install.sh — do not commit secrets.
export ANTHROPIC_BASE_URL="${effective_gateway_url}"
export ANTHROPIC_AUTH_TOKEN="${API_KEY}"
export ANTHROPIC_MODEL="${MODEL}"
export ANTHROPIC_SMALL_FAST_MODEL="${MODEL}"
export ANTHROPIC_DEFAULT_OPUS_MODEL="${OPUS_MODEL}"
export ANTHROPIC_DEFAULT_OPUS_MODEL_NAME="${OPUS_MODEL_NAME}"
export ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION="${OPUS_MODEL_DESCRIPTION}"
export ANTHROPIC_DEFAULT_SONNET_MODEL="${SONNET_MODEL}"
export ANTHROPIC_DEFAULT_SONNET_MODEL_NAME="${SONNET_MODEL_NAME}"
export ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION="${SONNET_MODEL_DESCRIPTION}"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="${HAIKU_MODEL}"
export ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME="${HAIKU_MODEL_NAME}"
export ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION="${HAIKU_MODEL_DESCRIPTION}"
export CLAUDE_CODE_SUBAGENT_MODEL="${MODEL}"
export CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS="${MAX_CONCURRENT_SUBAGENTS}"
export CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH="${MAX_SUBAGENT_SPAWN_DEPTH}"
export CLAUDE_CODE_AUTO_COMPACT_WINDOW="${COMPACT_WINDOW}"
export CLAUDE_CODE_MAX_CONTEXT_TOKENS="${MAX_CONTEXT_TOKENS}"
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
# Claude Code purpose attribution only (api_request → /v1/logs):
# https://code.claude.com/docs/en/monitoring-usage#api-request-event
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT="${effective_gateway_url%/}/v1/logs"
export OTEL_EXPORTER_OTLP_HEADERS="x-api-key=${API_KEY}"
export OTEL_EXPORTER_OTLP_TIMEOUT=2000
export OTEL_LOGS_EXPORT_INTERVAL=2000
EOF
  chmod 600 "$ENV_FILE"
}

print_env_exports() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "env file not found: $ENV_FILE" >&2
    echo "run: ./install.sh --gateway-url URL --api-key KEY" >&2
    return 1
  fi
  cat "$ENV_FILE"
}

print_env_unsets() {
  cat <<'EOF'
unset ANTHROPIC_BASE_URL
unset ANTHROPIC_AUTH_TOKEN
unset ANTHROPIC_MODEL
unset ANTHROPIC_SMALL_FAST_MODEL
unset ANTHROPIC_DEFAULT_OPUS_MODEL
unset ANTHROPIC_DEFAULT_OPUS_MODEL_NAME
unset ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION
unset ANTHROPIC_DEFAULT_SONNET_MODEL
unset ANTHROPIC_DEFAULT_SONNET_MODEL_NAME
unset ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION
unset ANTHROPIC_DEFAULT_HAIKU_MODEL
unset ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME
unset ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION
unset CLAUDE_CODE_SUBAGENT_MODEL
unset CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS
unset CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH
unset CLAUDE_CODE_AUTO_COMPACT_WINDOW
unset CLAUDE_CODE_MAX_CONTEXT_TOKENS
unset CLAUDE_CODE_ENABLE_TELEMETRY
unset CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
unset OTEL_LOGS_EXPORTER
unset OTEL_EXPORTER_OTLP_PROTOCOL
unset OTEL_EXPORTER_OTLP_LOGS_ENDPOINT
unset OTEL_EXPORTER_OTLP_HEADERS
unset OTEL_EXPORTER_OTLP_TIMEOUT
unset OTEL_LOGS_EXPORT_INTERVAL
EOF
}

status() {
  echo "scope: user"
  echo "claude dir: $CLAUDE_DIR"
  echo "env file: $ENV_FILE"
  if [[ -f "$ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    echo "gateway: ${ANTHROPIC_BASE_URL:-unset}"
    if [[ -n "${ANTHROPIC_AUTH_TOKEN:-}" ]]; then
      echo "api key: set (${#ANTHROPIC_AUTH_TOKEN} chars)"
    else
      echo "api key: unset"
    fi
    echo "model: ${ANTHROPIC_MODEL:-unset}"
    echo "model picker: ${ANTHROPIC_DEFAULT_OPUS_MODEL_NAME:-unset}, ${ANTHROPIC_DEFAULT_SONNET_MODEL_NAME:-unset}, ${ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME:-unset}"
    echo "max concurrent subagents: ${CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS:-unset}"
    echo "max subagent spawn depth: ${CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH:-unset}"
    echo "compact window: ${CLAUDE_CODE_AUTO_COMPACT_WINDOW:-unset}"
    echo "max context tokens: ${CLAUDE_CODE_MAX_CONTEXT_TOKENS:-unset}"
  else
    echo "env file: missing"
    echo "run: ./install.sh --gateway-url URL --api-key KEY"
  fi
}

case "$COMMAND" in
  install)
    if [[ -z "$GATEWAY_URL" || -z "$API_KEY" ]]; then
      echo "--gateway-url and --api-key are required for install" >&2
      exit 1
    fi
    write_env
    echo "Wrote $ENV_FILE"
    echo "  gateway: $GATEWAY_URL"
    echo "  model:   $MODEL"
    echo ""
    echo "Launch claude:"
    echo "  ./install.sh use"
    echo "  ./install.sh use -- --continue"
    echo ""
    echo "Or source env into your current shell:"
    echo "  source <(./install.sh env)"
    ;;
  use)
    if [[ ! -f "$ENV_FILE" ]]; then
      echo "env file not found: $ENV_FILE" >&2
      echo "run: ./install.sh --gateway-url URL --api-key KEY" >&2
      exit 1
    fi
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    if ! command -v claude >/dev/null 2>&1; then
      echo "claude CLI not found in PATH" >&2
      exit 1
    fi
    exec claude "$@"
    ;;
  env)
    print_env_exports
    ;;
  unset)
    print_env_unsets
    ;;
  uninstall)
    rm -f "$ENV_FILE"
    echo "Removed $ENV_FILE"
    echo "To unset env in your current shell: source <(./install.sh unset)"
    ;;
  status)
    status
    ;;
esac
