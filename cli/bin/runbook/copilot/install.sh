#!/usr/bin/env bash
# ── Subconscious API Gateway — GitHub Copilot in VS Code setup ────────────────
# Point GitHub Copilot Chat in VS Code at your gateway and install hooks for
# conversation correlation.
#
# Quick start:
#   ./install.sh                        # reads GATEWAY_URL + API_KEY from ../.env
#   ./install.sh --gateway-url https://your-gateway.example --api-key sk-gw-...
#   ./install.sh status                 # show current config + hooks
#   ./install.sh uninstall              # remove provider + hooks
#
# `install` is the default subcommand. It does two things:
#   1. Writes a Custom Endpoint provider into VS Code's chatLanguageModels.json
#   2. Installs VS Code agent hooks (~/.copilot/hooks/) for conversation correlation
#
# The API key for the model provider is NOT passed on the command line — VS Code
# requires it to be entered through its UI (the script writes a stable
# ${input:chat.lm.secret.*} reference, and you paste the key once via Manage
# Language Models). The API key for the hooks is read from .env or --api-key
# and stored in ~/.copilot/subconscious-hooks.env (mode 600).
#
# Assumes VS Code is installed globally (Code or Code - Insiders). Restart
# VS Code after install so it reloads chatLanguageModels.json and hooks.
#
# ── What this does under the hood ────────────────────────────────────────────
# Writes a Custom Endpoint provider entry into chatLanguageModels.json:
#
#   [
#     {
#       "name": "Subconscious Gateway",
#       "vendor": "customendpoint",
#       "apiKey": "${input:chat.lm.secret.subconscious-gateway}",
#       "apiType": "chat-completions",
#       "models": [
#         {
#           "id": "subconscious/glm-5.2",
#           "name": "Subconscious GLM 5.2",
#           "url": "https://your-gateway.example/v1/chat/completions",
#           "toolCalling": true,
#           "vision": false,
#           "maxInputTokens": 5000000,
#           "maxOutputTokens": 65536,
#           "thinking": true,
#           "streaming": true,
#           "requestHeaders": { "x-subconscious-client": "copilot" }
#         }
#       ]
#     }
#   ]
#
# And installs VS Code agent hooks (~/.copilot/hooks/) that POST to
# /v1/agent-hooks:
#   UserPromptSubmit -> conversation_ensure (+ compaction end if pending)
#   PreCompact       -> conversation_compaction phase start
# There is no PostCompact; the next UserPromptSubmit closes the window so the
# summarization LLM turn between them is billed as compaction. Manual compact
# does not fire PreCompact (accepted gap). The gateway fingerprints prompts and
# chains turns; subagents need no extra hooks. The x-subconscious-client:
# copilot header (hook script + model requestHeaders) classifies the traffic.
# hooks: https://code.visualstudio.com/docs/copilot/customization/hooks
# PreCompact: https://code.visualstudio.com/docs/agents/reference/hooks-reference#precompact
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SRC="${SCRIPT_DIR}/hook.sh"
HOOKS_TEMPLATE="${SCRIPT_DIR}/hooks.json"

# Load shared env from SUBC_ENV_FILE, or a sibling .env / env.example.
SHARED_ENV="${SUBC_ENV_FILE:-${SCRIPT_DIR}/../.env}"
[[ -f "$SHARED_ENV" ]] || SHARED_ENV="${SCRIPT_DIR}/../env.example"
if [[ -f "$SHARED_ENV" ]]; then set -a; source "$SHARED_ENV"; set +a; fi

# Default to `install` so `./install.sh --gateway-url URL` works without an
# explicit `install` subcommand. `status` / `uninstall` still work.
COMMAND="install"
GATEWAY_URL="${GATEWAY_URL:-}"
API_KEY="${COPILOT_API_KEY:-${API_KEY:-}}"
MODEL="${MODEL:-subconscious/glm-5.2}"
MAX_INPUT_TOKENS="${COPILOT_MAX_INPUT_TOKENS:-5000000}"
MAX_OUTPUT_TOKENS="${COPILOT_MAX_OUTPUT_TOKENS:-65536}"
VSCODE_APP="${VSCODE_APP:-}"  # auto-detected: Code | Code - Insiders | VSCodium

