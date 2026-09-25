#!/usr/bin/env bash
# Point the `codex` CLI at the Subconscious gateway — ephemerally.
#
# Uses `codex -c key=value` overrides so nothing is written to ~/.codex/config.toml.
# web_search is disabled so Codex doesn't send hosted tools the gateway can't execute.
# The model catalog (needed to suppress the "model metadata not found" warning)
# is written to a temp file that is cleaned up on exit.
#
# Subagents are ON by default. The per-model `multi_agent_version` catalog
# field selects WHICH implementation Codex offers, not whether it offers one:
# "v2" gives the `collaboration` namespace, and an empty value falls back to
# the older `multi_agent_v1` namespace rather than turning subagents off.
# Only `agents.enabled=false` actually disables them, so clearing
# CODEX_MULTI_AGENT_VERSION does both.
#
# This needs a gateway that round-trips Codex's namespaced tools. Codex sends
# them as `type: "namespace"` and resolves an incoming call by namespace plus
# name, so a gateway that flattens the namespace for the model must restore it
# on the way back, or every call fails with "unsupported call: spawn_agent".
#
# Usage:
#   ./run.sh                         # uses GATEWAY_URL/API_KEY from ../.env
#   ./run.sh --context-window 5000000 -- --resume
#   ./run.sh --stream-idle-timeout 1800000  # allow a 30min silent think
#   ./run.sh --max-subagents 12        # raise the concurrent-subagent ceiling
#   ./run.sh --subagent-effort low     # cheaper subagents than the parent
#   ./run.sh --external-tools          # include Codex apps/plugins (may exceed gateway tool limits)
#
# Config: copy ../env.example to ../.env and edit. .env is gitignored.
# Profile env is injected by subc. A sibling .env is only used when SUBC_ENV_FILE is unset.
#
# Or source it to just export the env:
#   source run.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../model-capabilities.generated.sh"

# Load shared env from SUBC_ENV_FILE, or a sibling .env / env.example.
SHARED_ENV="${SUBC_ENV_FILE:-${SCRIPT_DIR}/../.env}"
[[ -f "$SHARED_ENV" ]] || SHARED_ENV="${SCRIPT_DIR}/../env.example"
if [[ -f "$SHARED_ENV" ]]; then set -a; source "$SHARED_ENV"; set +a; fi

GATEWAY_URL="${GATEWAY_URL:-}"
API_KEY="${CODEX_API_KEY:-${API_KEY:-}}"
MODEL="${MODEL:-subconscious/glm-5.3-marathon}"
MAX_CONCURRENT_SUBAGENTS="${MAX_CONCURRENT_SUBAGENTS:-}"
# Effort for spawned agents, independent of the parent's. Empty inherits the
# Codex default. See the note above SUBAGENT_ARGS for why max is a poor choice.
#
# Low rather than medium: the gateway rounds medium up to high for GLM, and at
# high a subagent handed an open-ended task keeps deliberating without ever
# writing the closing `</think>`. The turn then comes back as one long block of
# prose with no tool call, so the agent reports success having produced no
# files. Measured against the worker on one broad task: low closed and called a
# tool in ~1.5k characters, high ran past 76k and was still going.
CODEX_SUBAGENT_REASONING_EFFORT="${CODEX_SUBAGENT_REASONING_EFFORT-low}"
EXTERNAL_TOOLS="${CODEX_EXTERNAL_TOOLS:-false}"
CODEX_CONTEXT_WINDOW="${CODEX_CONTEXT_WINDOW:-5000000}"
CODEX_MAX_CONTEXT_WINDOW="${CODEX_MAX_CONTEXT_WINDOW:-}"
CODEX_AUTO_COMPACT_TOKEN_LIMIT="${CODEX_AUTO_COMPACT_TOKEN_LIMIT:-4500000}"
CODEX_REASONING_EFFORT="${CODEX_REASONING_EFFORT:-max}"
# How long Codex waits on a silent stream before giving up. The marathon models
# at max reasoning effort routinely think for longer than five minutes without
# emitting a token, and a subagent's turn is one uninterrupted think with no
# visible progress, so the old 300s ceiling cut off work that was still running.
CODEX_STREAM_IDLE_TIMEOUT_MS="${CODEX_STREAM_IDLE_TIMEOUT_MS:-900000}"
# Codex gates its subagent tools on this per-model catalog field. Only "v2" is
# honored by current releases; "v1" registers nothing. Set to empty to opt out.
# Unset defaults to v2; an explicitly empty value opts out, so use `-` not `:-`.
CODEX_MULTI_AGENT_VERSION="${CODEX_MULTI_AGENT_VERSION-v2}"

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
      --stream-idle-timeout)
        CODEX_STREAM_IDLE_TIMEOUT_MS="${2:-}"
        shift 2
        ;;
      --max-subagents)
        MAX_CONCURRENT_SUBAGENTS="${2:-}"
        shift 2
        ;;
      --subagent-effort)
        CODEX_SUBAGENT_REASONING_EFFORT="${2:-}"
        shift 2
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

