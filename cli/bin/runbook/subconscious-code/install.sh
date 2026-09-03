#!/usr/bin/env bash
# Install a precompiled Subconscious Code release for the current platform.

set -euo pipefail

REPOSITORY="subconscious-systems/subconscious-code"
REPOSITORY_URL="https://github.com/${REPOSITORY}"
INSTALL_DIR="${SC_INSTALL_DIR:-${HOME}/.local/bin}"

usage() {
  cat <<'EOF'
Usage: subc sc install

Install the latest Subconscious Code release. Linux downloads and verifies the
published static binary. macOS downloads and verifies the matching native binary.
EOF
}

case "${1:-install}" in
  install) ;;
  help|-h|--help)
    usage
    exit 0
    ;;
  *)
    echo "error: unsupported Subconscious Code setup action: $1" >&2
    usage >&2
    exit 2
    ;;
esac

release_tag() {
  if [[ -n "${SC_CODE_VERSION:-}" ]]; then
    printf '%s\n' "${SC_CODE_VERSION#v}"
    return
  fi
  if command -v gh >/dev/null 2>&1; then
    local tag
    tag="$(gh release view --repo "$REPOSITORY" --json tagName --jq '.tagName' 2>/dev/null || true)"
    if [[ -n "$tag" ]]; then
      printf '%s\n' "${tag#v}"
      return
    fi
  fi
  if command -v curl >/dev/null 2>&1; then
    local tag
    tag="$(curl -fsSL "https://api.github.com/repos/${REPOSITORY}/releases/latest" 2>/dev/null \
      | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
      | head -n 1 || true)"
    if [[ -n "$tag" ]]; then
      printf '%s\n' "${tag#v}"
      return
    fi
  fi
  return 1
}

platform="$(uname -s)"
architecture="$(uname -m)"
version="$(release_tag || true)"

if [[ -z "$version" ]]; then
  echo "error: no published Subconscious Code release is available yet" >&2
  echo "The release may still be building. Retry subc sc install after it finishes." >&2
  exit 1
fi

case "${platform}:${architecture}" in
  Darwin:arm64) target="aarch64-apple-darwin" ;;
  Darwin:x86_64) target="x86_64-apple-darwin" ;;
  Linux:aarch64|Linux:arm64) target="aarch64-unknown-linux-musl" ;;
  Linux:x86_64|Linux:amd64) target="x86_64-unknown-linux-musl" ;;
  *)
    echo "error: unsupported platform or architecture: ${platform} ${architecture}" >&2
    exit 1
    ;;
esac

asset="sc-${target}.tar.gz"
checksum="${asset}.sha256"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/subc-sc-install.XXXXXX")"
cleanup() {
  rm -f "$work_dir/$asset" "$work_dir/$checksum" "$work_dir/sc"
  rmdir "$work_dir" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

echo "Downloading Subconscious Code v${version} for ${target}..."
if command -v gh >/dev/null 2>&1 \
  && gh release view "v${version}" --repo "$REPOSITORY" >/dev/null 2>&1; then
  gh release download "v${version}" --repo "$REPOSITORY" \
    --pattern "$asset" --pattern "$checksum" --dir "$work_dir"
else
  command -v curl >/dev/null 2>&1 || {
    echo "error: curl is required to download Subconscious Code" >&2
    exit 1
  }
  release_url="${REPOSITORY_URL}/releases/download/v${version}"
  curl -fL "${release_url}/${asset}" -o "$work_dir/$asset"
  curl -fL "${release_url}/${checksum}" -o "$work_dir/$checksum"
fi

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$work_dir" && sha256sum --check "$checksum")
elif command -v shasum >/dev/null 2>&1; then
  expected="$(awk '{print $1}' "$work_dir/$checksum")"
  actual="$(shasum -a 256 "$work_dir/$asset" | awk '{print $1}')"
  [[ "$actual" == "$expected" ]] || {
    echo "error: Subconscious Code checksum verification failed" >&2
    exit 1
  }
else
  echo "error: sha256sum or shasum is required to verify the download" >&2
  exit 1
fi

tar -xzf "$work_dir/$asset" -C "$work_dir" sc
mkdir -p "$INSTALL_DIR"
install -m 0755 "$work_dir/sc" "$INSTALL_DIR/sc"
echo "Installed Subconscious Code v${version} to $INSTALL_DIR/sc"
