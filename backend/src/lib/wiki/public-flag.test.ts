import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  PUBLIC_WIKI_STATIC_DIR,
  isPublicWikiEnabled,
  publicWikiStaticExclusions,
} from "./public-flag";

/*
 * The flag is read from an injected object rather than the real environment so
 * these tests cannot leak into the rest of the suite (which runs against a
 * server that has already read process.env at import time).
 */
const env = (PUBLIC_WIKI_ENABLED?: string) => ({ PUBLIC_WIKI_ENABLED });

describe("isPublicWikiEnabled", () => {
  it("defaults to on when the variable is absent or empty", () => {
    expect(isPublicWikiEnabled({})).toBe(true);
    expect(isPublicWikiEnabled(env(undefined))).toBe(true);
    expect(isPublicWikiEnabled(env(""))).toBe(true);
  });

  it("accepts the usual spellings for off", () => {
    for (const value of ["false", "0", "no", "off", "disabled"]) {
      expect({ value, on: isPublicWikiEnabled(env(value)) }).toEqual({
        value,
        on: false,
      });
    }
  });

  it("accepts the usual spellings for on", () => {
    for (const value of ["true", "1", "yes", "on", "enabled"]) {
      expect({ value, on: isPublicWikiEnabled(env(value)) }).toEqual({
        value,
        on: true,
      });
    }
  });

  it("ignores case and surrounding whitespace", () => {
    expect(isPublicWikiEnabled(env("  FALSE "))).toBe(false);
    expect(isPublicWikiEnabled(env("Off"))).toBe(false);
    expect(isPublicWikiEnabled(env(" True"))).toBe(true);
  });

  it("refuses to interpret an unrecognised value", () => {
    // Falling back to "on" here would turn a typo in the one variable an
    // operator sets to keep pages private into a silent publish.
    for (const value of ["fasle", "nope", "maybe", "-1"]) {
      expect(() => isPublicWikiEnabled(env(value))).toThrow(
        /PUBLIC_WIKI_ENABLED/
      );
    }
  });
});

describe("publicWikiStaticExclusions", () => {
  it("withholds nothing while the feature is on", () => {
    expect(publicWikiStaticExclusions({})).toEqual([]);
    expect(publicWikiStaticExclusions(env("true"))).toEqual([]);
  });

  it("withholds the documentation bundle once the feature is off", () => {
    expect(publicWikiStaticExclusions(env("false"))).toEqual([
      PUBLIC_WIKI_STATIC_DIR,
    ]);
  });

  it("names the directory the build actually writes to", async () => {
    // Read the real Vite config instead of restating the constant. If the docs
    // site ever moves, the off switch would otherwise keep hiding a directory
    // that no longer exists and silently stop working — the failure mode here
    // is a page that stays online after being switched off.
    const config = await Bun.file(
      join(import.meta.dir, "../../../../frontend-public/vite.config.ts")
    ).text();

    const base = config.match(/base:\s*['"]\/([^'"/]+)\/['"]/)?.[1];
    const outDir = config.match(
      /outDir:\s*['"]dist\/public\/([^'"/]+)['"]/
    )?.[1];

    expect({ base, outDir }).toEqual({
      base: PUBLIC_WIKI_STATIC_DIR,
      outDir: PUBLIC_WIKI_STATIC_DIR,
    });
  });
});