# VS Code's customendpoint provider requires the apiKey to be a
# ${input:chat.lm.secret.<id>} reference into its OS secret store — a plaintext
# key is silently dropped (microsoft/vscode#322299). The secret itself must be
# entered through VS Code's UI ("Add Models" → "Custom Endpoint"). The script
# writes a stable secret id so you only enter the key once.
SECRET_ID="chat.lm.secret.subconscious-gateway"

# Hooks are installed user-wide under ~/.copilot (VS Code user hooks dir).
COPILOT_DIR="${HOME}/.copilot"
HOOKS_DIR="${COPILOT_DIR}/hooks"
HOOK_DST="${HOOKS_DIR}/subconscious-hook.sh"
HOOKS_JSON="${HOOKS_DIR}/subconscious-hooks.json"
ENV_FILE="${COPILOT_DIR}/subconscious-hooks.env"
MARKER="subconscious-hook.sh"

usage() {
  cat <<'EOF'
Usage:
  subc copilot install [--gateway-url URL] [--api-key KEY] [--model MODEL]
  subc copilot uninstall
  subc copilot status

`install` is the default subcommand. It writes a "Subconscious Gateway"
Custom Endpoint provider into VS Code's user-wide chatLanguageModels.json
AND installs VS Code agent hooks for conversation correlation.

The API key for the model provider is NOT passed on the command line — VS Code
requires it to be entered through its UI (the script writes a stable
${input:chat.lm.secret.*} reference into chatLanguageModels.json, and you
paste the key once via Manage Language Models).

The API key for the hooks is read from the profile env or --api-key and
stored in ~/.copilot/subconscious-hooks.env (mode 600).

Reads GATEWAY_URL, API_KEY, and MODEL from the profile env by
default. Restart VS Code after install.

Options:
  --gateway-url URL         Gateway origin (default: $GATEWAY_URL from .env)
  --api-key KEY             Gateway API key for hooks (default: $API_KEY from .env)
  --model MODEL             Model id (default: subconscious/glm-5.2)
  --max-input-tokens N      Model context window input tokens (default: 5000000)
  --max-output-tokens N     Model max output tokens (default: 65536)
  --vscode-app APP          Code, Code - Insiders, or VSCodium (auto-detected)

Requires: jq, curl. Restart VS Code after install, then enter your model API
key once via Manage Language Models.
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
    --max-input-tokens)
      MAX_INPUT_TOKENS="${2:-}"
      shift 2
      ;;
    --max-output-tokens)
      MAX_OUTPUT_TOKENS="${2:-}"
      shift 2
      ;;
    --vscode-app)
      VSCODE_APP="${2:-}"
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

PROVIDER_NAME="Subconscious Gateway"
MARKER='Subconscious Gateway'

require_cmds() {
  local missing=0
  for c in jq curl; do
    if ! command -v "$c" >/dev/null 2>&1; then
      echo "missing required command: $c" >&2
      missing=1
    fi
  done
  if [[ "$missing" -ne 0 ]]; then
    exit 1
  fi
}

# Resolve the VS Code User directory across platforms.
# macOS:   ~/Library/Application Support/Code/User
# Linux:   ~/.config/Code/User
# Windows: %APPDATA%\Code\User (Git Bash: ~/AppData/Roaming/Code/User)
detect_vscode_dir() {
  local app="${VSCODE_APP:-}"
  if [[ -z "$app" ]]; then
    if [[ -d "${HOME}/Library/Application Support/Code/User" ]]; then
      app="Code"
    elif [[ -d "${HOME}/Library/Application Support/Code - Insiders/User" ]]; then
      app="Code - Insiders"
    elif [[ -d "${HOME}/.config/Code/User" ]]; then
      app="Code"
    elif [[ -d "${HOME}/.config/Code - Insiders/User" ]]; then
      app="Code - Insiders"
    elif [[ -d "${HOME}/.config/VSCodium/User" ]]; then
      app="VSCodium"
    elif [[ -d "${HOME}/AppData/Roaming/Code/User" ]]; then
      app="Code"
    else
      echo "could not find a VS Code User directory; pass --vscode-app explicitly" >&2
      exit 1
    fi
  fi

  local user_dir=""
  case "$(uname -s)" in
    Darwin)
      user_dir="${HOME}/Library/Application Support/${app}/User"
      ;;
    Linux)
      user_dir="${HOME}/.config/${app}/User"
      ;;
    MINGW*|MSYS*|CYGWIN*)
      user_dir="${HOME}/AppData/Roaming/${app}/User"
      ;;
    *)
      echo "unsupported platform: $(uname -s)" >&2
      exit 1
      ;;
  esac

  if [[ ! -d "$user_dir" ]]; then
    echo "VS Code User directory not found: $user_dir" >&2
    echo "pass --vscode-app with the correct app name" >&2
    exit 1
  fi
  echo "$user_dir"
}

