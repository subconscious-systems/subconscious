#!/usr/bin/env bash
# Write a temporary Cordis overlay that adds the live Subconscious catalog,
# then start the dsh argv subc built. The user's DSH settings and profiles are
# not rewritten.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../lib.sh"

CONTEXT_WINDOW="$DEEPSEEK_HARNESS_CONTEXT_WINDOW"
MAX_TOKENS="$DEEPSEEK_HARNESS_MAX_TOKENS"
if [[ ! "$CONTEXT_WINDOW" =~ ^[1-9][0-9]*$ ]]; then
  echo "error: DEEPSEEK_HARNESS_CONTEXT_WINDOW must be a positive integer" >&2
  exit 1
fi
if [[ ! "$MAX_TOKENS" =~ ^[1-9][0-9]*$ ]]; then
  echo "error: DEEPSEEK_HARNESS_MAX_TOKENS must be a positive integer" >&2
  exit 1
fi

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
  while IFS= read -r model_id; do
    printf "          - id: '%s'\n" "$model_id"
    printf "            name: '%s'\n" "$model_id"
    if subc_model_supports_vision "$model_id"; then
      printf '%s\n' '            input: [text, image]'
    fi
    printf "            contextWindow: %s\n" "$CONTEXT_WINDOW"
    printf "            maxTokens: %s\n" "$MAX_TOKENS"
  done <<< "$SUBC_MODEL_IDS"
  printf '%s\n' \
    '- id: agent-default-model' \
    '  config:' \
    '    provider: subconscious' \
    "    model: '${MODEL}'"
} >"$OVERLAY_FILE"
chmod 600 "$OVERLAY_FILE"

# dsh replaces this shell, keeping its PID, so signals and the exit status
# are dsh's own. A detached watcher removes the overlay once that PID exits.
runbook_pid=$$
(
  # A stop sent to the whole process group must not kill the watcher first.
  trap '' HUP INT TERM
  set +e
  while kill -0 "$runbook_pid" 2>/dev/null; do sleep 1; done
  cleanup
) </dev/null >/dev/null 2>&1 &
trap - EXIT HUP INT TERM

subc_exec "{tempFile}" "$OVERLAY_FILE" -- "$@"
