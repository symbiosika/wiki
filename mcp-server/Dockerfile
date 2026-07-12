# syntax=docker/dockerfile:1.7
#
# Production image for the Symbiosika Wiki MCP server (OAuth2 resource server).
#
# Configuration (MCP_PUBLIC_URL, OAUTH_ISSUER, OAUTH_INTROSPECTION_SECRET, …)
# is injected at runtime via environment variables. No secrets are baked in.

FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src

# Infisical CLI — used by the entrypoint to inject secrets at runtime.
RUN apt-get update \
 && apt-get install -y --no-install-recommends bash curl ca-certificates \
 && curl -1sLf 'https://artifacts-cli.infisical.com/setup.deb.sh' | bash \
 && apt-get install -y --no-install-recommends infisical \
 && rm -rf /var/lib/apt/lists/*

COPY docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 8787

# Optional Infisical secret injection, then run the service (see the entrypoint).
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["bun", "run", "src/index.ts"]
