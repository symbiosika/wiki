/**
 * Builds the single-file HTML of the MCP App (page view) — on demand, in
 * process, via Bun's bundler. The browser entry (page-view.ts, which pulls in
 * the MCP Apps SDK + marked) is bundled to one script and inlined into the
 * HTML template; hosts fetch the result as the `ui://…/page-view.html`
 * resource. Memoized: the first `resources/read` pays ~100ms, all later
 * reads are free.
 */

const TEMPLATE_URL = new URL("./page-view.html", import.meta.url);
const ENTRY_URL = new URL("./page-view.ts", import.meta.url);

let cached: string | null = null;

export async function buildPageViewHtml(): Promise<string> {
  if (cached) return cached;

  const result = await Bun.build({
    entrypoints: [ENTRY_URL.pathname],
    target: "browser",
    format: "esm",
    minify: true,
  });
  if (!result.success || !result.outputs[0]) {
    throw new Error(
      `Failed to bundle the page-view app: ${result.logs.join("\n")}`,
    );
  }

  const js = await result.outputs[0].text();
  const template = await Bun.file(TEMPLATE_URL).text();

  // `</script` inside the bundled code would end the inline tag early.
  const safeJs = js.replaceAll("</script", "<\\/script");
  cached = template.replace("/*__APP_SCRIPT__*/", () => safeJs);
  return cached;
}
