#!/usr/bin/env bash
# Install a precompiled Marathon release for the current platform.

set -euo pipefail

REPOSITORY="subconscious-systems/subconscious-code"
REPOSITORY_URL="https://github.com/${REPOSITORY}"
INSTALL_DIR="${SC_INSTALL_DIR:-${HOME}/.local/bin}"

usage() {
  cat <<'EOF'
Usage: subc marathon install

Install the latest Marathon release. Linux downloads and verifies the
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
    echo "error: unsupported Marathon setup action: $1" >&2
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
  echo "error: no published Marathon release is available yet" >&2
  echo "The release may still be building. Retry subc marathon install after it finishes." >&2
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

executable="marathon"
asset="${executable}-${target}.tar.gz"
checksum="${asset}.sha256"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/subc-marathon-install.XXXXXX")"
staging=''
cleanup() {
  rm -f "$work_dir/$asset" "$work_dir/$checksum" "$work_dir/sc" "$work_dir/marathon"
  if [[ -n "$staging" ]]; then rm -f "$staging"; fi
  rmdir "$work_dir" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

echo "Downloading Marathon v${version} for ${target}..."
if command -v gh >/dev/null 2>&1 \
  && assets="$(gh release view "v${version}" --repo "$REPOSITORY" --json assets --jq '.assets[].name' 2>/dev/null)"; then
  if ! printf '%s\n' "$assets" | grep -Fxq "$asset"; then
    # Pinned legacy releases are still installed as marathon, never as sc.
    executable="sc"
    asset="${executable}-${target}.tar.gz"
    checksum="${asset}.sha256"
  fi
  if ! printf '%s\n' "$assets" | grep -Fxq "$asset" \
    || ! printf '%s\n' "$assets" | grep -Fxq "$checksum"; then
    echo "error: release is missing $asset or $checksum" >&2
    exit 1
  fi
  gh release download "v${version}" --repo "$REPOSITORY" \
    --pattern "$asset" --pattern "$checksum" --dir "$work_dir"
else
  command -v curl >/dev/null 2>&1 || {
    echo "error: curl is required to download Marathon" >&2
    exit 1
  }
  release_url="${REPOSITORY_URL}/releases/download/v${version}"
  status="$(curl -sSL -w '%{http_code}' "${release_url}/${asset}" -o "$work_dir/$asset")"
  if [[ "$status" == 404 ]]; then
    rm -f "$work_dir/$asset"
    executable="sc"
    asset="${executable}-${target}.tar.gz"
    checksum="${asset}.sha256"
    curl -fL "${release_url}/${asset}" -o "$work_dir/$asset"
  elif [[ "$status" != 200 ]]; then
    echo "error: Marathon download failed (HTTP $status)" >&2
    exit 1
  fi
  curl -fL "${release_url}/${checksum}" -o "$work_dir/$checksum"
fi

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$work_dir" && sha256sum --check "$checksum")
elif command -v shasum >/dev/null 2>&1; then
  expected="$(awk '{print $1}' "$work_dir/$checksum")"
  actual="$(shasum -a 256 "$work_dir/$asset" | awk '{print $1}')"
  [[ "$actual" == "$expected" ]] || {
    echo "error: Marathon checksum verification failed" >&2
    exit 1
  }
else
  echo "error: sha256sum or shasum is required to verify the download" >&2
  exit 1
fi

tar -xzf "$work_dir/$asset" -C "$work_dir" "$executable"
if [[ ! -f "$work_dir/$executable" || -L "$work_dir/$executable" ]]; then
  echo "error: release has no regular root $executable executable" >&2
  exit 1
fi
mkdir -p "$INSTALL_DIR"
if [[ -d "$INSTALL_DIR/marathon" ]]; then
  echo "error: $INSTALL_DIR/marathon is a directory; refusing to replace it" >&2
  exit 1
fi
staging="$(mktemp "$INSTALL_DIR/.marathon.XXXXXX")"
install -m 0755 "$work_dir/$executable" "$staging"
mv -f "$staging" "$INSTALL_DIR/marathon"
echo "Installed Marathon v${version} to $INSTALL_DIR/marathon"
