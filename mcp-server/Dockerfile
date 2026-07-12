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

EXPOSE 8787
CMD ["bun", "run", "src/index.ts"]
