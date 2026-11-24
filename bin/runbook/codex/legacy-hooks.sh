#!/usr/bin/env bash
# Remove the Codex compaction hooks that older subc versions installed.
# Sourced by install.sh and run.sh. subc no longer installs any Codex hooks.
#
# Older versions merged PreCompact and PostCompact entries into
# ~/.codex/hooks.json and wrote a hook script, its env file, and a log
# directory next to it. This strips only the entries whose command names our
# hook script and keeps every other hook. It never touches config.toml.

# Older hooks lived in the Codex home of the launch that wrote them, which is
# CODEX_HOME when set, so the cleanup looks there too.
CODEX_DIR="${CODEX_DIR:-${CODEX_HOME:-${HOME}/.codex}}"
HOOKS_JSON="${HOOKS_JSON:-${CODEX_DIR}/hooks.json}"
LEGACY_MARKER="subconscious-hook.sh"
LEGACY_FILES=(
  "${CODEX_DIR}/subconscious-hook.sh"
  "${CODEX_DIR}/subconscious-hooks.env"
  "${CODEX_DIR}/subconscious.env"
)
LEGACY_LOG_DIR="${CODEX_DIR}/subconscious-hook-logs"

codex_hooks_json_has_legacy() {
  [[ -f "$HOOKS_JSON" ]] && grep -q "$LEGACY_MARKER" "$HOOKS_JSON" 2>/dev/null
}

codex_has_legacy_hooks() {
  local file
  codex_hooks_json_has_legacy && return 0
  for file in "${LEGACY_FILES[@]}"; do
    [[ -e "$file" ]] && return 0
  done
  [[ -e "$LEGACY_LOG_DIR" ]]
}

# Removes our entries from hooks.json. An entry or event is dropped only when
# ours were the last hooks in it; everything else is written back unchanged.
codex_strip_legacy_entries() {
  local tmp
  tmp="$(mktemp)"
  jq --arg marker "$LEGACY_MARKER" '
    def ours: (.command // "") | tostring | contains($marker);
    def has_ours: (.hooks | type) == "array" and any(.hooks[]; ours);
    def strip:
      map(
        if has_ours then
          (.hooks |= map(select(ours | not))) | select(.hooks | length > 0)
        else . end
      );
    if (.hooks | type) == "object" then
      .hooks |= with_entries(
        if (.value | type) == "array" and any(.value[]; has_ours) then
          (.value |= strip) | select(.value | length > 0)
        else . end
      )
    else . end
  ' "$HOOKS_JSON" >"$tmp" || {
    rm -f "$tmp"
    return 1
  }
  mv "$tmp" "$HOOKS_JSON"
}

# codex_remove_legacy_hooks verbose|quiet
# Returns 1 only when hooks.json holds our entries and could not be cleaned.
codex_remove_legacy_hooks() {
  local mode="${1:-verbose}" status=0
  if codex_hooks_json_has_legacy; then
    if ! command -v jq >/dev/null 2>&1; then
      echo "warning: jq is required to remove the old Subconscious entries from ${HOOKS_JSON}; leaving it unchanged" >&2
      status=1
    elif ! jq -e . "$HOOKS_JSON" >/dev/null 2>&1; then
      echo "warning: ${HOOKS_JSON} is not valid JSON; leaving it unchanged" >&2
      status=1
    elif codex_strip_legacy_entries; then
      [[ "$mode" == quiet ]] || echo "Removed the old Subconscious compaction hooks from $HOOKS_JSON"
    else
      echo "warning: could not update ${HOOKS_JSON}; leaving it unchanged" >&2
      status=1
    fi
  fi
  rm -f "${LEGACY_FILES[@]}"
  rm -rf "$LEGACY_LOG_DIR"
  return "$status"
}
