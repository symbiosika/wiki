#!/bin/bash
set -euo pipefail

# SessionStart hook for Claude Code on the web.
# Ensures the framework submodule and dependencies are available so backend
# and frontend work immediately in a fresh, ephemeral container. Idempotent
# and non-interactive — safe to re-run.

# Only needed in the remote (web) environment. Locally, developers follow the
# documented `git clone --recurse-submodules` + `bun install` (see README.md).
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# The framework lives in a separate repo and backs backend/. Checking it out
# keeps the backend type-check working; if it fails the frontend still works,
# so don't abort the rest of the setup.
git submodule update --init --recursive \
  || echo "[session-start] framework submodule checkout failed (backend type-check unavailable)"

echo "[session-start] installing backend dependencies"
(cd backend && bun install)

echo "[session-start] installing frontend dependencies"
(cd frontend && bun install)

echo "[session-start] installing frontend-public dependencies"
(cd frontend-public && bun install)

echo "[session-start] installing mcp-server dependencies"
(cd mcp-server && bun install)
