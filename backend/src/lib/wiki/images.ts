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
 * Return an image referenced by a wiki page as a `File` (name + mime type +
 * bytes). Throws "not found or access denied" style errors when the page is
 * not visible to the user, the filename is malformed, or the page does not
 * reference the file.
 */
export async function getWikiPageImage(
  tenantId: string,
  userId: string,
  pageId: string,
  filename: string
): Promise<File> {
  const match = FILENAME_PATTERN.exec(filename);
  if (!match) {
    throw new Error("Invalid image filename");
  }
  const fileId = match[1]!.toLowerCase();

  // Visibility check: throws when the page does not exist for this user.
  const page = await getKnowledgeTextById(pageId, { tenantId, userId });

  // Reference check: the page's content must actually embed this file.
  const referencedIds = extractKnowledgeFileIds(page.text ?? "");
  if (!referencedIds.includes(fileId)) {
    throw new Error("Image not found or access denied");
  }

  return getFileFromDb(filename, KNOWLEDGE_FILES_BUCKET, tenantId);
}
