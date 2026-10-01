# Changelog

Every PR that changes the app raises the version in `backend/package.json`
and adds an entry here (rules: `AGENTS.md` → "Versioning"). The running
version is visible at `GET /health` and as the MCP `serverInfo.version`.

## [0.11.0] - 2026-10-01

- MCP: new tools `get_chat_agent_config` and `update_chat_agent_config` read
  and replace the organisation's custom system prompt of the chat agent (the
  same setting as Verwaltung → Chat-Agent), so it can be maintained from a
  chat app as well.

## [0.10.0] - 2026-09-29

- Verwaltung → Chat-Agent shows the AI connection: whether the OpenRouter
  API key is set and which model is active (new endpoint
  `GET /tenant/:tenantId/chat/ai-status`; the key itself is never returned).

## [0.9.182] - 2026-09-29

- AI tests: failed questions now record and log the real cause of an AI
  error — which stage failed (agent or judge), HTTP status, upstream provider
  and its raw error message — instead of only "Failed after 3 attempts. Last
  error: Provider returned error".

## [0.9.181] - 2026-09-29

- Versioning: the app carries a semver version (`backend/package.json`).
  `GET /health` reports it together with the build commit and build time,
  and the MCP server reports it as its version. CI checks that every PR
  changing the app raises it.
- MCP: AI-test tools — build, run and evaluate AI test suites
  (suites, questions, runs, results, run comparison).
