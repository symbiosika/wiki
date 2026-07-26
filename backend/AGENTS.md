# App

This app uses the symbiosika-framework. See skills `backend-framework`, `backend-app`, `backend-testing`, `build-ai-agents` for details.

## Rules

- NEVER change the framework code in `framework/`!
- Always create unit tests for new routes and business logic
- Run tests until green before finishing — from `backend/`, never with `cd`:
  - one file: `bun run test:local ./src/path/to/file.test.ts`
  - everything: `bun run test:local`
  - types: `bun run typecheck`
- `test:local` needs no setup: it starts its own PGlite DB, migrates and tears
  down again. Plain `bun test <file>` only works against an already-running DB —
  prefer `test:local`.
