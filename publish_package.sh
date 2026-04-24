#!/usr/bin/env bash
set -euo pipefail

# ── Colors ───────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

info()  { echo -e "  ${CYAN}ℹ${RESET}  $*"; }
ok()    { echo -e "  ${GREEN}✓${RESET}  $*"; }
warn()  { echo -e "  ${YELLOW}⚠${RESET}  $*"; }
fail()  { echo -e "  ${RED}✗${RESET}  $*"; }
header(){ echo -e "\n  ${BOLD}$*${RESET}\n"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Package selection ────────────────────────────────────────────────────
header "Subconscious Package Release Helper"

echo -e "  Which package are you releasing?"
echo ""
echo -e "    1) ${CYAN}subconscious-cli${RESET}        — CLI for login/logout/whoami"
echo -e "    2) ${CYAN}create-subconscious-app${RESET} — scaffolder (npx create-subconscious-app)"
echo ""
read -rp "  Enter 1 or 2: " choice

case "$choice" in
  1|cli)
    PKG_DIR="cli"
    PKG_NAME="subconscious-cli"
    TAG_PREFIX="cli-v"
    ;;
  2|create-app|create)
    PKG_DIR="create-subconscious-app"
    PKG_NAME="create-subconscious-app"
    TAG_PREFIX="create-app-v"
    ;;
  *)
    fail "Invalid choice. Exiting."
    exit 1
    ;;
esac

PKG_PATH="$SCRIPT_DIR/$PKG_DIR"
VERSION_FILE="$PKG_DIR/package.json"

if [ ! -d "$PKG_PATH" ]; then
  fail "Directory $PKG_DIR not found at $PKG_PATH"
  exit 1
fi

# ── Step 0: Git state checks ─────────────────────────────────────────────
header "Step 0: Git state checks"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  fail "You are on branch ${BOLD}$BRANCH${RESET}, must be on ${BOLD}main${RESET}."
  exit 1
fi
ok "On branch main"

if ! git diff --quiet || ! git diff --cached --quiet; then
  fail "You have uncommitted local changes. Commit or stash them first."
  exit 1
fi
ok "No uncommitted changes"

git fetch origin main --quiet
LOCAL_SHA=$(git rev-parse HEAD)
REMOTE_SHA=$(git rev-parse origin/main)
if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  fail "Local main (${DIM}${LOCAL_SHA:0:8}${RESET}) is not up to date with origin/main (${DIM}${REMOTE_SHA:0:8}${RESET})."
  info "Run: git pull origin main"
  exit 1
fi
ok "Up to date with origin/main"

# ── Step 1: Current published version ────────────────────────────────────
header "Step 1: Current published version on npm"

PUBLISHED=$(npm view "$PKG_NAME" version 2>/dev/null || echo "")
if [ -z "$PUBLISHED" ]; then
  warn "Could not query npm for $PKG_NAME. Is npm available?"
  warn "Continuing with published version unknown."
  PUBLISHED="0.0.0"
fi

PUBLISHED_TAG="${TAG_PREFIX}${PUBLISHED}"
info "Published version: ${BOLD}$PUBLISHED${RESET} (tag: $PUBLISHED_TAG)"

if git rev-parse "$PUBLISHED_TAG" >/dev/null 2>&1; then
  TAG_COMMIT=$(git rev-parse "$PUBLISHED_TAG")
  TAG_DATE=$(git log -1 --format='%ci' "$PUBLISHED_TAG")
  info "Tag ${BOLD}$PUBLISHED_TAG${RESET} -> commit ${DIM}${TAG_COMMIT:0:10}${RESET} (${TAG_DATE})"
else
  warn "Tag $PUBLISHED_TAG not found locally. It may have been created from another machine."
  warn "Skipping diff check — will continue with version checks."
  TAG_COMMIT=""
fi

# ── Step 2: Changes since last release ───────────────────────────────────
header "Step 2: Changes since last release"

