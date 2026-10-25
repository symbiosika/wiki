/**
 * Turning an upload into an artifact bundle — the checks every artifact passes
 * before a single byte is stored.
 *
 * An artifact is what claude.ai calls an artifact: a static web page, either a
 * single HTML file or an HTML page with supporting files (scripts, styles,
 * data, images) that it loads by RELATIVE path. Uploads arrive as
 *
 *   - a single `.html` file, which becomes `index.html`, or
 *   - a ZIP of the bundle, or
 *   - a list of `{ path, content }` (the MCP tool and the JSON API).
 *
 * All three end in `buildBundle`, which enforces the rules:
 *
 *   - paths are relative, normalised, without `..`, absolute or empty parts —
 *     they become URL paths under the artifact's serve prefix, so anything
 *     that could climb out of it is refused outright
 *   - only file types a web page actually loads are accepted (anything else is
 *     skipped with a warning, so a stray `.psd` does not fail the upload)
 *   - size and file-count limits, checked on the DECLARED sizes before a ZIP
 *     is inflated (zip-bomb guard) and again on the real bytes afterwards
 *   - one entry page: `index.html` at the root, else the only root `.html`
 *
 * Non-fatal findings become `warnings` that the UI shows after the upload:
 * absolute paths (`src="/app.js"`), which cannot resolve under the serve
 * prefix, and use of `window.claude`, the claude.ai runtime that does not
 * exist here.
 */
import { unzipSync } from "fflate";

/** Upper bound for the unpacked bundle (sum of all files). */
export const MAX_ARTIFACT_TOTAL_BYTES = 20 * 1024 * 1024;
/** Upper bound for the number of files in a bundle. */
export const MAX_ARTIFACT_FILES = 500;
/** Upper bound for one path inside the bundle. */
const MAX_PATH_LENGTH = 300;

/** Raised for an upload that cannot become an artifact — answered 400/413. */
export class ArtifactBundleError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 413 = 400
  ) {
    super(message);
    this.name = "ArtifactBundleError";
  }
}

/** Extension → content type of every file type a bundle may carry. */
const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
  pdf: "application/pdf",
  wasm: "application/wasm",
};

/** Content type for a bundle path, or null when the type is not allowed. */
export const artifactContentType = (path: string): string | null => {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  return CONTENT_TYPES[path.slice(dot + 1).toLowerCase()] ?? null;
};

/** Files a ZIP tool adds that never belong to the page. */
const isJunkPath = (path: string): boolean =>
  path.startsWith("__MACOSX/") ||
  path.split("/").some((part) => part === ".DS_Store" || part === "Thumbs.db");

/**
 * Normalise a bundle path, or throw when it could escape the bundle root.
 * `./a/b.js` → `a/b.js`; `/a.js`, `../a.js`, `a//b.js`, `a\b.js` are refused.
 */
