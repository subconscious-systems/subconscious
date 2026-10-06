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
#   SUBC_REGISTRY     npm registry URL, https:// only (default: https://registry.npmjs.org)
#
# The whole script is one function, called on the last line, so a download cut
# short by the network runs nothing.

# State the EXIT trap reads. Globals, so the trap needs no quoting.
TMP_DIR=''
SWAP_DIR=''
SWAPPING=0
MOVED_IN=0
BACKUP=''
INSTALL_DIR=''
LINK=''
OLD_LINK=''

main() {
  set -euo pipefail
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  local package='subconscious-cli'
  local script_url='https://raw.githubusercontent.com/subconscious-systems/subconscious/main/scripts/install.sh'
  local node_url='https://nodejs.org/en/download'
  local registry="${SUBC_REGISTRY:-https://registry.npmjs.org}"
  registry="${registry%/}"
  local version="${SUBC_VERSION:-latest}"
  INSTALL_DIR="${SUBC_INSTALL_DIR:-$HOME/.local/share/subconscious-cli}"
  INSTALL_DIR="${INSTALL_DIR%/}"
  local bin_dir="${SUBC_BIN_DIR:-$HOME/.local/bin}"
  LINK="$bin_dir/subc"

  case "$INSTALL_DIR:$bin_dir" in
    /?*:/*) ;;
    *) fail 'SUBC_INSTALL_DIR and SUBC_BIN_DIR must be absolute paths, and not /.' ;;
  esac

  # A file:// registry exists for tests. Anything on the network is https.
  local scheme curl_opts
  case "$registry" in
    https://*) scheme='https' ;;
    file://*) scheme='file' ;;
    *) fail "SUBC_REGISTRY must be an https:// URL, not '${registry}'." ;;
  esac
  if [ "$scheme" = https ]; then
    curl_opts=(-fsSL --proto '=https' --proto-redir '=https' --tlsv1.2)
  else
    curl_opts=(-fsSL --proto '=file')
  fi

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

  if [ -e "$LINK" ] && [ ! -L "$LINK" ]; then
    fail "${LINK} exists and is not a link. Remove it, or set SUBC_BIN_DIR to another directory."
  fi
  check_install_dir "$INSTALL_DIR" "$package"

  TMP_DIR="$(mktemp -d)"

  log "Looking up ${package}@${version}"
  curl "${curl_opts[@]}" "${registry}/${package}/${version}" -o "$TMP_DIR/meta.json" ||
    fail "Could not get ${package}@${version} from ${registry}. Check the version and your network."

  # meta.env holds shell-quoted values written by Node: the version, the
  # tarball URL, its integrity hash, and the Node major version it needs.
  node - "$TMP_DIR/meta.json" "$package" >"$TMP_DIR/meta.env" <<'NODE' ||
const fs = require('node:fs');
const meta = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const dist = meta.dist || {};
if (meta.name !== process.argv[3]) process.exit(1);
if (!meta.version || !dist.tarball || !dist.integrity) process.exit(1);
const engine = /^>=\s*(\d+)/.exec((meta.engines && meta.engines.node) || '');
const quote = (value) => `'${String(value).split("'").join("'\\''")}'`;
console.log(`pkg_version=${quote(meta.version)}`);
console.log(`tarball=${quote(dist.tarball)}`);
console.log(`integrity=${quote(dist.integrity)}`);
console.log(`node_major=${quote(engine ? engine[1] : 18)}`);
NODE
    fail "The registry answer for ${package}@${version} is not ${package}, or has no version, tarball, or integrity hash."
  local pkg_version tarball integrity node_major
  # shellcheck disable=SC1091
  . "$TMP_DIR/meta.env"

  case "$tarball" in
    "$scheme"://*) ;;
    *) fail "The tarball URL must be ${scheme}://, not '${tarball}'." ;;
  esac

  local have_major
  have_major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$have_major" -ge "$node_major" ] ||
    fail "subc ${pkg_version} needs Node.js ${node_major} or newer, and this is $(node --version). Upgrade Node.js from ${node_url}, then run this installer again."

  local current=''
  [ -f "$INSTALL_DIR/package.json" ] &&
    current="$(node -p 'require(process.argv[1]).version' "$INSTALL_DIR/package.json" 2>/dev/null || true)"
  if [ -n "$current" ] && [ "$current" = "$pkg_version" ]; then
    log "Reinstalling ${package} ${pkg_version}"
  elif [ -n "$current" ]; then
    log "Updating ${package} ${current} -> ${pkg_version}"
  else
    log "Installing ${package} ${pkg_version}"
  fi

  curl "${curl_opts[@]}" "$tarball" -o "$TMP_DIR/package.tgz" || fail "Could not download ${tarball}."
  node - "$TMP_DIR/package.tgz" "$integrity" <<'NODE' ||
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

  check_archive "$TMP_DIR/package.tgz"
  mkdir -p "$TMP_DIR/extract"
  tar -xzf "$TMP_DIR/package.tgz" -C "$TMP_DIR/extract" || fail 'Could not unpack the tarball.'
  local staged="$TMP_DIR/extract/package"
  [ -f "$staged/bin/cli.js" ] || fail 'The tarball has no bin/cli.js. Nothing was installed.'
  chmod 755 "$staged/bin/cli.js"
  # The terminal UI is a native binary per platform; keep it executable.
  [ ! -d "$staged/bin/native" ] || chmod -R a+rX,u+x "$staged/bin/native"
  printf '{"method":"curl","bin_dir":%s}\n' \
    "$(node -p 'JSON.stringify(process.argv[1])' "$bin_dir")" >"$staged/.subc-install.json"

  node "$staged/bin/cli.js" --version </dev/null >/dev/null 2>&1 ||
    fail "subc ${pkg_version} does not run on this Node.js ($(node --version)). Nothing was installed."

  swap_in "$staged"

  local installed
  installed="$("$LINK" --version </dev/null 2>/dev/null | tail -n 1)" ||
    fail "'${LINK} --version' failed after the install. The previous install is back."
  # Done: the EXIT trap now only removes temporary files, the old copy included.
  SWAPPING=0
  log "Installed subc ${installed} at ${LINK}"

  local found
  found="$(command -v subc 2>/dev/null || true)"
  case ":$PATH:" in
    *":$bin_dir:"*)
      if [ -n "$found" ] && [ "$found" != "$LINK" ]; then
        warn "Another subc comes first on PATH: ${found}. Remove it (npm uninstall -g ${package}), or put ${bin_dir} first on PATH."
      fi
      ;;
    *) path_hint "$bin_dir" ;;
  esac

  printf '\nRun \033[1msubc login\033[0m to start. To update later, run \033[1msubc upgrade\033[0m or this installer again:\n  curl -fsSL %s | bash\n' "$script_url"
}

# Only an empty directory or an earlier subc install may be replaced, so a
# mistyped SUBC_INSTALL_DIR cannot delete someone's files.
check_install_dir() {
  local dir="$1" package="$2"
  [ -e "$dir" ] || [ -L "$dir" ] || return 0
  [ -d "$dir" ] && [ ! -L "$dir" ] ||
    fail "${dir} exists and is not a directory. Set SUBC_INSTALL_DIR to another path."
  [ -n "$(ls -A "$dir")" ] || return 0
  [ ! -f "$dir/.subc-install.json" ] || return 0
  if [ -f "$dir/package.json" ] &&
    [ "$(node -p 'require(process.argv[1]).name' "$dir/package.json" 2>/dev/null || true)" = "$package" ]; then
    return 0
  fi
  fail "${dir} is not empty and holds no ${package} install. Nothing was changed. Set SUBC_INSTALL_DIR to an empty or new directory."
}

# Every entry must be a regular file or directory under package/.
check_archive() {
  local archive="$1" names types
  names="$(tar -tzf "$archive")" || fail 'Could not read the tarball.'
  types="$(tar -tvzf "$archive" | cut -c1 | sort -u | tr -d '\n')"
  if printf '%s\n' "$names" | grep -Eqv '^package/' ||
    printf '%s\n' "$names" | grep -Eq '(^|/)\.\.(/|$)' ||
    [ -n "${types//[-d]/}" ]; then
    fail 'The tarball has entries outside package/, or links. Nothing was installed.'
  fi
}

# Move the new package in. Until main clears SWAPPING, the EXIT trap puts the
# old package and link back.
swap_in() {
  local staged="$1" parent
  parent="$(dirname "$INSTALL_DIR")"
  mkdir -p "$parent" "$(dirname "$LINK")"
  SWAP_DIR="$(mktemp -d "$parent/.subc-install.XXXXXX")"
  cp -R "$staged" "$SWAP_DIR/new"
  OLD_LINK="$(readlink "$LINK" 2>/dev/null || true)"
  SWAPPING=1
  if [ -e "$INSTALL_DIR" ]; then
    mv "$INSTALL_DIR" "$SWAP_DIR/old"
    BACKUP="$SWAP_DIR/old"
  fi
  mv "$SWAP_DIR/new" "$INSTALL_DIR"
  MOVED_IN=1
  ln -sfn "$INSTALL_DIR/bin/cli.js" "$LINK"
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [ "$SWAPPING" = 1 ]; then
    [ "$MOVED_IN" = 0 ] || rm -rf "$INSTALL_DIR"
    [ -z "$BACKUP" ] || mv "$BACKUP" "$INSTALL_DIR"
    if [ -n "$OLD_LINK" ]; then
      ln -sfn "$OLD_LINK" "$LINK"
    elif [ -L "$LINK" ]; then
      rm -f "$LINK"
    fi
    warn 'The install did not finish. The previous state is back.'
  fi
  [ -z "$SWAP_DIR" ] || rm -rf "$SWAP_DIR"
  [ -z "$TMP_DIR" ] || rm -rf "$TMP_DIR"
  exit "$status"
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
