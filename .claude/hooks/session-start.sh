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

# Framework submodule backs backend/. Best-effort: it lives in a separate repo
# and may be unreachable under a restrictive network policy. If it is
# missing, the backend type-check is unavailable, but the frontend still
# works.
git submodule update --init --recursive || {
  echo "[session-start] framework submodule checkout skipped (no access)"
  # The framework lives in a separate repo the cloud git proxy can't reach.
  # It is published as a release asset on THIS repo by the
  # "Release framework submodule" workflow. Pull it down when missing so the
  # backend type-check works.
  if [ ! -e backend/framework/package.json ] && [ -x .scripts/fetch-framework.sh ]; then
    echo "[session-start] attempting framework download via .scripts/fetch-framework.sh"
    .scripts/fetch-framework.sh \
      || echo "[session-start] framework download failed (run .scripts/fetch-framework.sh manually)"
  fi
}

echo "[session-start] installing backend dependencies"
(cd backend && bun install)

echo "[session-start] installing frontend dependencies"
(cd frontend && bun install)

echo "[session-start] installing mcp-server dependencies"
(cd mcp-server && bun install)
