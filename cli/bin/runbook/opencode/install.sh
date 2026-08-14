#!/usr/bin/env bash
# ── Subconscious API Gateway — OpenCode setup ─────────────────────────────────
# Point OpenCode at your gateway. Writes a provider config with session headers
# so the gateway can correlate OpenCode requests into Conversations.
#
# Quick start:
#   ./install.sh --gateway-url https://your-gateway.example --api-key sk-gw-...
#   ./install.sh status                 # show current config
#   ./install.sh uninstall              # revert to default opencode config
#
# Writes ~/.opencode/opencode.json (user config). Does not touch project-level
# opencode.json files. Restart opencode after install.
#
# ── What this does under the hood ────────────────────────────────────────────
# Equivalent manual setup (writes ~/.opencode/opencode.json + env var):
#
#   export SUBCONSCIOUS_API_KEY=sk-gw-...
#   cat > ~/.opencode/opencode.json <<'EOF'
#   {
#     "$schema": "https://opencode.ai/config.json",
#     "provider": {
#       "subconscious": {
#         "npm": "@ai-sdk/openai-compatible",
#         "name": "Subconscious Gateway",
#         "options": {
#           "baseURL": "https://your-gateway.example/v1",
#           "apiKey": "{env:SUBCONSCIOUS_API_KEY}",
#           "headers": { "x-subconscious-client": "opencode" }
#         },
#         "models": {
#           "subconscious/glm-5.2": {
#             "name": "subconscious/glm-5.2",
#             "tools": true,
#             "limit": { "context": 5000000, "output": 65536 }
#           }
#         }
#       }
#     },
#     "model": "subconscious/subconscious/glm-5.2"
#   }
#   EOF
#   opencode
#
# The x-subconscious-client header tells the gateway to classify traffic as
# OpenCode. OpenCode also sends native x-session-affinity / x-session-id
# headers for conversation correlation. Model limit.context drives auto
# compaction (default on); custom providers do not inherit models.dev limits.
#
# Also installs a plugin that reports compactions to the gateway. OpenCode
# summarizes through the configured provider, so without it the gateway counts
# that summarization as a normal main-thread turn.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load shared env from coding-agents/.env (gitignored) or env.example.
SHARED_ENV="${MBTA_ENV_FILE:-${SCRIPT_DIR}/../.env}"
[[ -f "$SHARED_ENV" ]] || SHARED_ENV="${SCRIPT_DIR}/../env.example"
if [[ -f "$SHARED_ENV" ]]; then set -a; source "$SHARED_ENV"; set +a; fi

COMMAND="install"
GATEWAY_URL="${GATEWAY_URL:-}"
API_KEY="${OPENCODE_API_KEY:-${API_KEY:-}}"
MODEL="${MODEL:-subconscious/glm-5.2}"
# OpenCode auto-compaction uses model limit.context. Custom openai-compatible
# providers do not get that from baseURL/models.dev; set it explicitly.
CONTEXT_LIMIT="${OPENCODE_CONTEXT_LIMIT:-5000000}"
OUTPUT_LIMIT="${OPENCODE_OUTPUT_LIMIT:-65536}"

usage() {
  cat <<'EOF'
Usage:
  install.sh [install] --gateway-url URL --api-key KEY [--model MODEL]
             [--context-limit N] [--output-limit N]
  install.sh uninstall
  install.sh status

`install` is the default subcommand and may be omitted.

Writes an opencode.json that points opencode at your Subconscious gateway with
x-subconscious-client: opencode and x-session-affinity/x-session-id session
headers so the gateway can group requests into Conversations.

Also sets model limit.context / limit.output so OpenCode auto-compaction
respects the gateway window (compaction.auto stays enabled / default), and
installs a plugin that reports compactions so the dashboard can restart context
accounting at the right turn.

Requires: jq. Restart opencode after install.
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
    --context-limit)
      CONTEXT_LIMIT="${2:-}"
      shift 2
      ;;
    --output-limit)
      OUTPUT_LIMIT="${2:-}"
      shift 2
      ;;
    -h|--help)
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

MODELS_JSON=""
for model_id in "${SUPPORTED_MODELS[@]}"; do
  model_json="\"${model_id}\":{\"name\":\"${model_id}\",\"tools\":true,\"limit\":{\"context\":${CONTEXT_LIMIT},\"output\":${OUTPUT_LIMIT}}}"
  if [[ -n "$MODELS_JSON" ]]; then
    MODELS_JSON="${MODELS_JSON},${model_json}"
  else
    MODELS_JSON="$model_json"
  fi
