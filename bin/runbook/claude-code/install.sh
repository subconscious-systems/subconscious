#!/usr/bin/env bash
# ── Subconscious API Gateway — Claude Code leftovers ──────────────────────────
# Claude Code is launch-only: `subc claude` passes everything as env and flags
# and writes nothing persistent. Two leftovers remain from older releases:
# the ~/.claude/subconscious-gateway.env file from the first persistent setup,
# and the isolated config dir subc 6.3 made at ~/.subconscious/claude-code,
# which shared ~/.claude through symlinks. This script reports and removes
# both.
#
#   subc claude status
#   subc claude uninstall
#
# Claude Code sends native x-claude-code-session-id headers, so the gateway
# correlates requests without help from subc.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

CLAUDE_DIR="${HOME}/.claude"
ENV_FILE="${CLAUDE_DIR}/subconscious-gateway.env"
ISOLATED_DIR="${SUBC_CONFIG_DIR:-${HOME}/.subconscious}/claude-code"
COMMAND="status"

usage() {
  cat <<'EOF'
Usage:
  subc claude status
  subc claude uninstall
  subc claude help

Claude Code is launch-only: subc claude. Uninstall removes leftover
~/.claude/subconscious-gateway.env from older persistent setup and the
unused ~/.subconscious/claude-code config dir subc 6.3 made.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    uninstall|status|help)
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

# Whether `dir` looks like a Claude config folder Claude Code has used.
looks_like_claude_config() {
  [[ -f "$1/settings.json" || -f "$1/.claude.json" || -e "$1/projects" ]]
}

isolated_summary() {
  if [[ -L "$ISOLATED_DIR" ]]; then
    echo "present, but a symlink subc will not touch; remove it yourself"
  elif [[ -d "$ISOLATED_DIR" ]]; then
    if [[ -f "$ISOLATED_DIR/.subc-written.json" ]]; then
      echo "present, subc-made (subc claude uninstall removes it)"
    elif looks_like_claude_config "$ISOLATED_DIR"; then
      echo "present, but it holds a Claude config subc did not make; remove it yourself"
    else
      echo "present"
    fi
  else
    echo "missing"
  fi
}

remove_isolated_dir() {
  if [[ -L "$ISOLATED_DIR" ]]; then
    echo "Refusing to remove $ISOLATED_DIR: it is a symlink, so remove it yourself." >&2
    return 1
  fi
  if [[ ! -d "$ISOLATED_DIR" ]]; then
    echo "Isolated config dir: missing"
    return 0
  fi
  if [[ ! -f "$ISOLATED_DIR/.subc-written.json" ]] && looks_like_claude_config "$ISOLATED_DIR"; then
    echo "Refusing to remove $ISOLATED_DIR: it holds a Claude config subc did not make." >&2
    return 1
  fi
  # Remove the entries, never the linked targets: find at depth one names the
  # links themselves, and rm on a link unlinks it. rm -r with a trailing
  # slash would follow directory links into ~/.claude instead.
  find "$ISOLATED_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  rmdir "$ISOLATED_DIR"
  echo "Removed $ISOLATED_DIR (its entries were links; nothing inside ~/.claude was touched)"
}

status() {
  echo "scope: user"
  echo "claude dir: $CLAUDE_DIR"
  echo "env file: $ENV_FILE"
  if [[ -f "$ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    echo "gateway: ${ANTHROPIC_BASE_URL:-unset}"
    if [[ -n "${ANTHROPIC_AUTH_TOKEN:-}" ]]; then
      echo "api key: set (${#ANTHROPIC_AUTH_TOKEN} chars)"
    else
      echo "api key: unset"
    fi
    echo "model: ${ANTHROPIC_MODEL:-unset}"
    echo "model picker: ${ANTHROPIC_DEFAULT_OPUS_MODEL_NAME:-unset}, ${ANTHROPIC_DEFAULT_SONNET_MODEL_NAME:-unset}, ${ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME:-unset}"
    echo "max concurrent subagents: ${CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS:-unset}"
    echo "max subagent spawn depth: ${CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH:-unset}"
    echo "compact window: ${CLAUDE_CODE_AUTO_COMPACT_WINDOW:-unset}"
    echo "max context tokens: ${CLAUDE_CODE_MAX_CONTEXT_TOKENS:-unset}"
  else
    echo "env file: missing"
    echo "Launch Claude with: subc claude"
  fi
  echo "isolated config dir: $ISOLATED_DIR ($(isolated_summary))"
  local aside
  aside="$(ls -d "${ISOLATED_DIR}.old-"* 2>/dev/null || true)"
  if [[ -n "$aside" ]]; then
    echo "old configs moved aside by earlier subc builds (kept, remove yourself):"
    echo "$aside"
  fi
}

case "$COMMAND" in
  uninstall)
    rm -f "$ENV_FILE"
    echo "Removed $ENV_FILE"
    remove_isolated_dir
    ;;
  status)
    status
    ;;
  help)
    usage
    ;;
esac
