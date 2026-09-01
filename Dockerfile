# Base image with dependencies
# This Dockerfile is designed to run in GitHub Actions only
FROM oven/bun:1 AS base
WORKDIR /usr/src/app

# drizzle-kit runs at container start (DB migrations) and is not part of the
# bundled app, so install it globally. NODE_PATH lets the drizzle config files
# (which `import { defineConfig } from "drizzle-kit"`) resolve it from the
# global install at runtime — the artifact itself carries no node_modules.
ENV BUN_INSTALL=/root/.bun
ENV NODE_PATH=/root/.bun/install/global/node_modules
RUN bun i -g drizzle-orm pg drizzle-kit

# Infisical CLI — used by the entrypoint to inject secrets at runtime.
RUN apt-get update \
 && apt-get install -y --no-install-recommends bash curl ca-certificates \
 && curl -1sLf 'https://artifacts-cli.infisical.com/setup.deb.sh' | bash \
 && apt-get install -y --no-install-recommends infisical \
 && rm -rf /var/lib/apt/lists/*

# Expose the port your app runs on
EXPOSE 3000

# Production (GitHub Actions) - includes all build artifacts
# Expects:
# - dist/ directory (from backend and frontend builds)
FROM base AS release-ci

# Copy built artifacts
COPY dist ./

# The entrypoint optionally injects Infisical secrets, then runs the CMD
# (migrations + app start). Without an Infisical token it runs the CMD directly
# with the injected environment.
COPY .docker/prod-entrypoint.sh /usr/local/bin/prod-entrypoint.sh
RUN chmod +x /usr/local/bin/prod-entrypoint.sh

# Run migrations and start the app.
#
# The final `exec` matters: without it the shell stays PID 1 and `bun` runs as
# its child. A POSIX shell does not forward signals, so `docker stop` (and every
# redeploy, and every `docker restart`) would deliver SIGTERM to the shell only
# — the app would never see it, never log its shutdown, and would be SIGKILLed
# when the grace period ran out, dropping every in-flight request as a reset
# connection. To a reverse proxy that reset is a 502. With `exec`, bun *is*
# PID 1, receives the signal, and records why it stopped
# (see backend/src/lib/diagnostics and docs/bad-gateway-debugging.md).
ENTRYPOINT ["/usr/local/bin/prod-entrypoint.sh"]
CMD ["sh", "-c", "bun run framework:migrate && bun run app:migrate && exec bun ./dist/index.js"]
