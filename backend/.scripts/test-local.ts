/**
 * Zero-setup local test runner (PGlite).
 *
 * Runs the backend test suite against an embedded PGlite database — no Docker,
 * no external Postgres, no .env required. Designed so a coding agent (or a
 * developer) can verify work with a single command:
 *
 *   bun run test:local                                  # all tests
 *   bun run test:local src/lib/wiki/tree.test.ts        # one file
 *   bun run test:local --fresh                          # wipe the test DB first
 *   bun run test:local --serve                          # no tests: just start the
 *                                                       #   test DB + migrations and
 *                                                       #   keep serving (for db:query,
 *                                                       #   manual `bun test`, dev server)
 *   bun run test:local --keep <files>                   # run tests, then keep the DB
 *                                                       #   serving for inspection
 *
 * What it does:
 *   1. Starts PGlite (with pgvector) on its own port (default 5499) via the
 *      Postgres wire protocol — separate from a dev DB on 5432.
 *   2. Applies framework + app migrations (idempotent, fast on re-runs).
 *   3. Runs `bun test <args>` with the right environment and exits with the
 *      test run's exit code.
 *
 * Environment defaults it provides (existing env vars win, except POSTGRES_*
 * which are always pointed at the test DB so tests can never hit a real one):
 *   POSTGRES_* ..................... the embedded test database
 *   JWT_PRIVATE_KEY / PUBLIC_KEY ... a shared local HS256 secret (the framework
 *                                    signs and verifies session JWTs symmetrically,
 *                                    so both MUST hold the same value)
 *   SMTP_HOST=console.localhost .... emails go to logs/email/ instead of the network
 *
 * The DB persists in ./dev-db/pglite-test-<port> between runs (gitignored) so
 * repeat runs skip migration work. Use --fresh for a clean slate.
 *
 * This script only depends on the framework layout (framework/ + drizzle
 * configs) — it is app-agnostic and can be shared across apps built on the
 * symbiosika-framework.
 */
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

// Run from the app's backend root (the directory containing framework/ and
// package.json) — `bun run test:local` does this automatically. Location-
// independent so the same file works from <app>/.scripts/ or framework/.scripts/.
// Layout detection: in an app, the framework lives in framework/ and the app's
// own drizzle.config.ts sits in the root; in the framework repo itself, the
// framework config IS ./drizzle.config.ts and there is no app config.
const BACKEND_DIR = process.cwd();
const isAppLayout = existsSync(
  path.join(BACKEND_DIR, "framework", "drizzle.config.ts")
);
if (!isAppLayout && !existsSync(path.join(BACKEND_DIR, "drizzle.config.ts"))) {
  console.error(
    `[test-local] run this from the backend root (no framework/drizzle.config.ts or drizzle.config.ts found in ${BACKEND_DIR})`
  );
  process.exit(1);
}

// ---- CLI args ---------------------------------------------------------------
const rawArgs = process.argv.slice(2);
const fresh = rawArgs.includes("--fresh");
const serveOnly = rawArgs.includes("--serve");
const keepOpen = rawArgs.includes("--keep");
const testArgs = rawArgs.filter(
  (a) => !["--fresh", "--serve", "--keep"].includes(a)
);

// ---- Test database ------------------------------------------------------------
const PORT = parseInt(process.env.TEST_DB_PORT ?? "5499");
const HOST = "127.0.0.1";
// Port is part of the default dir name so two concurrent instances (on
// different ports) never open the same data directory.
const DIR =
  process.env.TEST_DB_DIR ??
  path.join(BACKEND_DIR, "dev-db", `pglite-test-${PORT}`);

if (fresh && existsSync(DIR)) {
  console.log(`[test-local] --fresh: removing ${DIR}`);
  rmSync(DIR, { recursive: true, force: true });
}
mkdirSync(DIR, { recursive: true });

console.log(`[test-local] starting PGlite on ${HOST}:${PORT} (dir: ${DIR})`);
const db = await PGlite.create(DIR, { extensions: { vector } });
await db.exec("CREATE EXTENSION IF NOT EXISTS vector;");

