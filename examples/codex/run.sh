#!/usr/bin/env bash
# Run the Codex CLI on Subconscious, using this folder's config.toml via CODEX_HOME.
set -euo pipefail
: "${SUBCONSCIOUS_API_KEY:?Set SUBCONSCIOUS_API_KEY — https://subconscious.dev/platform}"

command -v codex >/dev/null || { echo "Install: npm i -g @openai/codex" >&2; exit 127; }
export CODEX_HOME="$(cd "$(dirname "$0")" && pwd)"   # use the config.toml shipped here
exec codex "$@"
