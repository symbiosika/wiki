#!/bin/sh
# Production entrypoint for the app image with optional Infisical secret
# injection and an optional post-injection override file.
#
# Order of precedence (lowest -> highest):
#   1. env baked into the image / injected by the orchestrator (docker -e / --env-file)
#   2. secrets from Infisical (if INFISICAL_TOKEN + INFISICAL_PROJECT_ID set)
#   3. /etc/app/preview-overrides.env (if present)
#
# The override file lets PR previews keep their OWN Postgres (and other in-VM
# endpoints) even when Infisical injects a shared env like `staging`: without
# it, Infisical's POSTGRES_HOST would point the app at staging. In prod the file
# is absent, so this is a no-op there.
#
# Infisical env (when enabled):
#   INFISICAL_TOKEN, INFISICAL_PROJECT_ID, INFISICAL_ENV (default prod),
#   INFISICAL_API_URL (default https://app.infisical.com)
set -e

OVERRIDE_FILE="/etc/app/preview-overrides.env"

apply_overrides_and_exec() {
  if [ -f "$OVERRIDE_FILE" ]; then
    echo "[entrypoint] applying overrides from $OVERRIDE_FILE"
    set -a
    . "$OVERRIDE_FILE"
    set +a
  fi
  exec "$@"
}

# Second stage: re-entered inside `infisical run` so the override wins over
# Infisical-injected values.
if [ "$1" = "--apply-overrides" ]; then
  shift
  apply_overrides_and_exec "$@"
fi

if [ -n "$INFISICAL_TOKEN" ] && [ -n "$INFISICAL_PROJECT_ID" ]; then
  echo "[entrypoint] Infisical enabled (env=${INFISICAL_ENV:-prod})"
  exec infisical run \
    --projectId="$INFISICAL_PROJECT_ID" \
    --env="${INFISICAL_ENV:-prod}" \
    --domain="${INFISICAL_API_URL:-https://app.infisical.com}" \
    -- "$0" --apply-overrides "$@"
else
  echo "[entrypoint] Infisical disabled — using injected environment"
  apply_overrides_and_exec "$@"
fi
