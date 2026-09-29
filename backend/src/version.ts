/**
 * The version of the running app — one source for `/health`, the MCP
 * `serverInfo.version` and anything else that reports it.
 *
 *   - `version`: the semver from backend/package.json, bumped by every PR
 *     that changes the app (rules: AGENTS.md → "Versioning"). Bundled in at
 *     build time, so the image always reports the code it was built from.
 *   - `commit` / `builtAt`: injected by CI as build args of the image (see
 *     the root Dockerfile). They tell apart two builds of the same version
 *     and are absent in a local dev run.
 */
// named import: the bundle carries the version, not the whole package.json
import { version } from "../package.json";

export type AppVersionInfo = {
  version: string;
  commit?: string;
  builtAt?: string;
};

const envValue = (name: string): string | undefined =>
  process.env[name]?.trim() || undefined;

export const APP_VERSION: string = version;

/** Version, build commit and build time (read lazily so tests can set env). */
export const appVersionInfo = (): AppVersionInfo => ({
  version: APP_VERSION,
  commit: envValue("APP_COMMIT"),
  builtAt: envValue("APP_BUILT_AT"),
});
