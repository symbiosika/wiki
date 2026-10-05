/**
 * File attachments of a wiki page — what the editor's "download" block offers.
 *
 * A download is stored exactly like an image the editor uploads: in the
 * framework's "knowledge" bucket (db storage), with the short expiry of an
 * unreferenced upload. That is deliberate, because it makes the whole
 * lifecycle the framework already runs for page images apply to downloads
 * too, without a line of extra code:
 *
 *   - the block embeds the file as `…/files/db/knowledge/<uuid>.<ext>`, so the
 *     reference sync on every page save makes it permanent
 *     (`syncKnowledgeTextFileReferences`), and removing the block — or the
 *     page — gives it the grace-period expiry the weekly cleanup cron acts on
 *   - reading goes through the page-scoped routes (`./images.ts`): the caller
 *     must be able to see the page AND the page must reference the file, and
 *     the public site gets the same check against "published"
 *
 * Why not the framework's upload route: it accepts images only, up to 10 MB.
 * Why not the generic `/files/:type/:bucket` route: it is admin-only, and an
 * editor who may write the page must be able to attach a file to it.
 *
 * ## Size limit
 *
 * The knowledge bucket lives in Postgres (`bytea`), and the reference tracking
 * that keeps a page's files alive only recognises `/files/db/…` paths — so
 * "store it on S3" is not an option without a framework change. In Postgres a
 * file is held in memory as a whole on every upload and every download (the
 * driver encodes it into the query, the read loads the full row), and it is in
 * every database backup. 100 MB per file is technically possible (Bun accepts
 * request bodies up to 128 MB, bytea up to 1 GB) but a handful of parallel
 * downloads would cost the API container gigabytes of memory. 25 MB covers
 * the documents, slide decks and photos a wiki page carries; anything larger
 * belongs into a real file store and should be linked instead.
 *
 * ## Content type
 *
 * The bytes are served from the app's own origin, and the session is also a
 * cookie. A file whose type a browser would RENDER — html, svg, xml, script —
 * is therefore stored as `application/octet-stream`: opened through the
 * generic file route, it downloads instead of running in the app's origin.
 * The page-scoped download routes additionally always answer with
 * `Content-Disposition: attachment` and `nosniff`.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@framework/lib/db/db-connection";
import { files } from "@framework/lib/db/schema/files";
import { saveFileToDb } from "@framework/lib/storage/db";
import {
  KNOWLEDGE_FILES_BUCKET,
  UNREFERENCED_UPLOAD_TTL_HOURS,
} from "@framework/lib/knowledge/knowledge-text-files";
import {
  checkKnowledgeTextWritePermission,
  getKnowledgeTextById,
} from "@framework/lib/knowledge/knowledge-texts";

/** Largest file a download block may carry (see the module header). */
export const MAX_PAGE_FILE_SIZE_BYTES = 25 * 1024 * 1024;

/** Raised for a file that cannot be stored — the route answers 400/413. */
export class PageFileError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 413 = 400
  ) {
    super(message);
    this.name = "PageFileError";
  }
}

/**
 * Content types a browser renders or executes instead of downloading. Matched
 * on the start, so `text/html; charset=utf-8` is caught as well.
 */
const ACTIVE_CONTENT_TYPES = [
  "text/html",
  "application/xhtml",
  "image/svg",
  "text/xml",
  "application/xml",
  "text/javascript",
  "application/javascript",
  "application/ecmascript",
  "text/ecmascript",
];

/** The content type a page file is stored (and later served) with. */
export const safeStoredContentType = (type: string | undefined): string => {
  const normalized = (type ?? "").trim().toLowerCase();
  if (!normalized) return "application/octet-stream";
  return ACTIVE_CONTENT_TYPES.some((active) => normalized.startsWith(active))
    ? "application/octet-stream"
    : normalized;
};

/**
 * A file name that is safe to store and to put into a `Content-Disposition`
 * header: no path, no control characters, bounded length — but the extension
 * kept, because the stored path (`<uuid>.<ext>`) is derived from it.
 */
export const sanitizeFileName = (name: string | undefined): string => {
  const base = (name ?? "")
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f"]/g, "")
    .trim();
  if (!base) return "file";
  if (base.length <= 200) return base;
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 && base.length - dot <= 10 ? base.slice(dot) : "";
  return base.slice(0, 200 - ext.length) + ext;
};

export type UploadPageFileResult = {
  fileId: string;
  /** API path to embed in the page (`…/files/db/knowledge/<uuid>.<ext>`) */
  path: string;
  /** the file name as the reader sees it */
  name: string;
  /** bytes */
  size: number;
  /** the content type it is stored and served with */
  mimeType: string;
};

/**
 * Store a file for a page. The caller must be able to see AND write the page.
 * The upload expires on its own unless a following page save references it.
 */
export async function uploadWikiPageFile(
  pageId: string,
  file: File,
  context: { tenantId: string; userId: string }
): Promise<UploadPageFileResult> {
  const page = await getKnowledgeTextById(pageId, context);
  await checkKnowledgeTextWritePermission(page, context);

  if (file.size === 0) {
    throw new PageFileError("The file is empty");
  }
  if (file.size > MAX_PAGE_FILE_SIZE_BYTES) {
    throw new PageFileError(
      `File exceeds the maximum size of ${MAX_PAGE_FILE_SIZE_BYTES / (1024 * 1024)} MB`,
      413
    );
  }

  const name = sanitizeFileName(file.name);
  const mimeType = safeStoredContentType(file.type);
  const stored = new File([file], name, { type: mimeType });

  const saved = await saveFileToDb(
    stored,
    KNOWLEDGE_FILES_BUCKET,
    context.tenantId
  );

  // unreferenced uploads clean themselves up — same rule as editor images
  await getDb()
    .update(files)
    .set({
      expiresAt: new Date(
        Date.now() + UNREFERENCED_UPLOAD_TTL_HOURS * 60 * 60 * 1000
      ).toISOString(),
    })
    .where(eq(files.id, saved.id));

  return {
    fileId: saved.id,
    path: saved.path,
    name,
    size: file.size,
    mimeType,
  };
}

/**
 * `Content-Disposition: attachment` with the original file name — ASCII
 * fallback plus the RFC 5987 form, so umlauts survive in every browser.
 */
export const attachmentDisposition = (name: string): string => {
  const safe = sanitizeFileName(name);
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_").replace(/[\\"]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
};

/** The response headers every page-file download is served with. */
export const downloadHeaders = (
  file: File,
  byteLength: number
): Record<string, string> => ({
  "Content-Type": safeStoredContentType(file.type),
  "Content-Length": byteLength.toString(),
  "Content-Disposition": attachmentDisposition(file.name),
  "X-Content-Type-Options": "nosniff",
});
