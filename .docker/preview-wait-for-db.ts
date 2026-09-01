/**
 * Blocks until the embedded PGlite socket server accepts TCP connections.
 *
 * PGLiteSocketServer only starts listening once the database is opened and the
 * pgvector extension is loaded, so a successful connect is a sufficient
 * readiness signal for the migrations that run next.
 */
const HOST = process.env.LOCAL_DB_HOST ?? "127.0.0.1";
const PORT = parseInt(process.env.POSTGRES_PORT ?? "5432");
const TIMEOUT_MS = parseInt(process.env.PREVIEW_DB_WAIT_TIMEOUT_MS ?? "60000");
const INTERVAL_MS = 250;

const deadline = Date.now() + TIMEOUT_MS;

const canConnect = async (): Promise<boolean> => {
  try {
    const socket = await Bun.connect({
      hostname: HOST,
      port: PORT,
      socket: { data() {}, error() {} },
    });
    socket.end();
    return true;
  } catch {
    return false;
  }
};

while (!(await canConnect())) {
  if (Date.now() > deadline) {
    console.error(
      `[preview] database at ${HOST}:${PORT} did not become ready within ${TIMEOUT_MS}ms`
    );
    process.exit(1);
  }
  await Bun.sleep(INTERVAL_MS);
}

console.log(`[preview] database ready at ${HOST}:${PORT}`);
