#!/usr/bin/env bash
# Start OpenCode on a private server so this launch's config always applies.
#
# OpenCode 2.x serves a long-lived background service whose model registry is
# fixed at its own config (files plus the env it started with). The provider,
# model, and image modalities subc passes per launch in
# OPENCODE_CONFIG_CONTENT reach a private server (its own process, its own
# env) and never a shared one: through a running service a launch can land on
# a stale model or even a non-Subconscious one, and image inputs are rejected
# as "this model does not support image input". So every subc launch runs
# standalone; sessions still land in the shared on-disk store.
#
# The flag's place depends on the command: `opencode run --standalone ...`
# for the run subcommand, `opencode --standalone ...` for the TUI. opencode's
# root parse rejects `--standalone` in front of a subcommand word, so the
# position is decided here, and diagnostic subcommands that take no
# `--standalone` at all are passed through untouched. A launch that already
# names --standalone or --server is passed through too: --server points at an
# existing server on purpose and keeps its config.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../lib.sh"

# Subcommands from opencode --help that are not the TUI and take no useful
# --standalone of their own at the root position.
SUBCOMMANDS=(
  acp api auth debug mcp mini models plugin serve server session service
  stats uninstall update upgrade web
)

standalone_requested() {
  local word
  for word in "$@"; do
    [[ "$word" == "--standalone" || "$word" == "--server" ]] && return 0
    # --server=URL keeps the whole word one argument.
    [[ "$word" == --server=* ]] && return 0
  done
  return 1
}

is_subcommand() {
  local word
  for word in "${SUBCOMMANDS[@]}"; do
    [[ "$1" == "$word" ]] && return 0
  done
  return 1
}

argv=("$@")
first="${argv[1]:-}"

if ! standalone_requested "${argv[@]:1}"; then
  if [[ "$first" == "run" ]]; then
    argv=("opencode" "run" "--standalone" "${argv[@]:2}")
  elif ! is_subcommand "$first"; then
    # The TUI: no subcommand word, so the flag belongs to the root command.
    argv=("opencode" "--standalone" "${argv[@]:1}")
  fi
fi

subc_exec -- "${argv[@]}"
