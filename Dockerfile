# Base image with dependencies
# This Dockerfile is designed to run in GitHub Actions only
FROM oven/bun:1 AS base
WORKDIR /usr/src/app

# Install Drizzle-kit
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
