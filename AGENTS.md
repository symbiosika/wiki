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
| Inspect dev/test DB data | check the DB, run SQL, count rows, verify a migration | `.claude/skills/db-query/SKILL.md` |
| Local test login (JWT) | testuser, magic-link login, get a session token | `.claude/skills/testuser/SKILL.md` |
| AI agents & chat | `backend/src/ai/`, `tool()`, `ToolLoopAgent`, `streamText`, chat streaming | `.claude/skills/build-ai-agents/SKILL.md` |
| Database tables | `backend/src/db/`, new tables, columns, indexes, migrations, Drizzle ORM | `.claude/skills/database-tables/SKILL.md` |
| Test/seed data factories | `@praha/drizzle-factory`, `defineFactory`, traits, seeds | `.claude/skills/drizzle-factory/SKILL.md` |
| Frontend components & pages | `frontend/src/`, Vue components, Pinia, Tailwind, routing, i18n, fetcher | `.claude/skills/frontend-app/SKILL.md` |
| PrimeVue component details | PrimeVue APIs, props, DataTable, Dialog, Form, theming | `.claude/skills/prime-vue/SKILL.md` |
| ApexCharts | `apexcharts`, `vue3-apexcharts`, chart types, series schemas, reactivity | `.claude/skills/charts/SKILL.md` |

---

## Running Backend Tests (zero setup)

From `backend/`: `bun run test:local [files...]` — runs tests against an embedded
PGlite database (no Docker, no .env). Details: `.claude/skills/backend-testing/SKILL.md`.
