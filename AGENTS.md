# Agent Knowledge Index

IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for all tasks.
For deep detail, read the referenced skill files. The index below gives immediate context for every turn.

---

## 1. Verify before you finish — testing here is cheap

Tests in this repo need **no Docker, no `.env`, no running database, no setup**.
There is never a good reason to hand back code without having run them.

| What you changed | Run this (from that directory) | Typical duration |
|---|---|---|
| `backend/**` | `bun run test:local ./src/path/to/file.test.ts` | ~30 s incl. DB start |
| `backend/**` (whole suite) | `bun run test:local` | a few minutes |
| `frontend/**` | `bun run test` | ~3 s |
| `frontend/**` (types) | `bun run type-check` | ~30 s |
| `backend/**` (types) | `bun run typecheck` | ~30 s |
| `mcp-server/**` (types) | `bun run typecheck` | ~10 s |

`bun run test:local` boots its own embedded PGlite database on port 5499,
applies framework + app migrations, sets every required env var, runs the
tests and shuts down. Bare `bun test <file>` does **not** do this and needs a
live DB — prefer `test:local` always.

Never use `cd` to switch app; run the command from the correct directory.

### Definition of done

Before you report a task as complete:

1. New route or business logic → a test exists for it (see `backend-testing` skill).
2. The tests covering your change ran and are **green** — paste/summarise the result.
3. Types check for every app you touched.
4. If something is still red or unverified, say so explicitly. Never imply green.

Suites whose describe-name mentions `needs MISTRAL_API_KEY` (or similar) call
real AI APIs and fail slowly without keys — that is expected, skip them
offline instead of chasing the failures.

Want to see the change in the real app instead of only in tests? See
`CURSOR.md` for starting backend, frontend, DB and the magic-link test login.

---

## 2. Git & PR workflow — read this before every push

**`develop` is the one and only base branch.**
`main` is production (deployed by CI), `develop` is staging. Feature work is
never based on, and never merged into, another feature branch.

Rules, in order of how often they get broken:

1. **Every PR targets `develop`.** Never open a PR against `claude/*`,
   `feature/*` or any other working branch. If you catch yourself picking a
   base that is not `develop`, stop and re-check.
2. **Start every new piece of work from fresh `develop`:**
   ```bash
   git fetch origin develop
   git checkout -B claude/<short-topic> origin/develop
   ```
3. **A merged PR is finished — it can never carry follow-up work.** When the
   user says "merged, now fix X", the previous branch is dead. Do *not* push
   onto it and do *not* reopen its PR. Re-create the branch from the updated
   `develop` (same name is fine, or a new topic name) and open a **new** PR:
   ```bash
   git fetch origin develop
   git checkout -B claude/<topic> origin/develop   # discards merged history
   ```
   If the branch still holds unmerged commits, rebase them onto the new
   `develop` instead of discarding them.
4. **Check the state before assuming.** Whenever a session continues after a
   merge, verify first — do not rely on memory of what happened earlier:
   ```bash
   git fetch origin develop
   git log --oneline origin/develop -3
   git log --oneline origin/develop..HEAD    # empty ⇒ your work is merged, branch is dead
   ```
5. **Push with** `git push -u origin <branch>`. Retry network failures with
   backoff; never force-push a branch that carries unmerged work.
6. **Only create a PR when the user asks for one.** The user often opens PRs
   themselves — pushing the branch is usually the deliverable.

CI (`.github/workflows/build.yml`) builds Docker images for every PR and
deploys on push to `develop` (staging) / `main` (production).

---

## 3. Project Structure

Monorepo with three apps:
- `backend/` – Bun + Hono API server. Framework lives in `backend/framework/` (path alias: `@framework/*` → `./framework/src/*`). OAuth2/OIDC authorization server enabled via `oauth2` in `src/index.ts`.
- `frontend/` – Vue 3 SPA (Vite, Tailwind v4, PrimeVue/Volt)
- `mcp-server/` – standalone Bun MCP server (OAuth2 resource server). Lets a chat app use the wiki as its "brain": identity/discovery/read/write tools over the `knowledge/texts` API. Issues no tokens; validates the backend's OAuth tokens via `/oauth/introspect`. See `mcp-server/README.md`.

Hard rules:
- **NEVER change framework code** (`backend/framework/**`) — it is a submodule of a separate repo.
- Each app has its own `AGENTS.md` with app-specific rules; read it when you work there.

---

## 4. Skills Index

Load the matching skill **before** editing, not after something breaks.

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
| Frontend components & pages | `frontend/src/`, Vue components, Pinia, Tailwind, routing, i18n, fetcher, vitest specs | `.claude/skills/frontend-app/SKILL.md` |
| PrimeVue component details | PrimeVue APIs, props, DataTable, Dialog, Form, theming | `.claude/skills/prime-vue/SKILL.md` |
| ApexCharts | `apexcharts`, `vue3-apexcharts`, chart types, series schemas, reactivity | `.claude/skills/charts/SKILL.md` |
