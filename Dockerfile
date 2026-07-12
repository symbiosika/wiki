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

# Expose the port your app runs on
EXPOSE 3000

# Production (GitHub Actions) - includes all build artifacts
# Expects:
# - dist/ directory (from backend and frontend builds)
FROM base AS release-ci

# Copy built artifacts
COPY dist ./

# Run migrations and start the app
CMD ["sh", "-c", "bun run framework:migrate && bun run app:migrate && bun ./dist/index.js"]
