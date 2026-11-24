#!/usr/bin/env bash
# ── Subconscious API Gateway — Codex leftovers ────────────────────────────────
# Codex is launch-only: `subc codex` passes the provider and a temporary model
# catalog on the command line and writes nothing to ~/.codex/config.toml.
# Older versions merged compaction hooks into ~/.codex/hooks.json; install and
# uninstall both remove them and keep every other hook.
#
#   subc codex install     # remove old Subconscious hooks
#   subc codex status
#   subc codex uninstall   # remove old Subconscious hooks
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=legacy-hooks.sh
source "${SCRIPT_DIR}/legacy-hooks.sh"

COMMAND="install"

usage() {
  cat <<'EOF_USAGE'
Usage:
  subc codex install
  subc codex status
  subc codex uninstall

Codex needs no persistent setup. Launch it with subc codex.

install and uninstall remove the compaction hooks that older subc versions
merged into ~/.codex/hooks.json, with their hook script and env file. Your own
hooks stay. config.toml is never read or written.
EOF_USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    install|uninstall|status)
      COMMAND="$1"
      shift
      ;;
    --gateway-url|--api-key|--model)
      shift 2
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *)
      echo "unknown argument: $1 (launch options belong on subc codex, not subc codex install)" >&2
      usage >&2
      exit 1
      ;;
  esac
done

case "$COMMAND" in
  install|uninstall)
    codex_remove_legacy_hooks verbose
    echo "Codex needs no persistent setup; launch it with subc codex."
    ;;
  status)
    echo "scope: user"
    echo "codex dir: $CODEX_DIR"
    if codex_has_legacy_hooks; then
      echo "old Subconscious hooks: present (remove with subc codex uninstall)"
    else
      echo "old Subconscious hooks: none"
    fi
    if [[ -f "${CODEX_DIR}/config.toml" ]] && grep -q 'model_provider = "subconscious"' "${CODEX_DIR}/config.toml" 2>/dev/null; then
      echo "legacy config.toml: contains a Subconscious provider (this CLI no longer manages that file)"
    fi
    ;;
esac