# The ${input:...} prefix VS Code uses to reference secrets in chatLanguageModels.json.
INPUT_PREFIX='${input:'

# Strip any prior Subconscious provider entry, preserving other providers.
strip_subconscious() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "[]"
    return
  fi
  jq --arg name "$PROVIDER_NAME" \
    'map(select(.name != $name and ((.name // "") | test("subconscious"; "i") | not)))' \
    "$file" 2>/dev/null || echo "[]"
}

write_config() {
  local user_dir="$1"
  local models_json="${user_dir}/chatLanguageModels.json"
  local base_url="${GATEWAY_URL%/}"
  local chat_url
  case "$base_url" in
    */v1/chat/completions) chat_url="$base_url" ;;
    */v1) chat_url="${base_url}/chat/completions" ;;
    *) chat_url="${base_url}/v1/chat/completions" ;;
  esac

  mkdir -p "$user_dir"
  local existing
  existing="$(strip_subconscious "$models_json")"

  local provider_models='[]' model_id
  for model_id in "${SUPPORTED_MODELS[@]}"; do
    provider_models=$(jq -cn \
      --argjson models "$provider_models" \
      --arg modelId "$model_id" \
      --arg modelName "Subconscious ${model_id}" \
      --arg url "$chat_url" \
      --argjson maxIn "$MAX_INPUT_TOKENS" \
      --argjson maxOut "$MAX_OUTPUT_TOKENS" \
      '$models + [{
        id: $modelId,
        name: $modelName,
        url: $url,
        toolCalling: true,
        vision: false,
        maxInputTokens: $maxIn,
        maxOutputTokens: $maxOut,
        thinking: true,
        streaming: true,
        requestHeaders: { "x-subconscious-client": "copilot" }
      }]')
  done

  local new_provider
  new_provider=$(jq -n \
    --arg name "$PROVIDER_NAME" \
    --arg apiKeyRef "${INPUT_PREFIX}${SECRET_ID}}" \
    --argjson models "$provider_models" \
    '{
      name: $name,
      vendor: "customendpoint",
      apiKey: $apiKeyRef,
      apiType: "chat-completions",
      models: $models
    }')

  local merged
  merged=$(echo "$existing" | jq --argjson p "$new_provider" '. + [$p]')

  umask 077
  echo "$merged" >"$models_json"
  umask 022
  echo "$models_json"
}

uninstall_config() {
  local user_dir="$1"
  local models_json="${user_dir}/chatLanguageModels.json"
  if [[ -f "$models_json" ]]; then
    if grep -qi "$MARKER" "$models_json" 2>/dev/null; then
      local tmp
      tmp="$(mktemp)"
      jq --arg name "$PROVIDER_NAME" \
        'map(select(.name != $name and ((.name // "") | test("subconscious"; "i") | not)))' \
        "$models_json" >"$tmp"
      mv "$tmp" "$models_json"
      echo "Removed Subconscious provider from $models_json"
    else
      echo "No Subconscious provider found in $models_json"
    fi
  else
    echo "No chatLanguageModels.json at $models_json"
  fi
}

# ── Hooks installation ────────────────────────────────────────────────────────

write_hooks_env() {
  umask 077
  cat >"$ENV_FILE" <<EOF
# Generated by subc — do not commit secrets.
export SUBCONSCIOUS_GATEWAY_URL='${GATEWAY_URL}'
export SUBCONSCIOUS_API_KEY='${API_KEY}'
EOF
  chmod 600 "$ENV_FILE"
}

