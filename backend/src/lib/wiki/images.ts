/**
 * Read access to the images embedded in wiki pages — scoped by PAGE
 * visibility instead of the generic `files:read` scope.
 *
 * Background: page images are embedded as `/files/db/<bucket>/<uuid>.<ext>`.
 * That generic files endpoint requires the `files:read` scope, which OAuth
 * clients of the MCP server (claude.ai & co) do not get. This module lets a
 * caller fetch an image with only `knowledge:read`, under two conditions
 * enforced here:
 *
 *   1. the caller can see the page (same visibility rules as reading it), and
 *   2. the requested file is actually referenced by that page's content —
 *      so the endpoint cannot be used to enumerate a whole bucket.
 *
 * A page's images do not all live in the same bucket, and that is why this
 * module resolves the bucket from the page instead of assuming one:
 *
 *   - "knowledge": images uploaded through the block editor
 *     (`uploadKnowledgeTextImage`).
 *   - "images": images a parsing service extracted from an imported document
 *     (PDF import / URL import — see framework `parsing/pdf/images.ts`, which
 *     stores them with `saveFile(file, "images", …)`). Pages created by an
 *     import reference these, and reading them used to fail with a 404 that
 *     looked like "the page does not reference this file".
 *
 * Only these two buckets are readable through a page: they are the ones a
 * page's own content is built from. Everything else (chat attachments,
 * avatars, …) stays behind `files:read`.
 */
import { getKnowledgeTextById } from "@framework/lib/knowledge/knowledge-texts";
import { KNOWLEDGE_FILES_BUCKET } from "@framework/lib/knowledge/knowledge-text-files";
import { getFileFromDb } from "@framework/lib/storage/db";

/** Bucket the document parsers store extracted images in. */
export const PARSED_IMAGES_BUCKET = "images";

/** Buckets an image may be read from when a page references it. */
export const PAGE_IMAGE_BUCKETS = [
  KNOWLEDGE_FILES_BUCKET,
  PARSED_IMAGES_BUCKET,
] as const;

/** `<uuid>.<ext>` — the filename shape produced by the image upload. */
const FILENAME_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[a-z0-9]{1,8}$/i;

/**
 * `/files/db/<bucket>/<uuid>` for the buckets above, in markdown and html
 * alike. The bucket is captured: it is what the file is then looked up in, so
 * a reference can never reach outside the buckets listed here.
 */
const IMAGE_REFERENCE_PATTERN = new RegExp(
  `/files/db/(${PAGE_IMAGE_BUCKETS.join("|")})/` +
    "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})",
  "gi"
);

/**
 * Map every image a page's content references to the bucket it is referenced
 * from (`<file id>` → `<bucket>`).
 */
export const extractPageImageReferences = (
  content: string
): Map<string, string> => {
  const refs = new Map<string, string>();
  for (const match of content.matchAll(IMAGE_REFERENCE_PATTERN)) {
    refs.set(match[2]!.toLowerCase(), match[1]!.toLowerCase());
  }
  return refs;
};

/**
 * The filename + reference half of an image read, shared by the authenticated
 * and the public entry points below.
 *
 * The caller supplies `loadPage`, which performs the VISIBILITY half — the only
 * thing that differs between the two. Passing it as a callback (rather than
 * passing an already-loaded page) keeps the original order of checks: a
 * malformed filename is rejected before any page lookup happens, so neither
 * variant can be used to probe page existence with a junk filename.
 *
 * Both checks here are load-bearing. `getFileFromDb` scopes only by bucket +
 * tenant, so the reference check is what stops a single readable page from
 * becoming a read primitive for the whole tenant bucket.
 */
async function loadReferencedImage(
  tenantId: string,
  filename: string,
  loadPage: () => Promise<{ text: string | null }>
): Promise<File> {
  const match = FILENAME_PATTERN.exec(filename);
  if (!match) {
    throw new Error("Invalid image filename");
  }
  const fileId = match[1]!.toLowerCase();

  // Visibility check: throws when the page is not readable in this context.
  const page = await loadPage();

  // Reference check: the page's content must actually embed this file. The
  // bucket comes from that same reference, so an image is only ever read from
  // where the page itself points.
  const bucket = extractPageImageReferences(page.text ?? "").get(fileId);
  if (!bucket) {
    throw new Error("Image not found or access denied");
  }

  return getFileFromDb(filename, bucket, tenantId);
}

/**
 * Return an image referenced by a wiki page as a `File` (name + mime type +
 * bytes). Throws "not found or access denied" style errors when the page is
 * not visible to the user, the filename is malformed, or the page does not
 * reference the file.
 *
 * This is the endpoint the MCP server fetches page images through
 * (`/tenant/:tenantId/wiki/:pageId/images/:filename` with a bearer token) —
 * its signature and its behaviour are part of that contract.
 */
export async function getWikiPageImage(
  tenantId: string,
  userId: string,
  pageId: string,
  filename: string
): Promise<File> {
  return loadReferencedImage(tenantId, filename, () =>
    getKnowledgeTextById(pageId, { tenantId, userId })
  );
}

/**
 * The same read for an anonymous caller: identical filename and reference
 * checks, but the page must be PUBLISHED rather than visible to a user.
 *
 * Sharing `loadReferencedImage` with the authenticated variant is deliberate —
 * the reference check is the guard against bucket enumeration, and a second
 * copy of it is exactly the kind of code where one side gets fixed later and
 * the other does not.
 */
export async function getPublicWikiPageImage(
  tenantId: string,
  pageId: string,
  filename: string
): Promise<File> {
  return loadReferencedImage(tenantId, filename, () =>
    getKnowledgeTextById(pageId, { tenantId, publicOnly: true })
  );
}
