#!/usr/bin/env bash
# ── Subconscious API Gateway — Claude Code VS Code extension ──────────────────
# Thin wrapper: the logic lives in bin/claude-vscode.js so Windows
# (bin/windows/setup.js) runs the exact same code. argv keeps its leading
# 'vscode' word; the Node entry normalizes it.
#
#   subc claude vscode install
#   subc claude vscode uninstall
#   subc claude vscode status
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "${SCRIPT_DIR}/../../claude-vscode.js" "$@"
