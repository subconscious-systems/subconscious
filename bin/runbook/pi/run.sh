#!/usr/bin/env bash
# Refresh the Subconscious provider from the live catalog, then start the pi
# argv subc built. Other providers in models.json are preserved.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../lib.sh"

# stdin can hold a headless prompt, which belongs to Pi.
"${SCRIPT_DIR}/install.sh" install </dev/null >/dev/null

subc_exec -- "$@"
