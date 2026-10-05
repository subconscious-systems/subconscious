#!/usr/bin/env bash
# Write the temporary Codex model catalog and merge the compaction hooks, then
# start the codex argv subc built. Nothing is written to ~/.codex/config.toml.
#
# This needs a gateway that round-trips Codex's namespaced tools. Codex sends
# them as `type: "namespace"` and resolves an incoming call by namespace plus
# name, so a gateway that flattens the namespace for the model must restore it
# on the way back, or every call fails with "unsupported call: spawn_agent".

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../lib.sh"

write_model_catalog() {
  local catalog_file="$1" model_id vision_fields index=0 multi_agent_json="null"
  if [[ -n "$CODEX_MULTI_AGENT_VERSION" ]]; then
    multi_agent_json="\"${CODEX_MULTI_AGENT_VERSION}\""
  fi
  {
    printf '{\n  "models": [\n'
    # The requested model comes first; the rest fill Codex's /model picker.
    while IFS= read -r model_id; do
      # Codex assumes ["text", "image"] when the field is missing, so a
      # text-only model must say so or Codex sends it images anyway.
      vision_fields=', "input_modalities": ["text"]'
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
    done <<< "$SUBC_MODEL_IDS"
    printf '\n  ]\n}\n'
  } >"$catalog_file"
}

# The hooks library writes its env file from these two.
API_KEY="$SUBCONSCIOUS_API_KEY"
GATEWAY_URL="$SUBCONSCIOUS_GATEWAY_URL"

# Merge compaction hooks without replacing ~/.codex/hooks.json or config.toml.
# `codex_ensure_hooks` returns early when they are already current, so a launch
# that changes nothing writes nothing: Codex decides what counts as a new hook
# from what is on disk, and rewriting an identical one reset the trust the user
# had already granted.
HOOK_SRC="${SCRIPT_DIR}/hook.sh"
# shellcheck source=hooks-lib.sh
source "${SCRIPT_DIR}/hooks-lib.sh"
codex_ensure_hooks best-effort >&2 || true

# Without a catalog Codex prints "model metadata not found", and a catalog
# cannot be passed with -c. Codex replaces this shell, so the file outlives it.
CATALOG_FILE="$(mktemp -t codex-model-catalog.XXXXXX.json)"
write_model_catalog "$CATALOG_FILE"

subc_exec "{tempFile}" "$CATALOG_FILE" -- "$@"