let server: PGLiteSocketServer;
try {
  server = new PGLiteSocketServer({ db, port: PORT, host: HOST, maxConnections: 20 });
  await server.start();
} catch (error) {
  console.error(
    `[test-local] could not listen on port ${PORT} — is another test-local or ` +
      `db server still running? (override with TEST_DB_PORT=<port>)`
  );
  console.error(error);
  process.exit(1);
}

// ---- Environment for all child processes ------------------------------------
// POSTGRES_* is force-pointed at the embedded DB (never a real database).
// Everything else only fills in gaps so an existing .env still wins.
const jwtSecret =
  process.env.JWT_PRIVATE_KEY && process.env.JWT_PUBLIC_KEY
    ? undefined // both present → keep them
    : "local-test-secret";
const env: Record<string, string | undefined> = {
  ...process.env,
  POSTGRES_HOST: HOST,
  POSTGRES_PORT: String(PORT),
  POSTGRES_DB: "postgres",
  POSTGRES_USER: "postgres",
  POSTGRES_PASSWORD: "postgres",
  POSTGRES_CA: "",
  POSTGRES_CONNECTION_POOL_SIZE: process.env.POSTGRES_CONNECTION_POOL_SIZE ?? "5",
  ...(jwtSecret && { JWT_PRIVATE_KEY: jwtSecret, JWT_PUBLIC_KEY: jwtSecret }),
  // AES master key for tenant secrets. Without it the framework generates one
  // and calls process.exit() mid-test-run. Deterministic so data encrypted in
  // the persistent test DB stays decryptable across runs. Local tests only.
  SECRETS_AES_KEY: process.env.SECRETS_AES_KEY ?? "10".repeat(32),
  SECRETS_AES_IV: process.env.SECRETS_AES_IV ?? "10".repeat(16),
  SMTP_HOST: process.env.SMTP_HOST ?? "console.localhost",
};

const run = async (cmd: string[], label: string): Promise<number> => {
  console.log(`[test-local] ${label}: ${cmd.join(" ")}`);
  const proc = Bun.spawn(cmd, {
    cwd: BACKEND_DIR,
    env,
    stdio: ["inherit", "inherit", "inherit"],
  });
  return await proc.exited;
};

const shutdown = async (code: number): Promise<never> => {
  await server.stop().catch(() => {});
  await db.close().catch(() => {});
  process.exit(code);
};
process.on("SIGINT", () => void shutdown(130));
process.on("SIGTERM", () => void shutdown(143));

// ---- Migrations ---------------------------------------------------------------
const frameworkConfig = isAppLayout
  ? "framework/drizzle.config.ts"
  : "drizzle.config.ts";
const frameworkMigrate = await run(
  ["bunx", "drizzle-kit", "migrate", "--config", frameworkConfig],
  "framework migrations"
);
if (frameworkMigrate !== 0) await shutdown(frameworkMigrate);

if (isAppLayout && existsSync(path.join(BACKEND_DIR, "drizzle.config.ts"))) {
  const appMigrate = await run(["bunx", "drizzle-kit", "migrate"], "app migrations");
  if (appMigrate !== 0) await shutdown(appMigrate);
}

// ---- Tests / serve mode ---------------------------------------------------------
const printEnvHint = () => {
  console.log(
    `\n[test-local] test DB is serving on ${HOST}:${PORT}. Use it with e.g.:\n` +
      `  POSTGRES_HOST=${HOST} POSTGRES_PORT=${PORT} POSTGRES_DB=postgres ` +
      `POSTGRES_USER=postgres POSTGRES_PASSWORD=postgres \\\n` +
      `    bun run db:query "SELECT count(*) FROM base_users"\n` +
      `Press Ctrl+C to stop.`
  );
};

if (serveOnly) {
  printEnvHint();
  // keep process alive until Ctrl+C
} else {
  const exitCode = await run(["bun", "test", ...testArgs], "tests");
  if (keepOpen) {
    printEnvHint();
  } else {
    await shutdown(exitCode);
  }
}
