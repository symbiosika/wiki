/**
 * Fetch a URL and turn it into markdown for the knowledge base — choosing the
 * right parser for the content that actually comes back.
 *
 * Why this exists:
 *   The URL-import job list often points at *download* links (e.g. WordPress
 *   Download Manager `?wpdmdl=` URLs) that stream a PDF, not an HTML page.
 *   Feeding raw PDF (or any binary) bytes into the HTML → Readability pipeline
 *   either crashes deep inside Readability with a cryptic
 *   "null is not an object (evaluating '<x>.tagName')" — because the misparsed
 *   byte soup has no <body> for Readability's ancestor walk to terminate on —
 *   or, worse, "succeeds" by importing megabytes of decoded binary noise.
 *
 * So we look at the response first:
 *   - PDF (by content-type, Content-Disposition filename, or the "%PDF-" magic
 *     bytes) → the framework's PDF parser, exactly like an uploaded PDF file.
 *   - HTML / XML / plain text → the framework's Readability-based converter.
 *   - anything else (images, zips, other binaries) → a clear, actionable error
 *     instead of a crash or garbage import.
 */
import { parseFile } from "@framework/lib/knowledge/parsing";
import { urlToMarkdown } from "@framework/lib/knowledge/parsing/url";
import { fetchWithSsrfGuard } from "@framework/lib/utils/url-guard";

const USER_AGENT =
  "Mozilla/5.0 (compatible; SymbiosikaKnowledgeBot/1.0; +https://symbiosika.de)";
const FETCH_TIMEOUT_MS = 30_000;

/** "%PDF-" — the leading bytes of every PDF file. */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

export type UrlImportContext = {
  tenantId: string;
  userId?: string;
  teamId?: string;
  workspaceId?: string;
};

export type ImportedUrlContent = {
  title: string;
  markdown: string;
};

const hasPdfMagic = (bytes: Uint8Array): boolean =>
  bytes.length >= PDF_MAGIC.length &&
  PDF_MAGIC.every((byte, i) => bytes[i] === byte);

const isPdf = (
  contentType: string,
  disposition: string,
  bytes: Uint8Array
): boolean => {
  if (contentType.includes("application/pdf")) return true;
  if (/filename\*?=\s*"?[^";]*\.pdf/i.test(disposition)) return true;
  return hasPdfMagic(bytes);
};

/**
 * A content-type we can hand to the HTML converter. Blank is allowed because
 * some servers omit it for plain HTML; genuine binaries are rejected above.
 */
const isTextual = (contentType: string): boolean =>
  contentType === "" ||
  contentType.includes("text/html") ||
  contentType.includes("application/xhtml") ||
  contentType.includes("application/xml") ||
  contentType.includes("+xml") ||
  contentType.includes("text/plain");

/** Best-effort human-readable name from a Content-Disposition header. */
const filenameFromDisposition = (disposition: string): string | null => {
  // RFC 5987 (filename*=UTF-8''...) first, then the plain filename=.
  const extended = /filename\*\s*=\s*[^']*''([^;]+)/i.exec(disposition);
  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      return extended[1].trim();
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
  return plain?.[1]?.trim() ?? null;
};

/** Last path segment of the URL, without query, as a fallback name. */
const filenameFromUrl = (url: string): string | null => {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    return segments.length > 0 ? decodeURIComponent(segments[segments.length - 1]!) : null;
  } catch {
    return null;
  }
};

/** Strip a trailing extension to derive a readable title from a filename. */
const titleFromFilename = (name: string): string =>
  name.replace(/\.[a-z0-9]+$/i, "").trim() || name;

/**
 * Fetch `url` and return its markdown representation, routed by content type.
 * Throws on fetch failure, unsupported binary content, or empty extraction —
 * callers record the thrown message as the per-URL error.
 */
export const importUrlContent = async (
  url: string,
  ctx: UrlImportContext
): Promise<ImportedUrlContent> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let contentType: string;
  let disposition: string;
  let bytes: Uint8Array;
  try {
    const response = await fetchWithSsrfGuard(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.9,*/*;q=0.8",
        "Accept-Language": "en;q=0.9,de;q=0.8",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `Failed to fetch URL ${url}: ${response.status} ${response.statusText}`
      );
    }
    contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    disposition = response.headers.get("content-disposition") ?? "";
    bytes = new Uint8Array(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }

  // --- PDF ---------------------------------------------------------------
  if (isPdf(contentType, disposition, bytes)) {
    const rawName =
      filenameFromDisposition(disposition) ?? filenameFromUrl(url) ?? "document";
    const fileName = /\.pdf$/i.test(rawName) ? rawName : `${rawName}.pdf`;
    const file = new File([bytes], fileName, { type: "application/pdf" });

    const parsed = await parseFile(file, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      teamId: ctx.teamId,
      workspaceId: ctx.workspaceId,
    });

    const markdown = (
      parsed.pages && parsed.pages.length > 0
        ? parsed.pages.map((page) => page.text).join("\n\n")
        : parsed.text
    ).trim();

    if (!markdown) {
      throw new Error(`PDF at ${url} produced no extractable text.`);
    }
    return { title: titleFromFilename(fileName), markdown };
  }

  // --- other binaries ----------------------------------------------------
  if (!isTextual(contentType)) {
    throw new Error(
      `Unsupported content type "${contentType}" for URL import ${url}. ` +
        `Only HTML pages and PDF files are supported.`
    );
  }

  // --- HTML / text -------------------------------------------------------
  // Delegate to the framework's Readability + Turndown converter (it re-fetches
  // the page; HTML documents are small, so the extra request is cheap and keeps
  // the HTML-conversion logic in a single place).
  const result = await urlToMarkdown(url, {
    userAgent: USER_AGENT,
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  return { title: result.title || url, markdown: result.markdown };
};
