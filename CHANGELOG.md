# Changelog

Every PR that changes the app raises the version in `backend/package.json`
and adds an entry here (rules: `AGENTS.md` → "Versioning"). The running
version is visible at `GET /health` and as the MCP `serverInfo.version`.

## [0.14.0] - 2026-10-06

- Framework update: impersonation sessions — an actor (e.g. a support admin)
  can act as another user via a session JWT with RFC 8693 `act` claim;
  owner-only actions (password/e-mail change, API tokens, passkeys, …) are
  blocked while impersonating.
- Framework update: `GET /user/me` additionally returns `actor` and
  `sessionExpiresAt`.
- Framework update: secrets are unique per tenant — fixes one tenant
  overwriting another tenant's secret of the same name (migration
  `0044_modern_thing`).
- Framework update: requests during startup get `503 starting` (and
  `/health` answers) instead of crashing the server before all routes are
  registered.

## [0.13.0] - 2026-10-05

- Editor: new block "Button" (`/button`) — a link shown as a button with its
  own label, three styles (primary, secondary, outline) and alignment.
  Click a button while editing to change or remove it. With an optional
  preview image (e.g. a video thumbnail) the button becomes a link card:
  image, name, address with a "URL kopieren" button, and the button itself.
- Editor: new block "Download" (`/download`, or drop any non-image file onto
  the page) — uploads a file (max. 25 MB) and shows it as a card with name,
  type and size; pictures get a preview. Downloads go through new page-scoped
  routes (`POST/GET /tenant/:tenantId/wiki/:pageId/files…`, public:
  `/public/wiki/:tenantId/pages/:pageId/files/:file`) and are always served
  as attachments.
- Collections: new column type "Button" — stores a web address, shown as a
  "Hier klicken" button.
- MCP: files of download blocks are no longer listed as `embeddedImages`.

## [0.12.0] - 2026-10-05

- Framework update: registration domains — users signing up with an e-mail
  address of a configured domain skip the invitation code and join the
  tenant automatically (migration `0043_registration_domains`).
- Framework update: pre-register verifications now run on every sign-up path
  (magic link, OAuth2, Hanko).
- Framework update: new S3 storage backend next to db and local, plus
  temporary share URLs for stored files on every backend.

## [0.11.1] - 2026-10-01

- Chat agent: the custom system prompt may now be up to 25,000 characters
  (was 8,000) — in Verwaltung → Chat-Agent, the chat settings and the MCP
  tool `update_chat_agent_config`.

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
