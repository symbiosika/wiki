#!/bin/bash
set -euo pipefail

# SessionStart hook for Claude Code on the web.
# Installs dependencies so backend and frontend work immediately in a fresh,
# ephemeral container. Idempotent and non-interactive — safe to re-run.
#
# This hook only ever installs into packages that exist in the checkout. It
# must not create, clear, or repopulate any tracked path: a hook that "fixes"
# the working tree makes it diverge from what git checked out.

# Only needed in the remote (web) environment. Locally, developers follow the
# documented `git clone --recurse-submodules` + `bun install` (see README.md).
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# The framework submodule backs backend/. Plain git, best-effort: it lives in a
# separate repo that may be unreachable under a restrictive network policy. If
# it stays empty the backend type-check is unavailable, but installs and
# frontend work are unaffected — leave it empty rather than filling it with a
# substitute.
git submodule update --init --recursive \
  || echo "[session-start] framework submodule checkout skipped (no access)"

for pkg in backend frontend frontend-public mcp-server; do
  # Skip anything not in this checkout. Without this guard, `cd` + install
  # creates a stray node_modules in a directory that does not exist on the
  # branch, which then looks like a broken checkout.
  if [ ! -f "$pkg/package.json" ]; then
    echo "[session-start] skipping $pkg (not in this checkout)"
    continue
  fi
  echo "[session-start] installing $pkg dependencies"
  (cd "$pkg" && bun install)
done
