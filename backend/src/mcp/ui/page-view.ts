/**
 * Browser entry of the MCP App "wiki page view" (runs inside the host's
 * sandboxed iframe — claude.ai & co). Bundled to a single inline script by
 * ../ui/build.ts and delivered as the `ui://symbiosika-wiki/page-view.html`
 * resource.
 *
 * Flow:
 *   1. the host calls the `view_page` tool and renders this app,
 *   2. we receive the tool result ({ id, title, content }) via `ontoolresult`,
 *   3. the markdown is rendered locally (marked),
 *   4. images can NOT be loaded from the wiki directly (sandbox CSP + no
 *      token in the iframe) — instead each one is fetched through the
 *      `get_page_image` tool (base64) and swapped in as a data: URI,
 *   5. [[wikilinks]] navigate in place: resolve_page → view_page → re-render.
 */
import { App } from "@modelcontextprotocol/ext-apps/app-with-deps";
import { marked } from "marked";

type PageData = {
  id: string;
  title?: string;
  content?: string;
  /** link to this page in the wiki web app (added by the server) */
  url?: string;
};

const statusEl = document.getElementById("status")!;
const headerEl = document.getElementById("page-header")!;
const titleEl = document.getElementById("page-title")!;
const articleEl = document.getElementById("page")!;
const linkEl = document.getElementById("page-crumbs")!;

const app = new App(
  { name: "Symbiosika Wiki Page View", version: "1.0.0" },
  {},
  { autoResize: true },
);

let currentPageId: string | null = null;

// ── theming ──────────────────────────────────────────────────────────────────
function applyTheme(theme: string | undefined) {
  if (theme === "dark" || theme === "light") {
    document.documentElement.dataset.theme = theme;
  }
}
app.onhostcontextchanged = (ctx) => applyTheme((ctx as any)?.theme);

// ── markdown rendering ───────────────────────────────────────────────────────
/** Replace [[Title]] / [[Title|Label]] markers with clickable spans. */
function linkifyWikilinks(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if ((n.nodeValue ?? "").includes("[[")) textNodes.push(n as Text);
  }
  for (const node of textNodes) {
    if (node.parentElement?.closest("code, pre, a")) continue;
    const frag = document.createDocumentFragment();
    let rest = node.nodeValue ?? "";
    const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/;
    let match: RegExpExecArray | null;
    while ((match = re.exec(rest))) {
      frag.append(rest.slice(0, match.index));
      const span = document.createElement("span");
      span.className = "wikilink";
      span.textContent = match[2] ?? match[1]!;
      span.dataset.target = match[1]!.trim();
      frag.append(span);
      rest = rest.slice(match.index + match[0].length);
    }
    frag.append(rest);
    node.replaceWith(frag);
  }
}

/**
 * Turn every `<image-description>` marker into a collapsed caption under the
 * image it belongs to.
 *
 * The marker is how a description travels through the page text (so search and
 * an AI reader see it). For a HUMAN it is markup: dropped into the DOM as-is it
 * would show up as a stray line of text under the picture. Folded into a
 * `<details>` it is there when someone wants it and out of the way otherwise —
 * the same deal as in the wiki's own editor.
 */
function renderImageDescriptions(root: HTMLElement) {
  const images = [...root.querySelectorAll("img")];

  for (const marker of [...root.querySelectorAll("image-description")]) {
    const text = (marker.textContent ?? "").replace(/\s+/g, " ").trim();
    const src = marker.getAttribute("src") ?? "";
    const target =
      images.find((img) => {
        const name = wikiImageFilename(img.getAttribute("src") ?? "");
        return name !== null && name === wikiImageFilename(src);
      }) ??
      // no match by path: the marker's own position is the next best anchor
      (marker.previousElementSibling?.tagName === "IMG"
        ? (marker.previousElementSibling as HTMLElement)
        : null);

    marker.remove();
    if (!text) continue;

    const details = document.createElement("details");
    details.className = "image-description";
    const summary = document.createElement("summary");
    summary.textContent = "Image description";
    const body = document.createElement("p");
    body.textContent = text;
    details.append(summary, body);

    if (target) target.after(details);
    else root.append(details);
  }
}

/**
 * Extract `<uuid>.<ext>` from a wiki file URL — from either bucket that holds
 * page images: `…/files/db/knowledge/…` (editor upload) and
 * `…/files/db/images/…` (extracted from an imported document).
 */