done

OPENCODE_DIR="${HOME}/.opencode"
OPENCODE_CONFIG="${OPENCODE_DIR}/opencode.json"
MARKER='x-subconscious-client'
# Plugins load from the XDG config dir, which is separate from the legacy ~/.opencode
# config path above. Docs: https://opencode.ai/docs/plugins/
PLUGIN_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/opencode/plugins"
PLUGIN_FILE="${PLUGIN_DIR}/subconscious-compaction.ts"
PLUGIN_SOURCE="${SCRIPT_DIR}/subconscious-compaction.ts"

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
  mkdir -p "$OPENCODE_DIR"
  local base_url="${GATEWAY_URL%/}/v1"
  local config
  config=$(cat <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "provider": {
    "subconscious": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Subconscious Gateway",
      "options": {
        "baseURL": "${base_url}",
        "apiKey": "{env:SUBCONSCIOUS_API_KEY}",
        "headers": {
          "x-subconscious-client": "opencode"
        }
      },
      "models": {${MODELS_JSON}}
    }
  },
  "model": "subconscious/${MODEL}"
}
EOF
)
  echo "$config" >"$OPENCODE_CONFIG"
  # Also export the API key into the shell env file for interactive sessions. The plugin
  # reads the gateway URL from the same file.
  local env_file="${OPENCODE_DIR}/subconscious.env"
  umask 077
  cat >"$env_file" <<EOF
# Generated by ol-runbook/coding-agents/opencode/install.sh — do not commit secrets.
export SUBCONSCIOUS_API_KEY='${API_KEY}'
export SUBCONSCIOUS_GATEWAY_URL='${GATEWAY_URL%/}'
EOF
  chmod 600 "$env_file"
}

write_plugin() {
  if [[ ! -f "$PLUGIN_SOURCE" ]]; then
    echo "warning: ${PLUGIN_SOURCE} missing; skipping compaction plugin" >&2
    return
  fi
  mkdir -p "$PLUGIN_DIR"
  cp "$PLUGIN_SOURCE" "$PLUGIN_FILE"
}

uninstall_config() {
  if [[ -f "$OPENCODE_CONFIG" ]] && grep -q "$MARKER" "$OPENCODE_CONFIG" 2>/dev/null; then
    rm -f "$OPENCODE_CONFIG"
  fi
  rm -f "${OPENCODE_DIR}/subconscious.env"
  rm -f "$PLUGIN_FILE"
}

status() {
  echo "scope: user"
  echo "opencode dir: $OPENCODE_DIR"
  echo "config: $OPENCODE_CONFIG"
  if [[ -f "$PLUGIN_FILE" ]]; then
    echo "compaction plugin: $PLUGIN_FILE (installed)"
  else
    echo "compaction plugin: not installed"
  fi
  if [[ -f "$OPENCODE_CONFIG" ]] && grep -q "$MARKER" "$OPENCODE_CONFIG" 2>/dev/null; then
    echo "status: installed"
    echo "model: $(jq -r '.model // "unset"' "$OPENCODE_CONFIG" 2>/dev/null || echo 'unknown')"
    echo "context limit: $(jq -r '
      (.model // "") as $m
      | ($m | sub("^subconscious/"; "")) as $id
      | .provider.subconscious.models[$id].limit.context // "unset"
    ' "$OPENCODE_CONFIG" 2>/dev/null || echo 'unknown')"
    echo "compaction.auto: $(jq -r '.compaction.auto // true' "$OPENCODE_CONFIG" 2>/dev/null || echo 'unknown')"
  else
    echo "status: not installed"
  fi
  if [[ -f "${OPENCODE_DIR}/subconscious.env" ]]; then
    echo "env: ${OPENCODE_DIR}/subconscious.env (present)"
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
    write_plugin
    echo "Installed Subconscious OpenCode config at $OPENCODE_CONFIG"
    if [[ -f "$PLUGIN_FILE" ]]; then
      echo "Installed compaction reporting plugin at $PLUGIN_FILE"
    fi
    echo "Source the env file before launching opencode:"
    echo "  source ${OPENCODE_DIR}/subconscious.env"
    echo "Or export SUBCONSCIOUS_API_KEY in your shell profile."
    echo "Restart any running opencode sessions."
    ;;
  uninstall)
    uninstall_config
    echo "Removed Subconscious OpenCode config from $OPENCODE_DIR"
    ;;
  status)
    status
    ;;
esac