install_hook_script() {
  mkdir -p "$HOOKS_DIR"
  cp "$HOOK_SRC" "$HOOK_DST"
  chmod +x "$HOOK_DST"
}

write_hooks_json() {
  sed "s|HOOK_SH_PATH|${HOOK_DST}|g" "$HOOKS_TEMPLATE" >"$HOOKS_JSON"
}

uninstall_hooks() {
  rm -f "$HOOK_DST" "$HOOKS_JSON" "$ENV_FILE"
  rm -rf "${COPILOT_DIR}/subconscious-compact-pending"
}

hooks_status() {
  echo "hooks dir: $HOOKS_DIR"
  if [[ -x "$HOOK_DST" ]]; then
    echo "hook script: $HOOK_DST (executable)"
  else
    echo "hook script: missing"
  fi
  if [[ -f "$HOOKS_JSON" ]]; then
    echo "hooks json: $HOOKS_JSON (present)"
  else
    echo "hooks json: missing"
  fi
  if [[ -f "$ENV_FILE" ]]; then
    echo "hooks env: $ENV_FILE (present)"
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    echo "gateway: ${SUBCONSCIOUS_GATEWAY_URL:-unset}"
    if [[ -n "${SUBCONSCIOUS_API_KEY:-}" ]]; then
      echo "hooks api key: set (${#SUBCONSCIOUS_API_KEY} chars)"
    else
      echo "hooks api key: unset"
    fi
  else
    echo "hooks env: missing"
  fi
}

status() {
  local user_dir="$1"
  echo "scope: user"
  echo "vscode user dir: $user_dir"
  local models_json="${user_dir}/chatLanguageModels.json"
  echo "config: $models_json"
  if [[ -f "$models_json" ]] && grep -qi "$MARKER" "$models_json" 2>/dev/null; then
    echo "model provider: installed"
    echo "models: $(jq -r --arg name "$PROVIDER_NAME" '.[] | select(.name == $name) | [.models[].id] | join(", ")' "$models_json" 2>/dev/null || echo 'unknown')"
    echo "url: $(jq -r --arg name "$PROVIDER_NAME" '.[] | select(.name == $name) | .models[0].url' "$models_json" 2>/dev/null || echo 'unknown')"
  else
    echo "model provider: not installed"
  fi
  echo ""
  hooks_status
}

case "$COMMAND" in
  install)
    require_cmds
    if [[ -z "$GATEWAY_URL" ]]; then
      echo "--gateway-url is required for install (or set GATEWAY_URL in .env)" >&2
      exit 1
    fi
    if [[ -z "$API_KEY" ]]; then
      echo "--api-key is required for hooks (or set API_KEY in .env)" >&2
      exit 1
    fi
    USER_DIR="$(detect_vscode_dir)"
    WRITTEN="$(write_config "$USER_DIR")"
    echo "Installed Subconscious Copilot provider into $WRITTEN"
    echo "Gateway base URL: ${GATEWAY_URL%/}/v1"
    install_hook_script
    write_hooks_env
    write_hooks_json
    echo "Installed Subconscious Copilot hooks into $COPILOT_DIR"
    echo ""
    echo "IMPORTANT: VS Code requires the model API key to be stored in its"
    echo "secret store — a plaintext key in the JSON is silently dropped."
    echo "Enter the key once through the VS Code UI:"
    echo ""
    echo "  1. Restart VS Code (fully quit, not just reload)."
    echo "  2. Open Chat → model picker (gear) → Manage Language Models."
    echo "  3. Find 'Subconscious Gateway' → click the key icon to set the API key."
    echo "  4. Paste your gateway API key (sk-gw-...)."
    echo ""
    echo "The hooks use a separate API key from ~/.copilot/subconscious-hooks.env."
    echo "Both keys can be the same gateway API key."
    echo ""
    echo "After restart, choose a Subconscious model from the model picker."
    ;;
  uninstall)
    require_cmds
    USER_DIR="$(detect_vscode_dir)"
    uninstall_config "$USER_DIR"
    uninstall_hooks
    echo "Removed Subconscious Copilot hooks from $COPILOT_DIR"
    echo "Restart VS Code for the change to take effect."
    ;;
  status)
    require_cmds
    USER_DIR="$(detect_vscode_dir)"
    status "$USER_DIR"
    ;;
esac