function wikiImageFilename(src: string): string | null {
  const m =
    /\/files\/db\/(?:knowledge|images)\/([0-9a-f-]{36}\.[a-z0-9]{1,8})(?:[?#]|$)/i.exec(
      src,
    );
  return m ? m[1]! : null;
}

/** Swap every wiki image in the article for a data: URI via get_page_image. */
async function hydrateImages(pageId: string) {
  const imgs = [...articleEl.querySelectorAll("img")];
  await Promise.allSettled(
    imgs.map(async (img) => {
      const filename = wikiImageFilename(img.getAttribute("src") ?? "");
      if (!filename) return;
      img.removeAttribute("src"); // avoid a doomed request in the sandbox
      img.classList.add("loading");
      try {
        const result = await app.callServerTool({
          name: "get_page_image",
          arguments: { pageId, image: filename },
        });
        const block = (result.content ?? []).find(
          (c: any) => c.type === "image",
        ) as { data: string; mimeType: string } | undefined;
        if (block) {
          img.src = `data:${block.mimeType};base64,${block.data}`;
          img.classList.remove("loading");
        } else {
          img.alt = `${img.alt || "image"} (could not be loaded)`;
        }
      } catch {
        img.alt = `${img.alt || "image"} (could not be loaded)`;
      }
    }),
  );
}

/**
 * "Open in wiki" in the header: the sandboxed iframe may not navigate itself,
 * so the host is asked to open the URL (`ui/open-link`). If it declines, the
 * plain URL is shown so it can still be copied.
 */
function renderPageLink(url: string | undefined) {
  linkEl.textContent = "";
  linkEl.hidden = !url;
  if (!url) return;
  const link = document.createElement("a");
  link.className = "page-link";
  link.href = url;
  link.textContent = "Open in wiki ↗";
  link.addEventListener("click", (event) => {
    event.preventDefault();
    void app
      .openLink({ url })
      .then((result) => {
        if (result.isError) linkEl.textContent = url;
      })
      .catch(() => {
        linkEl.textContent = url;
      });
  });
  linkEl.append(link);
}

async function renderPage(page: PageData) {
  currentPageId = page.id;
  titleEl.textContent = page.title ?? "";
  renderPageLink(page.url);
  headerEl.hidden = !page.title && !page.url;
  statusEl.textContent = "";
  statusEl.hidden = true;

  const html = await marked.parse(page.content ?? "", { async: true });
  articleEl.innerHTML = html;
  renderImageDescriptions(articleEl);
  linkifyWikilinks(articleEl);
  void hydrateImages(page.id);
}

// ── wikilink navigation (in-place) ───────────────────────────────────────────
async function openByTitle(title: string, el: HTMLElement) {
  try {
    statusEl.hidden = false;
    statusEl.textContent = `Opening “${title}”…`;
    const resolved = await app.callServerTool({
      name: "resolve_page",
      arguments: { title },
    });
    const data = (resolved.structuredContent ?? {}) as any;
    const target = Array.isArray(data.items) ? data.items[0] : data;
    const pageId: string | undefined = target?.id ?? target?.pageId;
    if (!pageId) throw new Error("not found");

    const result = await app.callServerTool({
      name: "view_page",
      arguments: { pageId },
    });
    const page = result.structuredContent as PageData | undefined;
    if (!page?.id) throw new Error("no content");
    await renderPage(page);
  } catch {
    statusEl.hidden = true;
    el.classList.add("unresolvable");
    el.setAttribute("title", "Page could not be opened");
  }
}

articleEl.addEventListener("click", (event) => {
  const link = (event.target as HTMLElement).closest<HTMLElement>(".wikilink");
  if (link?.dataset.target && !link.classList.contains("unresolvable")) {
    void openByTitle(link.dataset.target, link);
  }
});

// ── host wiring ──────────────────────────────────────────────────────────────
app.ontoolresult = (params) => {
  if (params.isError) {
    statusEl.hidden = false;
    statusEl.textContent = "The page could not be loaded.";
    return;
  }
  const page = params.structuredContent as PageData | undefined;
  if (page && typeof page.id === "string") {
    void renderPage(page);
  }
};

await app.connect();
applyTheme((app.getHostContext() as any)?.theme);
