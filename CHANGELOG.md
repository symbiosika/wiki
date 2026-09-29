# Changelog

Every PR that changes the app raises the version in `backend/package.json`
and adds an entry here (rules: `AGENTS.md` → "Versioning"). The running
version is visible at `GET /health` and as the MCP `serverInfo.version`.

## [0.9.181] - 2026-09-29

- Versioning: the app carries a semver version (`backend/package.json`).
  `GET /health` reports it together with the build commit and build time,
  and the MCP server reports it as its version. CI checks that every PR
  changing the app raises it.
- MCP: AI-test tools — build, run and evaluate AI test suites
  (suites, questions, runs, results, run comparison).
