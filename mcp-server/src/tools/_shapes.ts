/**
 * Response shaping for context economy.
 *
 * The app API returns full DB rows (every column except `text` for list-type
 * responses). Most of that is internal bookkeeping an LLM client never needs
 * (summary generation state, embedding wiring, audit uuids, …) but it costs
 * context window on every call. The helpers here reduce rows to what an agent
 * acts on, and drop null/empty fields entirely so quiet pages stay cheap.
 */

type Row = Record<string, unknown>;

/** Remove null/undefined entries so unset fields cost no context. */
export const stripEmpty = (row: Row): Row => {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) continue;
    out[key] = value;
  }
  return out;
};

/**
 * Derive the human meaning of the access fields: a page is either in a team,
 * organisation-wide, or personal.
 */
const scopeOf = (row: Row): "team" | "organisation" | "personal" =>
  row.teamId ? "team" : row.tenantWide ? "organisation" : "personal";

/**
 * Compact reference for list-type responses (tree/list/recent/resolve/batch):
 * identity, place in the tree, scope, the summary "docstring" and the curation
 * facets. Everything else (audit uuids, summary/embedding bookkeeping, meta)
 * is available via `get_page_metadata`.
 */
export const slimPageRow = (data: unknown): Row => {
  const row = (data ?? {}) as Row;
  return stripEmpty({
    id: row.id,
    title: row.title,
    parentId: row.parentId,
    scope: scopeOf(row),
    teamId: row.teamId,
    summary: row.summary,
    pageType: row.pageType,
    status: row.status,
    validUntil: row.validUntil,
    supersedesId: row.supersedesId,
    updatedAt: row.updatedAt,
  });
};

export const slimPageRows = (data: unknown): Row[] =>
  Array.isArray(data) ? data.map(slimPageRow) : [];

/**
 * Full metadata view of a page: the complete row minus the (potentially huge)
 * body text and minus purely internal wiring (embedding link, summary
 * generation state). This is the explicit "give me the metadata" answer.
 */
export const pageMetadata = (data: unknown): Row => {
  const {
    text,
    knowledgeEntryId,
    summaryStale,
    summaryContentHash,
    summaryModel,
    deletedAt,
    ...rest
  } = (data ?? {}) as Row;
  return stripEmpty({
    ...rest,
    scope: scopeOf(rest),
    contentChars: typeof text === "string" ? text.length : undefined,
  });
};

/**
 * History list entries are full snapshots (text + blocks). For the overview
 * only the "who changed what when" matters; a specific version can be loaded
 * in full via `get_page_version`.
 */
export const slimHistoryRows = (data: unknown): Row[] =>
  Array.isArray(data)
    ? data.map((entry) => {
        const row = (entry ?? {}) as Row;
        return stripEmpty({
          versionId: row.id,
          title: row.title,
          contentChars:
            typeof row.text === "string" ? row.text.length : undefined,
          updatedBy: row.updatedBy,
          versionUpdatedAt: row.versionUpdatedAt,
          supersededAt: row.createdAt,
        });
      })
    : [];

/** A single history version in full, without the internal block snapshot. */
export const pageVersion = (data: unknown): Row => {
  const row = (data ?? {}) as Row;
  return stripEmpty({
    versionId: row.id,
    pageId: row.knowledgeTextId,
    title: row.title,
    content: row.text,
    updatedBy: row.updatedBy,
    versionUpdatedAt: row.versionUpdatedAt,
    supersededAt: row.createdAt,
  });
};

/** Overview: slim the embedded page lists, keep metrics/instructions as-is. */
export const slimOverview = (data: unknown): Row => {
  const row = (data ?? {}) as Row;
  return {
    ...row,
    topLevel: slimPageRows(row.topLevel),
    recentChanges: slimPageRows(row.recentChanges),
  };
};

/** Batch read: slim rows, but surface the body as `content` when present. */
export const slimBatchRows = (data: unknown): Row[] =>
  Array.isArray(data)
    ? data.map((entry) => {
        const row = (entry ?? {}) as Row;
        const slim = slimPageRow(row);
        if (typeof row.text === "string") slim.content = row.text;
        return slim;
      })
    : [];
