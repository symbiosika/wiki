/**
 * Read access to the images embedded in wiki pages — scoped by PAGE
 * visibility instead of the generic `files:read` scope.
 *
 * Background: the block editor uploads images into the "knowledge" bucket
 * and embeds them as `/files/db/knowledge/<uuid>.<ext>`. That generic files
 * endpoint requires the `files:read` scope, which OAuth clients of the MCP
 * server (claude.ai & co) do not get. This module lets a caller fetch an
 * image with only `knowledge:read`, under two conditions enforced here:
 *
 *   1. the caller can see the page (same visibility rules as reading it), and
 *   2. the requested file is actually referenced by that page's content —
 *      so the endpoint cannot be used to enumerate the whole bucket.
 */
import { getKnowledgeTextById } from "@framework/lib/knowledge/knowledge-texts";
import {
  extractKnowledgeFileIds,
  KNOWLEDGE_FILES_BUCKET,
} from "@framework/lib/knowledge/knowledge-text-files";
import { getFileFromDb } from "@framework/lib/storage/db";

/** `<uuid>.<ext>` — the filename shape produced by the image upload. */
const FILENAME_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[a-z0-9]{1,8}$/i;

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

  // Reference check: the page's content must actually embed this file.
  const referencedIds = extractKnowledgeFileIds(page.text ?? "");
  if (!referencedIds.includes(fileId)) {
    throw new Error("Image not found or access denied");
  }

  return getFileFromDb(filename, KNOWLEDGE_FILES_BUCKET, tenantId);
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
