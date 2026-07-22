/**
 * Browser entry of the MCP App "wiki image view" — renders one image (with
 * caption + fullscreen zoom) or a whole gallery, depending on how many image
 * references the tool result carries. Used by the `view_image` and
 * `view_page_images` tools; served as `ui://symbiosika-wiki/image-view.html`.
 *
 * Like the page view, the sandboxed iframe cannot reach the wiki directly:
 * every image is loaded through the `get_page_image` tool (base64 → data:
 * URI). Clicking an image opens an in-app lightbox and, where the host
 * allows it, requests fullscreen display for comfortable zooming.
 */
import { App } from "@modelcontextprotocol/ext-apps/app-with-deps";

type ImagesData = {
  pageId: string;
  title?: string;
  caption?: string;
  images?: string[];
};

const statusEl = document.getElementById("status")!;
const headEl = document.getElementById("head")!;
const contentEl = document.getElementById("content")!;
const lightboxEl = document.getElementById("lightbox")!;
const lightboxImg = lightboxEl.querySelector("img")!;
const lightboxCaption = lightboxEl.querySelector(".caption") as HTMLElement;
const lightboxClose = lightboxEl.querySelector(".close") as HTMLElement;

const app = new App(
  { name: "Symbiosika Wiki Image View", version: "1.0.0" },
  {},
  { autoResize: true },
);

function applyTheme(theme: string | undefined) {
  if (theme === "dark" || theme === "light") {
    document.documentElement.dataset.theme = theme;
  }
}
app.onhostcontextchanged = (ctx) => applyTheme((ctx as any)?.theme);

async function loadImage(
  pageId: string,
  ref: string,
): Promise<{ src: string } | null> {
  try {
    const result = await app.callServerTool({
      name: "get_page_image",
      arguments: { pageId, image: ref },
    });
    const block = (result.content ?? []).find(
      (c: any) => c.type === "image",
    ) as { data: string; mimeType: string } | undefined;
    return block
      ? { src: `data:${block.mimeType};base64,${block.data}` }
      : null;
  } catch {
    return null;
  }
}

// ── fullscreen-aware lightbox ────────────────────────────────────────────────
async function setDisplayMode(mode: "fullscreen" | "inline") {
  const ctx = app.getHostContext() as any;
  if (ctx?.availableDisplayModes?.includes(mode)) {
    try {
      await app.requestDisplayMode({ mode });
    } catch {
      /* inline lightbox still works without host fullscreen */
    }
  }
}

function openLightbox(src: string, caption: string) {
  lightboxImg.src = src;
  lightboxCaption.textContent = caption;
  lightboxEl.classList.add("open");
  void setDisplayMode("fullscreen");
}

function closeLightbox() {
  lightboxEl.classList.remove("open");
  void setDisplayMode("inline");
}
lightboxClose.addEventListener("click", closeLightbox);
lightboxEl.addEventListener("click", (e) => {
  if (e.target === lightboxEl) closeLightbox();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeLightbox();
});

// ── rendering ────────────────────────────────────────────────────────────────
function altOf(ref: string): string {
  return ref.split("/").pop() ?? "image";
}

async function renderSingle(data: ImagesData, ref: string) {
  const caption = data.caption || data.title || "";
  const loaded = await loadImage(data.pageId, ref);
  statusEl.hidden = true;
  if (!loaded) {
    statusEl.hidden = false;
    statusEl.textContent = "The image could not be loaded.";
    return;
  }
  const figure = document.createElement("figure");
  figure.className = "single";
  const img = document.createElement("img");
  img.src = loaded.src;
  img.alt = caption || altOf(ref);
  img.title = "Click to zoom";
  img.addEventListener("click", () => openLightbox(loaded.src, caption));
  figure.append(img);
  if (caption) {
    const fc = document.createElement("figcaption");
    fc.textContent = caption;
    figure.append(fc);
  }
  contentEl.replaceChildren(figure);
}

async function renderGallery(data: ImagesData, refs: string[]) {
  if (data.title) {
    headEl.hidden = false;
    headEl.innerHTML = "";
    const strong = document.createElement("strong");
    strong.textContent = data.title;
    headEl.append(strong, ` — ${refs.length} image(s)`);
  }
  const grid = document.createElement("div");
  grid.id = "grid";
  contentEl.replaceChildren(grid);
  statusEl.hidden = true;

  await Promise.allSettled(
    refs.map(async (ref) => {
      const tile = document.createElement("div");
      tile.className = "tile";
      grid.append(tile);
      const loaded = await loadImage(data.pageId, ref);
      if (!loaded) {
        tile.classList.add("broken");
        tile.textContent = `${altOf(ref)} (could not be loaded)`;
        return;
      }
      const img = document.createElement("img");
      img.src = loaded.src;
      img.alt = altOf(ref);
      tile.append(img);
      tile.addEventListener("click", () =>
        openLightbox(loaded.src, altOf(ref)),
      );
    }),
  );
}

app.ontoolresult = (params) => {
  if (params.isError) {
    statusEl.hidden = false;
    statusEl.textContent = "The image(s) could not be loaded.";
    return;
  }
  const data = params.structuredContent as ImagesData | undefined;
  const refs = data?.images ?? [];
  if (!data?.pageId || refs.length === 0) return;
  if (refs.length === 1) void renderSingle(data, refs[0]!);
  else void renderGallery(data, refs);
};

await app.connect();
applyTheme((app.getHostContext() as any)?.theme);
