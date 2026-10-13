# Contributing

Thanks for your interest in the Symbiosika Wiki! Bug reports, ideas and pull
requests are welcome.

## Before you start

- **Bugs & feature ideas:** open an issue first for anything larger than a
  small fix, so we can agree on the approach before you invest time.
- **Security issues:** never in a public issue — see [SECURITY.md](./SECURITY.md).

## Development setup

See [README.md](./README.md#setup) for the full setup. In short:

```bash
git clone https://github.com/symbiosika/wiki.git --recurse-submodules
cd wiki/backend && bun install && bun run init
cd ../frontend && bun install
```

`backend/framework` is a git submodule
([symbiosika-framework](https://github.com/symbiosika/symbiosika-framework)).
Changes to the framework belong in that repository, not here.

## Running the tests

Tests need no Docker, no `.env` and no running database:

| What you changed | Command (run in that directory) |
| --- | --- |
| `backend/**` | `bun run test:local ./src/path/to/file.test.ts` (or `bun run test:local` for all) |
| `backend/**` types | `bun run typecheck` |
| `frontend/**` | `bun run test` and `bun run type-check` |

`bun run test:local` starts its own embedded PGlite database, applies the
migrations, runs the tests and shuts down again. Suites marked
`needs MISTRAL_API_KEY` (or similar) call real AI APIs and can be skipped
offline.

## Pull requests

1. Branch off **`develop`** and target **`develop`** with your PR (`main` is
   the production branch).
2. Add or update tests for new routes and business logic.
3. Make sure tests and type checks pass for every app you touched.
4. If you changed the app (`backend/src`, `backend/drizzle-sql`,
   `backend/package.json`, `frontend/src`, `frontend-public/src`,
   `Dockerfile`), raise the version in `backend/package.json` once
   (semver: PATCH for fixes, MINOR for features, MAJOR for breaking changes)
   and add a `## [x.y.z] - YYYY-MM-DD` entry to [CHANGELOG.md](./CHANGELOG.md).
   CI checks this.

More details on conventions and project structure are in
[AGENTS.md](./AGENTS.md) and the per-app `AGENTS.md` files.

## License

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](./LICENSE), the license of this project (see section 5
of the license).
