/**
 * How many pages carry each page type.
 *
 * `pageType` is a controlled facet: a write is rejected when its value is not
 * in the organisation's `pageTypes` vocabulary. Removing or renaming an entry
 * in that vocabulary therefore leaves existing pages with a value that can no
 * longer be saved — an edit that looks harmless in a settings screen but breaks
 * pages elsewhere.
 *
 * This is what makes the admin editor honest: it can show "12 pages use this"
 * and refuse the destructive edit instead of letting an admin find out later.
 *
 * Lives in the app layer rather than the framework because it exists purely to
 * serve this app's page-type editor — the framework has no opinion on how a
 * client wants to guard a vocabulary edit.
 */
import { getDb } from "@framework/lib/db/db-connection";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import { and, count, eq, isNotNull } from "drizzle-orm";

/**
 * Count pages per page type across the whole organisation.
 *
 * Deliberately NOT scoped to what the calling user can see: the question being
 * answered is "what breaks if I remove this type", and a count that silently
 * omitted other people's personal pages would answer it wrongly. The value is
 * aggregate and non-identifying, and the route exposing it is admin-only.
 *
 * Page types with no pages are absent from the result rather than present with
 * a zero, so callers read a missing key as "unused".
 */
export const getPageTypeUsage = async (
  tenantId: string
): Promise<Record<string, number>> => {
  const rows = await getDb()
    .select({ pageType: knowledgeText.pageType, total: count() })
    .from(knowledgeText)
    .where(
      and(
        eq(knowledgeText.tenantId, tenantId),
        isNotNull(knowledgeText.pageType)
      )
    )
    .groupBy(knowledgeText.pageType);

  const usage: Record<string, number> = {};
  for (const row of rows) {
    // The isNotNull filter above already excludes untyped pages; the guard is
    // here so a null slipping through never becomes a "null" key.
    if (row.pageType) usage[row.pageType] = Number(row.total);
  }
  return usage;
};
