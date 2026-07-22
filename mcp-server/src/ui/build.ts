/**
 * Builds the single-file HTMLs of the MCP Apps — on demand, in process, via
 * Bun's bundler. Each app is a browser entry (`./<name>.ts`, pulls in the MCP
 * Apps SDK) plus an HTML template (`./<name>.html`) with an `__APP_SCRIPT__`
 * placeholder comment; the bundled script is inlined and hosts fetch the
 * result as the `ui://…` resource. Memoized per app: the first
 * `resources/read` pays ~100ms, later reads are free.
 */

const APPS = {
  "page-view": true,
  "image-view": true,
} as const;

export type AppName = keyof typeof APPS;

const cache = new Map<AppName, string>();

export async function buildAppHtml(name: AppName): Promise<string> {
  const cached = cache.get(name);
  if (cached) return cached;

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
  const html = template.replace("/*__APP_SCRIPT__*/", () => safeJs);
  cache.set(name, html);
  return html;
}
