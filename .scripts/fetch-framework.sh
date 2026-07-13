#!/usr/bin/env bash
set -euo pipefail

# Fetch the symbiosika-framework submodule and extract it into
# backend/framework, WITHOUT a direct submodule checkout.
#
# Why this exists:
#   The framework lives in a separate repo (symbiosika-framework). In some
#   environments — notably Claude Code cloud sessions — `git submodule update`
#   fails because the session's git proxy only reaches this one repo. The
#   `Release framework submodule` GitHub Action packages the framework as a
#   release asset on THIS repo (framework.zip), which those environments *can*
#   download via the GitHub API. This script does that download + extraction.
#
# Usage:
#   .scripts/fetch-framework.sh            # match the pinned submodule commit
#   FRAMEWORK_TAG=framework-latest .scripts/fetch-framework.sh
#
# Auth:
#   Uses $GH_TOKEN or $GITHUB_TOKEN (present by default in cloud sessions).
#   Required for the private release on this repo; not needed for the public
#   fallback. Needs: curl, jq, unzip, tar.

REPO="symbiosika/wiki"
FW_REPO="symbiosika/symbiosika-framework"
API="https://api.github.com"
TARGETS=("backend/framework")

log() { printf '[fetch-framework] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

for bin in curl jq unzip tar; do
  command -v "$bin" >/dev/null 2>&1 || die "missing required tool: $bin"
done

cd "$(git rev-parse --show-toplevel)"

TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
auth=()
[ -n "$TOKEN" ] && auth=(-H "Authorization: Bearer $TOKEN")

# The commit pinned by the superproject (the gitlink under the first target).
PINNED_SHA="$(git ls-tree HEAD "${TARGETS[0]}" 2>/dev/null | awk '{print $3}')"
[ -n "$PINNED_SHA" ] || log "could not read pinned framework commit (continuing)"
log "pinned framework commit: ${PINNED_SHA:-<unknown>}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
zip="$tmp/framework.zip"

# --- Try the release asset on this repo --------------------------------------
# Candidate tags, in order of preference.
tags=()
[ -n "${FRAMEWORK_TAG:-}" ] && tags+=("$FRAMEWORK_TAG")
[ -n "$PINNED_SHA" ] && tags+=("framework-$PINNED_SHA")
tags+=("framework-latest")

asset_url=""
chosen_tag=""
for tag in "${tags[@]}"; do
  rel="$(curl -fsSL "${auth[@]}" -H "Accept: application/vnd.github+json" \
    "$API/repos/$REPO/releases/tags/$tag" 2>/dev/null || true)"
  [ -n "$rel" ] || continue
  url="$(printf '%s' "$rel" | jq -r '.assets[]? | select(.name=="framework.zip") | .url' | head -n1)"
  if [ -n "$url" ] && [ "$url" != "null" ]; then
    asset_url="$url"
    chosen_tag="$tag"
    break
  fi
done

extract_into_targets() {  # $1 = unzip|tar, $2 = archive
  local mode="$1" archive="$2" t
  for t in "${TARGETS[@]}"; do
    mkdir -p "$t"
    # Clear the mount point (keep the directory itself).
    find "$t" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    if [ "$mode" = unzip ]; then
      unzip -oq "$archive" -d "$t"
    else
      tar -xzf "$archive" --strip-components=1 -C "$t"
    fi
    log "extracted -> $t"
  done
}

if [ -n "$asset_url" ]; then
  log "downloading framework.zip from release '$chosen_tag' on $REPO"
  # The asset API 302-redirects to a signed storage URL; curl drops the auth
  # header across the host change automatically (correct for signed URLs).
  curl -fsSL "${auth[@]}" -H "Accept: application/octet-stream" "$asset_url" -o "$zip" \
    || die "failed to download release asset"

  # Best-effort integrity check against the published checksum.
  sums="$(printf '%s' "$rel" | jq -r '.assets[]? | select(.name=="framework.zip.sha256") | .url' | head -n1)"
  if [ -n "$sums" ] && [ "$sums" != "null" ]; then
    want="$(curl -fsSL "${auth[@]}" -H "Accept: application/octet-stream" "$sums" 2>/dev/null | tr -d '[:space:]')"
    have="$(sha256sum "$zip" | awk '{print $1}')"
    if [ -n "$want" ] && [ "$want" != "$have" ]; then
      die "checksum mismatch (want $want, have $have)"
    fi
    [ -n "$want" ] && log "checksum OK"
  fi

  extract_into_targets unzip "$zip"
  log "done (source: release '$chosen_tag' on $REPO)"
  exit 0
fi

# --- Fallback: the public framework repo tarball -----------------------------
# Used when no release exists yet (e.g. the workflow has not run for this
# commit). Works only where api.github.com can reach the public framework repo.
log "no matching release found on $REPO; falling back to the public $FW_REPO tarball"
ref="${PINNED_SHA:-HEAD}"
curl -fsSL "${auth[@]}" -H "Accept: application/vnd.github+json" \
  "$API/repos/$FW_REPO/tarball/$ref" -o "$tmp/framework.tgz" \
  || die "fallback download failed (ref: $ref)"
extract_into_targets tar "$tmp/framework.tgz"
log "done (source: $FW_REPO tarball @ $ref)"
log "note: prefer the release on $REPO — run the 'Release framework submodule' workflow."