if [ -n "$TAG_COMMIT" ]; then
  CHANGES=$(git diff --stat "$PUBLISHED_TAG"..HEAD -- "$PKG_DIR")
  if [ -z "$CHANGES" ]; then
    fail "No changes in $PKG_DIR since $PUBLISHED_TAG. Nothing to release."
    exit 0
  fi
  ok "Changes found in $PKG_DIR since $PUBLISHED_TAG:"
  echo ""
  echo "$CHANGES" | sed 's/^/    /'
  echo ""
else
  warn "Cannot diff (tag not found locally). Proceeding based on version check."
fi

# ── Step 3: Version bump check ───────────────────────────────────────────
header "Step 3: Version bump check"

LOCAL_VERSION=$(node -p "require('./$VERSION_FILE').version")

info "Published: ${BOLD}$PUBLISHED${RESET}  →  Local ($VERSION_FILE): ${BOLD}$LOCAL_VERSION${RESET}"

HIGHER=$(printf '%s\n%s\n' "$PUBLISHED" "$LOCAL_VERSION" | sort -V | tail -1)
if [ "$LOCAL_VERSION" = "$PUBLISHED" ]; then
  fail "Local version ($LOCAL_VERSION) is the same as the published version."
  fail "Bump the version in ${BOLD}$VERSION_FILE${RESET} first."
  exit 1
fi
if [ "$HIGHER" != "$LOCAL_VERSION" ]; then
  fail "Local version ($LOCAL_VERSION) is lower than published ($PUBLISHED)."
  fail "Bump the version in ${BOLD}$VERSION_FILE${RESET} to something higher than $PUBLISHED."
  exit 1
fi
ok "Version $LOCAL_VERSION is higher than published $PUBLISHED"

# ── Step 4: Tag collision check ──────────────────────────────────────────
header "Step 4: Tag collision check"

NEW_TAG="${TAG_PREFIX}${LOCAL_VERSION}"
REMOTE_TAG_EXISTS=$(git ls-remote --tags origin "$NEW_TAG" 2>/dev/null || true)

if [ -n "$REMOTE_TAG_EXISTS" ]; then
  fail "Tag ${BOLD}$NEW_TAG${RESET} already exists on the remote."
  info "If the tag is orphaned and you need to delete it:"
  echo -e "    ${DIM}git push origin :refs/tags/$NEW_TAG${RESET}"
  exit 1
fi
ok "Tag $NEW_TAG does not exist on remote — safe to create"

# ── Step 5: Pre-release checklist ────────────────────────────────────────
header "Step 5: Ready to release"

NPM_USER=$(npm whoami 2>/dev/null || echo "")
if [ -z "$NPM_USER" ]; then
  warn "Not logged in to npm. You'll need to run ${BOLD}npm login${RESET} before publishing."
else
  ok "Logged in to npm as ${BOLD}$NPM_USER${RESET}"
fi

echo ""
echo -e "  ${GREEN}All checks passed.${RESET} Here's what will happen when you run the command below:"
echo ""
echo -e "    1. A git tag ${BOLD}$NEW_TAG${RESET} will be created at HEAD (${DIM}${LOCAL_SHA:0:10}${RESET})"
echo -e "    2. The tag will be pushed to origin"
echo -e "    3. ${BOLD}$PKG_NAME@$LOCAL_VERSION${RESET} will be published to npm"
echo ""

echo -e "  ${YELLOW}${BOLD}Pre-release checklist:${RESET}"
echo ""
echo -e "    ${YELLOW}□${RESET}  Backwards compatibility — have you considered breaking changes?"
echo -e "    ${YELLOW}□${RESET}  Docs — are subconscious-docs updated for any new/changed features?"
echo ""

echo -e "  ${BOLD}Run this command when ready:${RESET}"
echo ""
echo -e "    ${GREEN}git tag $NEW_TAG && git push origin $NEW_TAG && npm publish ./$PKG_DIR${RESET}"
echo ""
