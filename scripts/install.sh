#!/usr/bin/env bash
#
# Install the Subconscious CLI (`subc`) without npm.
#
#   curl -fsSL https://raw.githubusercontent.com/subconscious-systems/subconscious/main/scripts/install.sh | bash
#
# Downloads the subconscious-cli package tarball straight from the npm registry
# and installs it under ~/.local, so npm (and its registry/proxy policies) is
# never required. Node.js >= 18 is still required to run the CLI itself.
#
# Environment overrides:
#   SUBC_VERSION     install a specific CLI version (default: latest)
#   SUBC_INSTALL_DIR  package location (default: ~/.local/share/subconscious-cli)
#   SUBC_BIN_DIR     launcher location (default: ~/.local/bin)
#
set -euo pipefail

PACKAGE='subconscious-cli'
REGISTRY='https://registry.npmjs.org'
REPO_URL='https://github.com/subconscious-systems/subconscious'
NODE_URL='https://nodejs.org/en/download'

log() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$1" >&2; }
fail() { printf '\033[1;31merror:\033[0m %s\n' "$1" >&2; exit 1; }

case "$(uname -s)" in
  Linux*|Darwin*) ;;
  *) fail "This installer supports macOS and Linux. On Windows use: npm install -g ${PACKAGE}" ;;
esac

command -v curl >/dev/null 2>&1 || fail 'curl is required (https://curl.se).'
command -v tar >/dev/null 2>&1 || fail 'tar is required.'

if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "${NODE_MAJOR:-0}" -lt 18 ]; then
    fail "Node.js >= 18 is required to run subc (found $(node -v)). Get it at ${NODE_URL}"
  fi
else
  warn "Node.js was not found. Install Node.js >= 18 first: ${NODE_URL}"
  fail 'subc is a Node.js CLI and cannot run without it.'
fi

BIN_DIR="${SUBC_BIN_DIR:-$HOME/.local/bin}"
INSTALL_DIR="${SUBC_INSTALL_DIR:-$HOME/.local/share/subconscious-cli}"

if [ -n "${SUBC_VERSION:-}" ]; then
  METADATA_URL="${REGISTRY}/${PACKAGE}/${SUBC_VERSION}"
else
  METADATA_URL="${REGISTRY}/${PACKAGE}/latest"
fi

log "Resolving the latest ${PACKAGE} release..."
METADATA="$(curl -fsSL "$METADATA_URL")" \
  || fail "Could not reach the npm registry (${METADATA_URL}). Check your network."
TARBALL="$(printf '%s' "$METADATA" | sed -n 's/.*"tarball"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
VERSION="$(printf '%s' "$METADATA" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
[ -n "$TARBALL" ] || fail 'Could not find the package tarball URL in registry metadata.'
[ -n "$VERSION" ] || VERSION='unknown'
log "Installing ${PACKAGE} ${VERSION}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

log "Downloading ${TARBALL}..."
curl -fsSL "$TARBALL" -o "$TMP_DIR/package.tgz" || fail 'Download failed.'

tar -xzf "$TMP_DIR/package.tgz" -C "$TMP_DIR" || fail 'Extraction failed.'
[ -f "$TMP_DIR/package/bin/cli.js" ] || fail 'Downloaded package is missing bin/cli.js.'

mkdir -p "$INSTALL_DIR" "$BIN_DIR"
STAGE="$INSTALL_DIR.new"
rm -rf "$STAGE"
mv "$TMP_DIR/package" "$STAGE"
rm -rf "$INSTALL_DIR.old"
[ ! -e "$INSTALL_DIR" ] || mv "$INSTALL_DIR" "$INSTALL_DIR.old"
mv "$STAGE" "$INSTALL_DIR"
rm -rf "$INSTALL_DIR.old"

LAUNCHER="$BIN_DIR/subc"
cat >"$LAUNCHER" <<EOF
#!/bin/sh
exec node "$INSTALL_DIR/bin/cli.js" "\$@"
EOF
chmod 755 "$LAUNCHER"

log "Installed subc ${VERSION} -> $LAUNCHER"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) warn "$BIN_DIR is not on your PATH. Add it, then open a new terminal:"
     warn "  export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac

printf '\nRun \033[1msubc login\033[0m to get started. Docs: %s\n' "$REPO_URL"
