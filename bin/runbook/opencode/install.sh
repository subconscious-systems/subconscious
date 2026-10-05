#!/usr/bin/env bash
# ── Subconscious API Gateway — OpenCode leftovers ─────────────────────────────
# OpenCode is launch-only: `subc opencode` passes the provider config in
# OPENCODE_CONFIG_CONTENT and writes nothing. Older persistent setups wrote a
# provider into ~/.opencode/opencode.json, an env file, and a compaction
# plugin; this script reports and removes those.
#
#   subc opencode status
#   subc opencode uninstall
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

COMMAND="status"

usage() {
  cat <<'EOF'
Usage:
  subc opencode status
  subc opencode uninstall
  subc opencode help

OpenCode is launch-only: subc opencode. Uninstall removes only the Subconscious
provider, plugin, and env file. It does not delete ~/.opencode/opencode.json.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    uninstall|status)
      COMMAND="$1"
      shift
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

OPENCODE_DIR="${HOME}/.opencode"
OPENCODE_CONFIG="${OPENCODE_DIR}/opencode.json"
MARKER='x-subconscious-client'
# Plugins load from the XDG config dir, which is separate from the legacy ~/.opencode
# config path above. Docs: https://opencode.ai/docs/plugins/
PLUGIN_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/opencode/plugins"
PLUGIN_FILE="${PLUGIN_DIR}/subconscious-compaction.ts"

uninstall_config() {
  if [[ -f "$OPENCODE_CONFIG" ]]; then
    local tmp
    tmp="$(mktemp)"
    jq '
      del(.provider.subconscious, .provider["subconscious-cli"])
      | if ((.model // "") | tostring | startswith("subconscious/")) then del(.model) else . end
    ' "$OPENCODE_CONFIG" >"$tmp"
    mv "$tmp" "$OPENCODE_CONFIG"
    echo "Removed Subconscious provider from $OPENCODE_CONFIG"
  else
    echo "No OpenCode config at $OPENCODE_CONFIG"
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
  uninstall)
    uninstall_config
    echo "Removed Subconscious OpenCode files; left $OPENCODE_CONFIG in place"
    ;;
  status)
    status
    ;;
esac
