#!/usr/bin/env bash
# ── Subconscious API Gateway — Codex hooks ────────────────────────────────────
# Merge Subconscious compaction hooks into ~/.codex/hooks.json without touching
# ~/.codex/config.toml. Launch Codex with `subc codex`.
#
#   subc codex install     # merge hooks
#   subc codex status
#   subc codex uninstall   # strip only Subconscious hook entries
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SRC="${SCRIPT_DIR}/hook.sh"

SHARED_ENV="${MBTA_ENV_FILE:-${SCRIPT_DIR}/../.env}"
[[ -f "$SHARED_ENV" ]] || SHARED_ENV="${SCRIPT_DIR}/../env.example"
if [[ -f "$SHARED_ENV" ]]; then set -a; source "$SHARED_ENV"; set +a; fi

# shellcheck source=hooks-lib.sh
source "${SCRIPT_DIR}/hooks-lib.sh"

COMMAND="install"
GATEWAY_URL="${GATEWAY_URL:-}"
API_KEY="${CODEX_API_KEY:-${API_KEY:-}}"

usage() {
  cat <<'EOF'
Usage:
  subc codex install [--gateway-url URL] [--api-key KEY]
  subc codex status
  subc codex uninstall

Merges Subconscious compaction hooks into ~/.codex/hooks.json. Does not write
config.toml. Launch Codex with subc codex.
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
  install)
    codex_ensure_hooks strict
    ;;
  uninstall)
    codex_uninstall_hooks
    ;;
  status)
    codex_hooks_status
    ;;
esac
