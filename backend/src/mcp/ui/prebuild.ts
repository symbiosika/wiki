/**
 * Build-time rendering of the MCP-App views.
 *
 * The production server is one `dist/index.js` bundle — the view sources
 * (browser entries + HTML templates) are not shipped, so runtime bundling is
 * impossible there. This script runs as part of `bun run build` and writes
 * the finished single-file views to `dist/mcp-ui/`, where the runtime
 * fallback in ./build.ts picks them up.
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { APP_NAMES, bundleAppHtml } from "./build";

export async function prebuildAppViews(outDir: string): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  const written: string[] = [];
  for (const name of APP_NAMES) {
    const html = await bundleAppHtml(name);
    const target = path.join(outDir, `${name}.html`);
    await Bun.write(target, html);
    written.push(target);
  }
  return written;
}

if (import.meta.main) {
  const outDir = process.argv[2] ?? path.join(process.cwd(), "dist", "mcp-ui");
  const written = await prebuildAppViews(outDir);
  console.log(
    `[mcp-ui] prebuilt ${written.length} view(s):\n  ${written.join("\n  ")}`,
  );
}