DEFAULT_SUBCONSCIOUS_MODELS="subconscious/glm-5.3-marathon
subconscious/glm-5.2
subconscious/tim-qwen3.6-27b
subconscious/deepseek-v4-flash-marathon
subconscious/deepseek-v4.1-flash-marathon"
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
# catalog in Codex's /model picker. The CLI supplies the live gateway catalog;
# the packaged fallback keeps the vendored runbook useful on its own.
add_supported_model "$MODEL"
while IFS= read -r model_id; do
  add_supported_model "$model_id"
done <<< "${SUBCONSCIOUS_MODELS:-$DEFAULT_SUBCONSCIOUS_MODELS}"

write_model_catalog() {
  local catalog_file="$1" model_id vision_fields index=0 multi_agent_json="null"
  if [[ -n "$CODEX_MULTI_AGENT_VERSION" ]]; then
    multi_agent_json="\"${CODEX_MULTI_AGENT_VERSION}\""
  fi
  {
    printf '{\n  "models": [\n'
    for model_id in "${SUPPORTED_MODELS[@]}"; do
      vision_fields=""
      if subc_model_supports_vision "$model_id"; then
        vision_fields=', "input_modalities": ["text", "image"]'
      fi
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
      "supported_reasoning_levels": [
        { "effort": "none", "description": "No additional reasoning" },
        { "effort": "low", "description": "Fast responses with lighter reasoning" },
        { "effort": "medium", "description": "Balances speed and reasoning depth" },
        { "effort": "high", "description": "Greater reasoning depth for complex problems" },
        { "effort": "max", "description": "Maximum reasoning depth for the hardest problems" }
      ],
      "shell_type": "shell_command",
      "visibility": "list",
      "supported_in_api": true,
      "priority": 0,
      "service_tiers": [
        {
          "id": "priority",
          "name": "Priority",
          "description": "Route requests through the configured priority service tier"
        }
      ],
      "availability_nux": null,
      "upgrade": null,
      "base_instructions": "You are Codex, a coding agent.",
      "supports_reasoning_summaries": false,
      "support_verbosity": false,
      "default_verbosity": null,
      "apply_patch_tool_type": "freeform",
      "truncation_policy": { "mode": "tokens", "limit": 10000 },
      "supports_parallel_tool_calls": true,
      "multi_agent_version": ${multi_agent_json},
      "use_responses_lite": false,
      "experimental_supported_tools": []${vision_fields}
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

# Bound the subagent tree when the catalog turns it on. Codex still only spawns
# a subagent when the user asks for one; these are ceilings, not defaults.
#
# Codex documents no nesting-depth limit, so a subagent can spawn its own
# subagent and the tree can grow deeper than you asked for. Capping concurrency
# is the only lever available.
#
# Subagent reasoning effort is set separately from the parent's on purpose: the
# marathon models at max effort think for many minutes without emitting a
# token, and a subagent turn is one uninterrupted think, so inheriting max
# makes every delegated subtask look like a hang.
# Applied after argument parsing so --max-subagents can win. Four is a floor
# rather than a considered limit: Codex's own default is three, and exceeding
# either one fails the spawn outright rather than queueing it, so a run that
# wants more should say so instead of collecting retries.
MAX_CONCURRENT_SUBAGENTS="${MAX_CONCURRENT_SUBAGENTS:-4}"

SUBAGENT_ARGS=()
if [[ -z "$CODEX_MULTI_AGENT_VERSION" ]]; then
  # Clearing the catalog field alone only downgrades Codex to multi-agent v1,
  # whose tools this gateway has never been exercised against. Turn the
  # feature off outright instead.
  SUBAGENT_ARGS=(-c agents.enabled=false)
else
  SUBAGENT_ARGS=(
    -c agents.max_concurrent_threads_per_session="${MAX_CONCURRENT_SUBAGENTS}"
    -c agents.interrupt_message=true
  )
  if [[ -n "$CODEX_SUBAGENT_REASONING_EFFORT" ]]; then
    SUBAGENT_ARGS+=(
      -c agents.default_subagent_reasoning_effort="${CODEX_SUBAGENT_REASONING_EFFORT}"
    )
  fi
fi

if [[ -z "$GATEWAY_URL" || -z "$API_KEY" ]]; then
  echo "error: GATEWAY_URL and API_KEY must be set in ../.env" >&2
  exit 1
fi

export SUBCONSCIOUS_API_KEY="$API_KEY"
export SUBCONSCIOUS_GATEWAY_URL="${GATEWAY_URL%/}"

# Merge compaction hooks without replacing ~/.codex/hooks.json or config.toml.
# `codex_ensure_hooks` returns early when they are already current, so a launch
# that changes nothing writes nothing: Codex decides what counts as a new hook
# from what is on disk, and rewriting an identical one reset the trust the user
# had already granted.
HOOK_SRC="${SCRIPT_DIR}/hook.sh"
# shellcheck source=hooks-lib.sh
source "${SCRIPT_DIR}/hooks-lib.sh"
codex_ensure_hooks best-effort || true

# Write a temp model catalog so Codex doesn't print "model metadata not found".
# This is the one thing that can't be passed via -c flags.
CATALOG_FILE="$(mktemp -t codex-model-catalog.XXXXXX.json)"
cleanup() { rm -f "$CATALOG_FILE"; }
trap cleanup EXIT
write_model_catalog "$CATALOG_FILE"

# If sourced, just export env and return.
if [[ "${BASH_SOURCE[0]:-$0}" != "${0}" ]]; then
  export GATEWAY_URL CATALOG_FILE MAX_CONCURRENT_SUBAGENTS CODEX_SUBAGENT_REASONING_EFFORT
  return 0 2>/dev/null || true
fi

# Ephemeral config via -c flags — nothing is written to ~/.codex/config.toml.
exec codex \
  -c model="${MODEL}" \
  -c model_provider=subconscious \
  -c model_catalog_json="${CATALOG_FILE}" \
  -c model_reasoning_effort="${CODEX_REASONING_EFFORT}" \
  -c web_search=disabled \
  ${EXTERNAL_TOOL_ARGS[@]+"${EXTERNAL_TOOL_ARGS[@]}"} \
  ${SUBAGENT_ARGS[@]+"${SUBAGENT_ARGS[@]}"} \
  -c model_providers.subconscious.name=Subconscious \
  -c model_providers.subconscious.base_url="${GATEWAY_URL}/v1" \
  -c model_providers.subconscious.wire_api=responses \
  -c model_providers.subconscious.env_key=SUBCONSCIOUS_API_KEY \
  -c model_providers.subconscious.stream_idle_timeout_ms="${CODEX_STREAM_IDLE_TIMEOUT_MS}" \
  ${PASSTHRU[@]+"${PASSTHRU[@]}"}