export const normaliseArtifactPath = (raw: string): string => {
  if (raw.includes("\\")) {
    throw new ArtifactBundleError(`Invalid path "${raw}": use "/" separators`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) {
    throw new ArtifactBundleError("Invalid path: control characters");
  }
  const path = raw.replace(/^(\.\/)+/, "");
  if (!path || path.startsWith("/")) {
    throw new ArtifactBundleError(`Invalid path "${raw}": must be relative`);
  }
  if (path.length > MAX_PATH_LENGTH) {
    throw new ArtifactBundleError(`Invalid path "${raw.slice(0, 50)}…": too long`);
  }
  for (const part of path.split("/")) {
    if (part === "" || part === "." || part === "..") {
      throw new ArtifactBundleError(`Invalid path "${raw}"`);
    }
  }
  return path;
};

export type ArtifactFileInput = { path: string; data: Uint8Array };

export type ArtifactBundleFile = {
  path: string;
  contentType: string;
  data: Uint8Array;
};

export type ArtifactBundle = {
  files: ArtifactBundleFile[];
  entryPath: string;
  totalBytes: number;
  warnings: string[];
};

/** `src="/x"`, `href='/x'`, `action="/x"` — but not protocol-relative `//cdn…`. */
const ABSOLUTE_HTML_REF = /\b(?:src|href|action|poster)\s*=\s*["']\/(?!\/)/i;
/** `url(/x)` / `@import "/x"` in CSS. */
const ABSOLUTE_CSS_REF = /(?:url\(\s*["']?|@import\s+["'])\/(?!\/)/i;
/** The claude.ai artifact runtime (storage, "ask Claude", …). */
const CLAUDE_RUNTIME = /\bwindow\.claude\b/;

const decoder = new TextDecoder();

/**
 * When every file sits in one top-level folder (the usual "zip the folder"
 * result) and there is no root `index.html`, drop that folder.
 */
const stripCommonFolder = (files: ArtifactFileInput[]): ArtifactFileInput[] => {
  if (files.length === 0) return files;
  const first = files[0]!.path.split("/")[0]!;
  const allInside = files.every(
    (f) => f.path.includes("/") && f.path.split("/")[0] === first
  );
  if (!allInside) return files;
  return files.map((f) => ({ ...f, path: f.path.slice(first.length + 1) }));
};

/**
 * Validate and assemble a bundle from already-extracted files. Paths must
 * already be normalised (see `normaliseArtifactPath`).
 */
export const buildBundle = (input: ArtifactFileInput[]): ArtifactBundle => {
  const warnings: string[] = [];
  const files: ArtifactBundleFile[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;

  for (const file of stripCommonFolder(input.filter((f) => !isJunkPath(f.path)))) {
    const contentType = artifactContentType(file.path);
    if (!contentType) {
      warnings.push(`Skipped "${file.path}": file type not supported`);
      continue;
    }
    if (seen.has(file.path)) {
      throw new ArtifactBundleError(`Duplicate path "${file.path}"`);
    }
    seen.add(file.path);
    totalBytes += file.data.byteLength;
    files.push({ path: file.path, contentType, data: file.data });
  }

  if (files.length > MAX_ARTIFACT_FILES) {
    throw new ArtifactBundleError(
      `Too many files (${files.length}, at most ${MAX_ARTIFACT_FILES})`,
      413
    );
  }
  if (totalBytes > MAX_ARTIFACT_TOTAL_BYTES) {
    throw new ArtifactBundleError(
      `Artifact too large (at most ${MAX_ARTIFACT_TOTAL_BYTES / (1024 * 1024)} MB unpacked)`,
      413
    );
  }

  const rootHtml = files.filter(
    (f) => !f.path.includes("/") && /\.html?$/i.test(f.path)
  );
  const entry =
    rootHtml.find((f) => f.path.toLowerCase() === "index.html") ??
    (rootHtml.length === 1 ? rootHtml[0] : undefined);
  if (!entry) {
    throw new ArtifactBundleError(
      rootHtml.length === 0
        ? "No HTML page found: the bundle needs an index.html at its root"
        : "Several HTML pages at the root and no index.html: name the start page index.html"
    );
  }

  const absolute = new Set<string>();
  let usesClaudeRuntime = false;
  for (const file of files) {
    const isHtml = file.contentType.startsWith("text/html");
    const isCss = file.contentType.startsWith("text/css");
    const isJs = file.contentType.startsWith("text/javascript");
    if (!isHtml && !isCss && !isJs) continue;
    const text = decoder.decode(file.data);
    if (isHtml && ABSOLUTE_HTML_REF.test(text)) absolute.add(file.path);
    if ((isHtml || isCss) && ABSOLUTE_CSS_REF.test(text)) absolute.add(file.path);
    if ((isHtml || isJs) && CLAUDE_RUNTIME.test(text)) usesClaudeRuntime = true;
  }
  for (const path of absolute) {
    warnings.push(
      `"${path}" references files by absolute path ("/…"); those will not load — use relative paths`
    );
  }
  if (usesClaudeRuntime) {
    warnings.push(
      "The artifact uses window.claude (claude.ai runtime: storage, Claude calls, …), which is not available in the wiki"
    );
  }

  return { files, entryPath: entry.path, totalBytes, warnings };
};

/** Unpack a ZIP upload, refusing it before inflating when it is too large. */
export const extractZip = (zip: Uint8Array): ArtifactFileInput[] => {
  let declaredBytes = 0;
  let declaredFiles = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip, {
      filter: (file) => {
        if (file.name.endsWith("/")) return false; // directory entry
        declaredFiles += 1;
        declaredBytes += file.originalSize;
        if (declaredFiles > MAX_ARTIFACT_FILES * 2) {
          throw new ArtifactBundleError("Too many files in the ZIP", 413);
        }
        if (declaredBytes > MAX_ARTIFACT_TOTAL_BYTES * 2) {
          throw new ArtifactBundleError(
            `Artifact too large (at most ${MAX_ARTIFACT_TOTAL_BYTES / (1024 * 1024)} MB unpacked)`,
            413
          );
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof ArtifactBundleError) throw error;
    throw new ArtifactBundleError("The file is not a readable ZIP archive");
  }
  return Object.entries(entries).map(([name, data]) => ({
    path: normaliseArtifactPath(name),
    data,
  }));
};

/** ZIP local-file-header signature `PK\x03\x04`. */
const isZip = (bytes: Uint8Array): boolean =>
  bytes.length >= 4 &&
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  bytes[2] === 0x03 &&
  bytes[3] === 0x04;

/**
 * Bundle from an uploaded file: a ZIP (detected by its signature) or a single
 * HTML file, which becomes `index.html`.
 */
export const bundleFromUpload = (
  name: string,
  bytes: Uint8Array
): ArtifactBundle => {
  if (bytes.byteLength === 0) {
    throw new ArtifactBundleError("The file is empty");
  }
  if (isZip(bytes)) {
    return buildBundle(extractZip(bytes));
  }
  if (/\.html?$/i.test(name)) {
    return buildBundle([{ path: "index.html", data: bytes }]);
  }
  throw new ArtifactBundleError(
    "Upload a ZIP of the artifact or a single .html file"
  );
};

/** Bundle from `{ path, content, encoding }` entries (JSON API / MCP). */
export const bundleFromEntries = (
  entries: { path: string; content: string; encoding?: "utf8" | "base64" }[]
): ArtifactBundle => {
  if (entries.length === 0) {
    throw new ArtifactBundleError("No files given");
  }
  const encoder = new TextEncoder();
  return buildBundle(
    entries.map((entry) => ({
      path: normaliseArtifactPath(entry.path),
      data:
        entry.encoding === "base64"
          ? new Uint8Array(Buffer.from(entry.content, "base64"))
          : encoder.encode(entry.content),
    }))
  );
};
