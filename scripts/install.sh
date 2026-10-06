#!/usr/bin/env bash
#
#   curl -fsSL https://raw.githubusercontent.com/subconscious-systems/subconscious/main/scripts/install.sh | bash
#
# Installs subconscious-cli from its npm registry tarball without npm. Node.js
# must already be installed, because subc runs on it.
#
# Environment:
#   SUBC_VERSION      version or dist-tag to install (default: latest)
#   SUBC_INSTALL_DIR  package directory (default: ~/.local/share/subconscious-cli)
#   SUBC_BIN_DIR      directory for the subc link (default: ~/.local/bin)
#   SUBC_REGISTRY     npm registry URL (default: https://registry.npmjs.org)
#
# The whole script is one function, called on the last line, so a download cut
# short by the network runs nothing.

main() {
  set -euo pipefail

  local package='subconscious-cli'
  local script_url='https://raw.githubusercontent.com/subconscious-systems/subconscious/main/scripts/install.sh'
  local node_url='https://nodejs.org/en/download'
  local registry="${SUBC_REGISTRY:-https://registry.npmjs.org}"
  registry="${registry%/}"
  local version="${SUBC_VERSION:-latest}"
  local install_dir="${SUBC_INSTALL_DIR:-$HOME/.local/share/subconscious-cli}"
  local bin_dir="${SUBC_BIN_DIR:-$HOME/.local/bin}"

  case "$install_dir:$bin_dir" in
    /*:/*) ;;
    *) fail 'SUBC_INSTALL_DIR and SUBC_BIN_DIR must be absolute paths.' ;;
  esac

  case "$(uname -s)" in
    Linux* | Darwin*) ;;
    *) fail "This installer supports macOS and Linux. On Windows, run: npm install -g ${package}" ;;
  esac

  command -v curl >/dev/null 2>&1 || fail 'curl is required.'
  command -v tar >/dev/null 2>&1 || fail 'tar is required.'
  command -v node >/dev/null 2>&1 ||
    fail "Node.js was not found. subc runs on Node.js 18 or newer. Install it from ${node_url}, then run this installer again."

  [[ "$version" =~ ^[0-9A-Za-z][0-9A-Za-z.+-]*$ ]] ||
    fail "SUBC_VERSION must be a version such as 6.1.0 or a tag such as latest, not '${version}'."

  local link="$bin_dir/subc"
  if [ -e "$link" ] && [ ! -L "$link" ]; then
    fail "${link} exists and is not a link. Remove it, or set SUBC_BIN_DIR to another directory."
  fi

  local tmp
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064 # expand $tmp now: it is local to main.
  trap "rm -rf '$tmp'" EXIT

  log "Looking up ${package}@${version}"
  curl -fsSL "${registry}/${package}/${version}" -o "$tmp/meta.json" ||
    fail "Could not get ${package}@${version} from ${registry}. Check the version and your network."

  # meta.env holds shell-quoted values written by Node: the version, the
  # tarball URL, its integrity hash, and the Node major version it needs.
  node - "$tmp/meta.json" >"$tmp/meta.env" <<'NODE' ||
const fs = require('node:fs');
const meta = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const dist = meta.dist || {};
if (!meta.version || !dist.tarball || !dist.integrity) process.exit(1);
const engine = /^>=\s*(\d+)/.exec((meta.engines && meta.engines.node) || '');
const quote = (value) => `'${String(value).split("'").join("'\\''")}'`;
console.log(`pkg_version=${quote(meta.version)}`);
console.log(`tarball=${quote(dist.tarball)}`);
console.log(`integrity=${quote(dist.integrity)}`);
console.log(`node_major=${quote(engine ? engine[1] : 18)}`);
NODE
    fail "The registry answer for ${package}@${version} has no version, tarball, or integrity hash."
  local pkg_version tarball integrity node_major
  # shellcheck disable=SC1091
  . "$tmp/meta.env"

  local have_major
  have_major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$have_major" -ge "$node_major" ] ||
    fail "subc ${pkg_version} needs Node.js ${node_major} or newer, and this is $(node --version). Upgrade Node.js from ${node_url}, then run this installer again."

  local current=''
  [ -f "$install_dir/package.json" ] &&
    current="$(node -p 'require(process.argv[1]).version' "$install_dir/package.json" 2>/dev/null || true)"
  if [ -n "$current" ] && [ "$current" = "$pkg_version" ]; then
    log "Reinstalling ${package} ${pkg_version}"
  elif [ -n "$current" ]; then
    log "Updating ${package} ${current} -> ${pkg_version}"
  else
    log "Installing ${package} ${pkg_version}"
  fi

  curl -fsSL "$tarball" -o "$tmp/package.tgz" || fail "Could not download ${tarball}."
  node - "$tmp/package.tgz" "$integrity" <<'NODE' ||
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const [file, integrity] = process.argv.slice(2);
const ok = integrity.split(/\s+/).some((entry) => {
  const [algorithm, expected] = entry.split(/-(.*)/s);
  if (!['sha512', 'sha384', 'sha256'].includes(algorithm)) return false;
  const actual = createHash(algorithm).update(fs.readFileSync(file)).digest('base64');
  return actual === expected;
});
process.exit(ok ? 0 : 1);
NODE
    fail "The downloaded tarball does not match the registry's integrity hash. Nothing was installed."

  mkdir -p "$tmp/extract"
  tar -xzf "$tmp/package.tgz" -C "$tmp/extract" || fail 'Could not unpack the tarball.'
  local staged="$tmp/extract/package"
  [ -f "$staged/bin/cli.js" ] || fail 'The tarball has no bin/cli.js. Nothing was installed.'
  chmod 755 "$staged/bin/cli.js"
  # The terminal UI is a native binary per platform; keep it executable.
  [ ! -d "$staged/bin/native" ] || chmod -R a+rX,u+x "$staged/bin/native"
  printf '{"method":"curl","bin_dir":%s}\n' \
    "$(node -p 'JSON.stringify(process.argv[1])' "$bin_dir")" >"$staged/.subc-install.json"

  node "$staged/bin/cli.js" --version >/dev/null 2>&1 ||
    fail "subc ${pkg_version} does not run on this Node.js ($(node --version)). Nothing was installed."

  # Swap the new package in, and put the old one back if the swap fails.
  mkdir -p "$(dirname "$install_dir")" "$bin_dir"
  rm -rf "$install_dir.new" "$install_dir.old"
  cp -R "$staged" "$install_dir.new"
  [ ! -e "$install_dir" ] || mv "$install_dir" "$install_dir.old"
  if ! mv "$install_dir.new" "$install_dir"; then
    [ ! -e "$install_dir.old" ] || mv "$install_dir.old" "$install_dir"
    fail "Could not move the package into ${install_dir}."
  fi
  rm -rf "$install_dir.old"
  ln -sfn "$install_dir/bin/cli.js" "$link"

  local installed
  installed="$("$link" --version 2>/dev/null | tail -n 1)" ||
    fail "Installed to ${install_dir}, but '${link} --version' failed."
  log "Installed subc ${installed} at ${link}"

  local found
  found="$(command -v subc 2>/dev/null || true)"
  case ":$PATH:" in
    *":$bin_dir:"*)
      if [ -n "$found" ] && [ "$found" != "$link" ]; then
        warn "Another subc comes first on PATH: ${found}. Remove it (npm uninstall -g ${package}), or put ${bin_dir} first on PATH."
      fi
      ;;
    *) path_hint "$bin_dir" ;;
  esac

  printf '\nRun \033[1msubc login\033[0m to start. To update later, run \033[1msubc upgrade\033[0m or this installer again:\n  curl -fsSL %s | bash\n' "$script_url"
}

log() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$1" >&2; }
fail() {
  printf '\033[1;31merror:\033[0m %s\n' "$1" >&2
  exit 1
}

path_hint() {
  local dir="$1" rc line
  case "${SHELL:-}" in
    */zsh) rc="$HOME/.zshrc" line="export PATH=\"$dir:\$PATH\"" ;;
    */fish) rc="$HOME/.config/fish/config.fish" line="fish_add_path $dir" ;;
    *) rc="$HOME/.bashrc" line="export PATH=\"$dir:\$PATH\"" ;;
  esac
  warn "${dir} is not on your PATH. Add this line to ${rc}, then open a new terminal:"
  printf '\n  %s\n' "$line" >&2
}

main "$@"
