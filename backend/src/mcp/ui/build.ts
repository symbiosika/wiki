/**
 * The single-file HTML of each MCP App.
 *
 * An app is a browser entry (`./<name>.ts`, which pulls in the MCP Apps SDK)
 * plus an HTML template (`./<name>.html`) carrying an `__APP_SCRIPT__`
 * placeholder. The bundled script is inlined and the host fetches the result
 * as the `ui://…` resource.
 *
 * Two ways to get there, tried in order:
 *
 *   1. **Live bundling** with Bun's bundler — development, where the sources
 *      sit next to this module. First read pays ~100 ms, then memoised.
 *   2. **Prebuilt files** — production, where the server runs as a single
 *      `dist/index.js` bundle and neither the entries nor the templates exist
 *      on disk. `bun run build` writes the finished views to `dist/mcp-ui/`
 *      (see ./prebuild.ts); they are looked up relative to the running bundle
 *      first, then relative to the working directory.
 */

const APPS = {
  "page-view": true,
  "image-view": true,
} as const;

export type AppName = keyof typeof APPS;

export const APP_NAMES = Object.keys(APPS) as AppName[];

const cache = new Map<AppName, string>();

/** Bundle one view from its sources. Throws when the sources are absent. */
export async function bundleAppHtml(name: AppName): Promise<string> {
  const entry = new URL(`./${name}.ts`, import.meta.url).pathname;
  const result = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    format: "esm",
    minify: true,
  });
  if (!result.success || !result.outputs[0]) {
    throw new Error(
      `Failed to bundle the ${name} app: ${result.logs.join("\n")}`,
    );
  }

  const js = await result.outputs[0].text();
  const template = await Bun.file(
    new URL(`./${name}.html`, import.meta.url),
  ).text();

  // `</script` inside the bundled code would end the inline tag early.
  const safeJs = js.replaceAll("</script", "<\\/script");
  return template.replace("/*__APP_SCRIPT__*/", () => safeJs);
}

/** Load one prebuilt view (written by ./prebuild.ts at build time). */
async function readPrebuiltAppHtml(name: AppName): Promise<string> {
  // Relative to the running bundle (dist/index.js → dist/mcp-ui/), then to
  // the working directory (matches the production layout, where the process
  // starts next to its dist/ folder).
  const candidates = [
    new URL(`./mcp-ui/${name}.html`, import.meta.url).pathname,
    `${process.cwd()}/dist/mcp-ui/${name}.html`,
  ];
  for (const path of candidates) {
    const file = Bun.file(path);
    if (await file.exists()) {
      return file.text();
    }
  }
  throw new Error(
    `The ${name} app is neither bundleable from source nor prebuilt ` +
      `(looked for ${candidates.join(", ")}). Run \`bun run build\` — it ` +
      `writes the views to dist/mcp-ui/.`,
  );
}

export async function buildAppHtml(name: AppName): Promise<string> {
  const cached = cache.get(name);
  if (cached) return cached;

  let html: string;
  try {
    html = await bundleAppHtml(name);
  } catch {
    html = await readPrebuiltAppHtml(name);
  }
  cache.set(name, html);
  return html;
}
