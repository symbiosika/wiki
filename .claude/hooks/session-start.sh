#!/bin/bash
set -euo pipefail

# SessionStart hook for Claude Code on the web.
# Ensures the framework submodule and dependencies are available so backend
# and frontend work immediately in a fresh, ephemeral container. Idempotent
# and non-interactive — safe to re-run.
#
# The hook only ever installs into packages that exist in the checkout. It must
# not create, clear or repopulate a tracked path: a hook that "fixes" the
# working tree makes it diverge from what git checked out.

# Only needed in the remote (web) environment. Locally, developers follow the
# documented `git clone --recurse-submodules` + `bun install` (see README.md).
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# Refresh the remote-tracking refs. A session's clone is made when the
# container is created and its branch may be based on a days-old develop, so
# without this `origin/develop` silently lies: `git log origin/develop..HEAD`
# comes back empty and the session works against a stale base, unaware that
# files it still sees were deleted upstream. Refs only — this does not touch
# the working tree or move any branch.
echo "[session-start] refreshing origin refs"
git fetch --quiet --no-tags --no-recurse-submodules --prune origin \
  || echo "[session-start] git fetch failed (origin/* refs may be stale)"

# The framework lives in a separate repo and backs backend/. Checking it out
# keeps the backend type-check working; if it fails the frontend still works,
# so don't abort the rest of the setup.
git submodule update --init --recursive \
  || echo "[session-start] framework submodule checkout failed (backend type-check unavailable)"

for pkg in backend frontend frontend-public; do
  # Skip anything not in this checkout. Without this guard, `cd` + install
  # either aborts the hook (set -e) or repopulates a stale leftover directory
  # from an earlier branch, leaving a path containing nothing but node_modules.
  if [ ! -f "$pkg/package.json" ]; then
    echo "[session-start] skipping $pkg (not in this checkout)"
    continue
  fi
  echo "[session-start] installing $pkg dependencies"
  (cd "$pkg" && bun install)
done
