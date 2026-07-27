#!/bin/sh
# Entrypoint for the all-in-one preview image (see ../Dockerfile.preview).
#
# Boot sequence:
#   1. bootstrap secrets (AES + JWT + OAuth introspection) into $PREVIEW_DATA_DIR
#   2. start the embedded PGlite database and wait until it accepts connections
#   3. run the framework and app migrations
#   4. exec the CMD (the app) and keep both processes alive
#
# Everything is optional/overridable via environment variables, so the same
# image also runs against an external Postgres (set POSTGRES_HOST to something
# other than localhost, or PREVIEW_EMBEDDED_DB=false).
set -e

log() { echo "[preview] $*"; }

DATA_DIR="${PREVIEW_DATA_DIR:-/data}"
mkdir -p "$DATA_DIR"

# ---------------------------------------------------------------------------
# 1. Secrets
#
# A preview must not ship baked-in keys, and asking every preview deployment to
# supply them defeats the purpose. So: generate once on first start, persist in
# the data volume (0600) and reuse afterwards, which keeps sessions and
# encrypted tenant secrets valid across restarts. Values passed in from the
# outside always win — nothing here overwrites an env var that is already set.
# ---------------------------------------------------------------------------
SECRETS_FILE="$DATA_DIR/secrets.env"
if [ ! -f "$SECRETS_FILE" ]; then
  log "generating preview secrets -> $SECRETS_FILE"
  bun /opt/preview/preview-generate-secrets.ts > "$SECRETS_FILE.tmp"
  chmod 600 "$SECRETS_FILE.tmp"
  mv "$SECRETS_FILE.tmp" "$SECRETS_FILE"
fi

for var in SECRETS_AES_KEY SECRETS_AES_IV JWT_PRIVATE_KEY JWT_PUBLIC_KEY OAUTH_INTROSPECTION_SECRET; do
  eval "current=\${$var:-}"
  if [ -z "$current" ]; then
    value=$(sed -n "s/^$var=//p" "$SECRETS_FILE")
    if [ -n "$value" ]; then
      export "$var=$value"
    fi
  fi
done

# ---------------------------------------------------------------------------
# 2. Embedded database
#
# PGlite is file-backed and speaks the Postgres wire protocol through
# pglite-socket, so the app and drizzle-kit connect with the normal POSTGRES_*
# variables and no code path changes. Enabled automatically whenever the app
# points at localhost; set PREVIEW_EMBEDDED_DB=false to use an external DB.
# ---------------------------------------------------------------------------
DB_PID=""
POSTGRES_HOST="${POSTGRES_HOST:-127.0.0.1}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
# Credentials are meaningless for PGlite (it accepts any login) but the app and
# drizzle-kit require them to be set.
POSTGRES_USER="${POSTGRES_USER:-preview}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-preview}"
POSTGRES_DB="${POSTGRES_DB:-preview}"
export POSTGRES_HOST POSTGRES_PORT POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB

embedded_db_wanted() {
  case "${PREVIEW_EMBEDDED_DB:-auto}" in
    true) return 0 ;;
    false) return 1 ;;
    *)
      case "$POSTGRES_HOST" in
        127.0.0.1 | localhost | ::1) return 0 ;;
        *) return 1 ;;
      esac
      ;;
  esac
}

if embedded_db_wanted; then
  # The framework's local dev DB server reads these (see
  # backend/framework/.scripts/local-db-server.ts).
  export LOCAL_DB_DIR="${LOCAL_DB_DIR:-$DATA_DIR/pglite}"
  export LOCAL_DB_HOST=127.0.0.1
  export POSTGRES_PORT

  log "starting embedded PGlite database on 127.0.0.1:$POSTGRES_PORT (dir: $LOCAL_DB_DIR)"
  bun /opt/pglite/db-server.ts &
  DB_PID=$!

  bun /opt/preview/preview-wait-for-db.ts
else
  log "embedded database disabled — using $POSTGRES_HOST:$POSTGRES_PORT"
fi

# ---------------------------------------------------------------------------
# 3. Uploads
#
# Files stored with storageType "local" land in ./static/upload (relative to the
# app's working directory). Link it into the data volume so uploads survive a
# container replacement just like the database does.
# ---------------------------------------------------------------------------
if [ ! -e /usr/src/app/static/upload ]; then
  mkdir -p "$DATA_DIR/uploads"
  ln -s "$DATA_DIR/uploads" /usr/src/app/static/upload
fi

# ---------------------------------------------------------------------------
# 4. Migrations — same two steps as the production image's CMD.
# ---------------------------------------------------------------------------
if [ "${PREVIEW_SKIP_MIGRATIONS:-false}" = "true" ]; then
  log "skipping migrations (PREVIEW_SKIP_MIGRATIONS=true)"
else
  log "running framework migrations"
  bun run framework:migrate
  log "running app migrations"
  bun run app:migrate
fi

# ---------------------------------------------------------------------------
# 5. App
#
# Run it as a child (not exec) so the database gets a clean shutdown — PGlite
# needs to flush and close its data directory, otherwise a preview can come back
# up on a half-written database.
# ---------------------------------------------------------------------------
APP_PID=""

shutdown() {
  log "shutting down"
  [ -n "$APP_PID" ] && kill -TERM "$APP_PID" 2>/dev/null || true
  [ -n "$DB_PID" ] && kill -TERM "$DB_PID" 2>/dev/null || true
}
trap shutdown INT TERM

log "starting app: $*"
"$@" &
APP_PID=$!

EXIT_CODE=0
wait "$APP_PID" || EXIT_CODE=$?

if [ -n "$DB_PID" ]; then
  kill -TERM "$DB_PID" 2>/dev/null || true
  wait "$DB_PID" 2>/dev/null || true
fi

log "app exited with code $EXIT_CODE"
exit "$EXIT_CODE"
