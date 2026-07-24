
## Cursor Cloud specific instructions

The startup update script already installs `bun`, checks out the `backend/framework` submodule, installs deps for all three apps, and generates `backend/.env` (with `POSTGRES_CONNECTION_POOL_SIZE=1` for PGlite). It does NOT start any service or run migrations — do those yourself.

Services (all use `bun`; see each `package.json` for scripts):
- Backend API (`backend/`) → `http://localhost:3000`. The `dev` script wraps `infisical`, which is NOT installed here; run the server directly instead: `bun --hot run src/index.ts` (Bun auto-loads `backend/.env`). Lint/typecheck: `bun x tsc --noEmit`. Tests: `bun run test:local <files>` (self-contained: starts its own PGlite on port 5499, migrates, runs the tests — needs no running DB or .env). Bare `bun test <files>` also works against the live local DB.
- Frontend SPA (`frontend/`) → `http://localhost:5173/static/app/`. `bun run dev`. It proxies `/api/v1` and the auth `*.html` pages to the backend, so run the backend first. Typecheck `bun run type-check`, tests `bun run test`.
- MCP server (`mcp-server/`, optional) → needs `bun run init` once then `bun run dev`; requires the backend running.

Local DB and migrations (required before the backend serves data):
- Start embedded Postgres (PGlite, no Docker): `cd backend && bun run db:local` (listens on `localhost:5432`). Keep it running in its own terminal/tmux session.
- Then apply migrations: `cd backend && bun run migrate` (framework + app). Docker is NOT installed, so `bun run docker:up` is unavailable — use PGlite.

Login without SMTP (magic link): emails are written to `backend/logs/email/`. With the server running, `cd backend && bash ./.scripts/testuser.sh` does the whole flow and prints a JWT. Manually: `GET /api/v1/user/send-magic-link?email=testing@env.local&createUserIfMissing=true`, read the newest file in `backend/logs/email/`, extract the `token=` value, then `GET /api/v1/user/verify-email?token=<TOKEN>` (returns a JWT). In the browser the same magic link works via `http://localhost:5173/magic-login-verify.html?token=<TOKEN>`. On first login the app auto-creates a default tenant.

AI features (day-log transcription, document assistant, summaries) are disabled unless `OPENROUTER_API_KEY` / `MISTRAL_API_KEY` are set; the core wiki works without them.

