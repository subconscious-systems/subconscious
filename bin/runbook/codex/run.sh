#!/usr/bin/env bash
# Write the temporary Codex model catalog, remove the hooks that older subc
# versions installed, then start the codex argv subc built. Nothing is written
# to ~/.codex/config.toml.
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

# Replace CATALOG_FILE only when its content changes. The temp file sits in
# the same directory, so the rename is atomic and a reader never sees half a
# catalog.
replace_model_catalog() {
  local catalog_file="$1" next
  next="$(mktemp "$(dirname "$catalog_file")/.catalog.XXXXXX")"
  chmod 600 "$next"
  write_model_catalog "$next"
  if cmp -s "$next" "$catalog_file"; then
    rm -f "$next"
  else
    mv -f "$next" "$catalog_file"
  fi
}

# A protocol launch is one a host such as T3 Code starts many times to probe
# Codex (`subc t3`). It sets SUBC_CODEX_PROTOCOL_LAUNCH=1 and
# SUBC_CODEX_CATALOG_FILE, and reuses one catalog file instead of a new temp
# file per probe. It skips the hook cleanup below: `subc t3 install` already
# removed what older versions left. Every other launch leaves both unset.
if [[ "${SUBC_CODEX_PROTOCOL_LAUNCH:-}" == "1" ]]; then
  CATALOG_FILE="${SUBC_CODEX_CATALOG_FILE:?protocol launches need SUBC_CODEX_CATALOG_FILE}"
  unset SUBC_CODEX_PROTOCOL_LAUNCH SUBC_CODEX_CATALOG_FILE
  replace_model_catalog "$CATALOG_FILE"
  subc_exec "{tempFile}" "$CATALOG_FILE" -- "$@"
fi

# Remove the compaction hooks older subc versions merged into hooks.json.
# This writes nothing when none are left.
# shellcheck source=legacy-hooks.sh
source "${SCRIPT_DIR}/legacy-hooks.sh"
if codex_has_legacy_hooks; then
  codex_remove_legacy_hooks quiet >&2 || true
fi

# Without a catalog Codex prints "model metadata not found", and a catalog
# cannot be passed with -c. Codex replaces this shell, so the file outlives it.
CATALOG_FILE="$(mktemp -t codex-model-catalog.XXXXXX.json)"
write_model_catalog "$CATALOG_FILE"

subc_exec "{tempFile}" "$CATALOG_FILE" -- "$@"
