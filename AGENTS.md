# Agent Knowledge Index

IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for all tasks.
For deep detail, read the referenced skill files. The index below gives immediate context for every turn.

---

## Project Structure

Monorepo with three apps:
- `backend/` – Bun + Hono API server. Framework lives in `backend/framework/` (path alias: `@framework/*` → `./framework/src/*`). OAuth2/OIDC authorization server enabled via `oauth2` in `src/index.ts`.
- `frontend/` – Vue 3 SPA (Vite, Tailwind v4, PrimeVue/Volt)
- `mcp-server/` – standalone Bun MCP server (OAuth2 resource server). Lets a chat app use the wiki as its "brain": identity/discovery/read/write tools over the `knowledge/texts` API. Issues no tokens; validates the backend's OAuth tokens via `/oauth/introspect`. See `mcp-server/README.md`.

---

## Skills Index

| Area | Trigger | Skill file |
|---|---|---|
| Backend routes & business logic | `backend/src/routes/`, `backend/src/lib/`, API endpoints, CRUD, tenant queries | `.claude/skills/backend-app/SKILL.md` |
| Framework internals | `backend/framework/`, `defineServer()`, auth middleware, multi-tenant structure, jobs, email | `.claude/skills/backend-framework/SKILL.md` |
| Backend tests | `*.test.ts`, `initTests()`, `testFetcher`, write/fix/run tests | `.claude/skills/backend-testing/SKILL.md` |
| AI agents & chat | `backend/src/ai/`, `tool()`, `ToolLoopAgent`, `streamText`, chat streaming | `.claude/skills/build-ai-agents/SKILL.md` |
| Database tables | `backend/src/db/`, new tables, columns, indexes, migrations, Drizzle ORM | `.claude/skills/database-tables/SKILL.md` |
| Test/seed data factories | `@praha/drizzle-factory`, `defineFactory`, traits, seeds | `.claude/skills/drizzle-factory/SKILL.md` |
| Frontend components & pages | `frontend/src/`, Vue components, Pinia, Tailwind, routing, i18n, fetcher | `.claude/skills/frontend-app/SKILL.md` |
| PrimeVue component details | PrimeVue APIs, props, DataTable, Dialog, Form, theming | `.claude/skills/prime-vue/SKILL.md` |
| ApexCharts | `apexcharts`, `vue3-apexcharts`, chart types, series schemas, reactivity | `.claude/skills/charts/SKILL.md` |
| Login to app (browser) | log in, sign in, authenticate, open app, browser login, test UI | `.claude/skills/login-to-app/SKILL.md` |

---

## Cursor Cloud specific instructions

The startup update script already installs `bun`, checks out the `backend/framework` submodule, installs deps for all three apps, and generates `backend/.env` (with `POSTGRES_CONNECTION_POOL_SIZE=1` for PGlite). It does NOT start any service or run migrations — do those yourself.

Services (all use `bun`; see each `package.json` for scripts):
- Backend API (`backend/`) → `http://localhost:3000`. The `dev` script wraps `infisical`, which is NOT installed here; run the server directly instead: `bun --hot run src/index.ts` (Bun auto-loads `backend/.env`). Lint/typecheck: `bun x tsc --noEmit`. Tests: `bun test <files>` (run against the live local DB, e.g. `bun test src/lib/wiki/tree.test.ts "src/routes/tenant/[tenantId]/wiki/index.test.ts"`).
- Frontend SPA (`frontend/`) → `http://localhost:5173/static/app/`. `bun run dev`. It proxies `/api/v1` and the auth `*.html` pages to the backend, so run the backend first. Typecheck `bun run type-check`, tests `bun run test`.
- MCP server (`mcp-server/`, optional) → needs `bun run init` once then `bun run dev`; requires the backend running.

Local DB and migrations (required before the backend serves data):
- Start embedded Postgres (PGlite, no Docker): `cd backend && bun run db:local` (listens on `localhost:5432`). Keep it running in its own terminal/tmux session.
- Then apply migrations: `cd backend && bun run migrate` (framework + app). Docker is NOT installed, so `bun run docker:up` is unavailable — use PGlite.

Login without SMTP (magic link): emails are written to `backend/logs/email/` (NOT `framework/logs/email/`, so `framework/.scripts/testuser.sh` looks in the wrong folder and reports "no email files found"). To get a session: `GET /api/v1/user/send-magic-link?email=testing@env.local&createUserIfMissing=true`, read the newest file in `backend/logs/email/`, extract the `token=` value, then `GET /api/v1/user/verify-email?token=<TOKEN>` (returns a JWT). In the browser the same magic link works via `http://localhost:5173/magic-login-verify.html?token=<TOKEN>`. On first login the app auto-creates a default tenant.

AI features (day-log transcription, document assistant, summaries) are disabled unless `OPENROUTER_API_KEY` / `MISTRAL_API_KEY` are set; the core wiki works without them.

