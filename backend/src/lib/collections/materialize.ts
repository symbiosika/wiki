/**
 * Mirror a collection into its page body as a markdown table.
 *
 * This is what makes a collection visible to everything the wiki already does:
 * full-text and hybrid search, the RAG index, the MCP read tools
 * (`get_page`, `read_page_content`, `search_wiki`) and the public docs view all
 * read `knowledge_text.text`. Rendering the table there means an agent finds
 * "Vereinsmitglieder" through ordinary wiki search, with no collection-specific
 * discovery code anywhere.
 *
 * Two deliberate decisions:
 *
 * 1. The page row is updated DIRECTLY instead of through
 *    `updateKnowledgeText()`. That function archives a history version on every
 *    call — correct for a human editing prose, ruinous for a table where every
 *    edited cell would mint a new version of the whole page. Row-level history
 *    belongs on the record, not on the page.
 *
 * 2. It is OPT-IN (`settings.materialize`). A collection may hold personal data
 *    — members, contacts — and mirroring pushes it into the embedding pipeline
 *    and, under a published parent page, onto the public site. Turning that on
 *    has to be a decision somebody made, not a default they never saw.
 *
 * When off, the body is left exactly as the user wrote it: prose above the
 * table stays prose, and the table simply is not in the text.
 */

import { getDb } from "@framework/lib/db/db-connection";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import { syncKnowledgeTextEmbeddingSafe } from "@framework/lib/knowledge/knowledge-text-embedding";
import log from "@framework/lib/log";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  collectionFields,
  collectionRecords,
  type CollectionFieldSelect,
  type CollectionRecordSelect,
  type CollectionSelect,
} from "../../db/schema";
import { formatValue } from "./values";

/**
 * Rows rendered into the page body. The mirror exists so an agent can find and
 * read the table, not so it can hold the whole dataset — a 5000-row markdown
 * table would blow up every prompt that retrieves the page. Beyond this the
 * body carries a pointer to the API instead.
 */
export const MATERIALIZE_ROW_LIMIT = 200;

/** Markers delimiting the generated block, so hand-written prose survives. */
const BEGIN_MARKER = "<!-- collection:begin -->";
const END_MARKER = "<!-- collection:end -->";

/** Escape a value for a markdown table cell. */
function escapeCell(value: string): string {
  return value
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    // strip HTML-comment delimiters: a cell containing the block markers
    // above would make mergeIntoBody/stripFromBody match inside the table
    // and corrupt the page body on the next render
    .replace(/<!--|-->/g, "")
    .trim();
}

/** Render the table (plus a header line) as markdown. */
export function renderCollectionMarkdown(
  fields: CollectionFieldSelect[],
  records: CollectionRecordSelect[],
  total: number,
): string {
  const visible = fields.filter((f) => !f.hidden);
  if (visible.length === 0) return "";

  const header = `| ${visible.map((f) => escapeCell(f.label)).join(" | ")} |`;
  const divider = `| ${visible.map(() => "---").join(" | ")} |`;
  const body = records.map(
    (record) =>
      `| ${visible
        .map((field) => escapeCell(formatValue(field, record.data[field.key])))
        .join(" | ")} |`,
  );

  const lines = [header, divider, ...body];
  if (total > records.length) {
    lines.push("");
    lines.push(
      `_${records.length} of ${total} entries shown. The full table is available through the collections API._`,
    );
  }
  return lines.join("\n");
}

/**
 * Replace the generated block inside a page body, keeping everything the user
 * wrote around it. A body without markers gets the block appended.
 */
export function mergeIntoBody(body: string, block: string): string {
  const wrapped = block
    ? `${BEGIN_MARKER}\n${block}\n${END_MARKER}`
    : `${BEGIN_MARKER}\n${END_MARKER}`;

  const start = body.indexOf(BEGIN_MARKER);
  const end = body.indexOf(END_MARKER);

  if (start !== -1 && end !== -1 && end > start) {
    const before = body.slice(0, start);
    const after = body.slice(end + END_MARKER.length);
    return `${before}${wrapped}${after}`;
  }

  const prefix = body.trim() ? `${body.trimEnd()}\n\n` : "";
  return `${prefix}${wrapped}\n`;
}

/** Strip the generated block — used when materialization is switched off. */
export function stripFromBody(body: string): string {
  const start = body.indexOf(BEGIN_MARKER);
  const end = body.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end < start) return body;
  return `${body.slice(0, start)}${body.slice(end + END_MARKER.length)}`.trimEnd();
}

/**
 * Re-render the page body for a collection.
 *
 * Returns the text that was written, or null when nothing had to change.
 * Never throws: a failed mirror must not fail the record write that triggered
 * it — the data is in the collection tables either way, and the next write
 * re-renders.
 */
export async function materializeCollection(
  collection: CollectionSelect,
): Promise<string | null> {
  try {
    const pages = await getDb()
      .select({ id: knowledgeText.id, text: knowledgeText.text })
      .from(knowledgeText)
      .where(
        and(
          eq(knowledgeText.id, collection.knowledgeTextId),
          eq(knowledgeText.tenantId, collection.tenantId),
        ),
      )
      .limit(1);
    const page = pages[0];
    if (!page) return null;

    let nextText: string;

    if (collection.settings?.materialize) {
      const fields = await getDb()
        .select()
        .from(collectionFields)
        .where(eq(collectionFields.collectionId, collection.id))
        .orderBy(asc(collectionFields.position));

      const records = await getDb()
        .select()
        .from(collectionRecords)
        .where(eq(collectionRecords.collectionId, collection.id))
        .orderBy(asc(collectionRecords.position))
        .limit(MATERIALIZE_ROW_LIMIT);

      const counted = await getDb()
        .select({ count: sql<number>`count(*)::int` })
        .from(collectionRecords)
        .where(eq(collectionRecords.collectionId, collection.id));

      const table = renderCollectionMarkdown(
        fields,
        records,
        counted[0]?.count ?? 0,
      );
      // Prefix the table with its own name when it has one. The page title is
      // already indexed; a differently-named table would otherwise be
      // unfindable by the name people actually use for it.
      const heading = collection.name ? escapeCell(collection.name) : "";
      nextText = mergeIntoBody(
        page.text,
        heading && table ? `### ${heading}\n\n${table}` : table,
      );
    } else {
      nextText = stripFromBody(page.text);
    }

    if (nextText === page.text) return null;

    await getDb()
      .update(knowledgeText)
      .set({
        text: nextText,
        // let the debounced summary sweeper pick the page up again
        summaryStale: true,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(knowledgeText.id, page.id));

    // keep the RAG mirror in step; a no-op when embedding is off for the tenant
    await syncKnowledgeTextEmbeddingSafe(page.id, collection.tenantId);

    return nextText;
  } catch (error) {
    log.error(`Collection materialization failed for ${collection.id}: ${error}`);
    return null;
  }
}

/**
 * Called after every schema or record write.
 *
 * Awaited rather than fired into the background: the write paths are already
 * request-scoped, the render is a bounded query, and letting it float would
 * mean a response could return before the page body reflects the change the
 * caller just made. Skipped entirely for non-materialized collections, which
 * is the default — so the common path costs one boolean check.
 */
export async function scheduleMaterialization(
  collection: CollectionSelect,
): Promise<void> {
  if (!collection.settings?.materialize) return;
  await materializeCollection(collection);
}
