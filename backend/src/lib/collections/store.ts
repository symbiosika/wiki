/**
 * Collections: CRUD for the collection itself, its fields and its records.
 *
 * PERMISSIONS. A collection has no access rules of its own — it inherits them
 * from the wiki page it hangs on. Every entry point here resolves the anchor
 * page first:
 *
 *   - reads  → `getKnowledgeTextById(pageId, { tenantId, userId })`, which
 *     applies the personal / team / organisation visibility filter in SQL and
 *     throws when the page is not visible
 *   - writes → additionally `checkKnowledgeTextWritePermission(page, ctx)`
 *
 * That is the whole authorization story, and it is why a collection is anchored
 * to a page in the first place. Nothing below re-implements a rule; if a user
 * cannot see the page, the collection does not exist for them.
 *
 * The page also owns the collection's *name*: `knowledgeText.title`. It is
 * returned on reads for convenience but never written here — renaming happens
 * in the normal page UI.
 */

import { getDb } from "@framework/lib/db/db-connection";
import {
  getKnowledgeTextById,
  checkKnowledgeTextWritePermission,
} from "@framework/lib/knowledge/knowledge-texts";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  collections,
  collectionFields,
  collectionRecords,
  COLLECTION_FIELD_TYPES,
  type CollectionFieldSelect,
  type CollectionFieldType,
  type CollectionRecordSelect,
  type CollectionSelect,
  type CollectionSettings,
  type CollectionFieldOptions,
} from "../../db/schema";
import { validateRecordData, CollectionValueError } from "./values";
import {
  materializeCollection,
  scheduleMaterialization,
} from "./materialize";

export { CollectionValueError };

/** Raised when a collection / field / record does not exist for this tenant. */
export class CollectionNotFoundError extends Error {
  constructor(message = "Collection not found") {
    super(message);
    this.name = "CollectionNotFoundError";
  }
}

export interface CollectionContext {
  tenantId: string;
  userId: string;
}

/**
 * A collection plus its schema and both names.
 *
 * `name` is the table's own name and may be null; `pageTitle` is the anchor
 * page's title; `displayName` is what a UI or an agent should show. Callers get
 * all three rather than one merged field so that "no name set" stays visible —
 * the settings dialog has to be able to show an empty input, not the page title
 * pre-filled as if someone had typed it.
 */
export interface CollectionWithFields extends CollectionSelect {
  pageTitle: string;
  displayName: string;
  fields: CollectionFieldSelect[];
}

/** The name to show for a collection: its own, else the page's title. */
export function resolveDisplayName(
  name: string | null,
  pageTitle: string,
): string {
  const own = name?.trim();
  return own && own.length > 0 ? own : pageTitle;
}

/**
 * Upper bound on records returned in one listing. Collections are meant for
 * hundreds to a few thousand rows; the cap keeps a runaway table from turning
 * a page load into a multi-megabyte response, and the UI surfaces it rather
 * than silently truncating.
 */
export const MAX_RECORDS_PER_REQUEST = 5000;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Turn a label into a stable jsonb key: lowercase ascii, underscores, unique
 * within the collection. Keys never change after creation — renaming a column
 * only touches `label`, so no record has to be rewritten.
 */
export function slugifyFieldKey(label: string, taken: string[]): string {
  const base =
    label
      // NFC first so a decomposed "a"+combining diaeresis becomes "ä" before
      // the transliteration below — NFKD would decompose the umlauts past it
      .normalize("NFC")
      .toLowerCase()
      // transliterate the German umlauts people will actually type
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "field";

  // "id" is the record's own id in flattened record shapes (the MCP tools
  // return rows as `{ id, ...data }`) — a data key must never shadow it
  if (base !== "id" && !taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** Resolve the anchor page, enforcing read access. Throws when not visible. */
async function readablePage(pageId: string, ctx: CollectionContext) {
  return await getKnowledgeTextById(pageId, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
  });
}

/** Resolve the anchor page, enforcing write access. */
async function writablePage(pageId: string, ctx: CollectionContext) {
  const page = await readablePage(pageId, ctx);
  await checkKnowledgeTextWritePermission(page, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
  });
  return page;
}

/** Load a collection row by id, scoped to the tenant. */
async function loadCollection(
  collectionId: string,
  tenantId: string,
): Promise<CollectionSelect> {
  const rows = await getDb()
    .select()
    .from(collections)
    .where(
      and(eq(collections.id, collectionId), eq(collections.tenantId, tenantId)),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new CollectionNotFoundError();
  return row;
}

/**
 * Load a collection and check the caller may read it.
 * Every read entry point funnels through here.
 */
async function loadReadable(
  collectionId: string,
  ctx: CollectionContext,
): Promise<{ collection: CollectionSelect; pageTitle: string }> {
  const collection = await loadCollection(collectionId, ctx.tenantId);
  const page = await readablePage(collection.knowledgeTextId, ctx);
  return { collection, pageTitle: page.title };
}

/** Load a collection and check the caller may write it. */
async function loadWritable(
  collectionId: string,
  ctx: CollectionContext,
): Promise<CollectionSelect> {
  const collection = await loadCollection(collectionId, ctx.tenantId);
  await writablePage(collection.knowledgeTextId, ctx);
  return collection;
}

async function loadFields(
  collectionId: string,
): Promise<CollectionFieldSelect[]> {
  return await getDb()
    .select()
    .from(collectionFields)
    .where(eq(collectionFields.collectionId, collectionId))
    .orderBy(asc(collectionFields.position), asc(collectionFields.createdAt));
}

// ---------------------------------------------------------------------------
// collections
// ---------------------------------------------------------------------------

/**
 * List every collection the caller can see, newest first.
 *
 * Implemented as one query for the collections plus one visibility-filtered
 * read per anchor page. Only pages the user may see survive, which is also how
 * the wiki tree learns which pages are collections. Tenants have tens of
 * collections, not thousands, so the per-page read is not worth optimising away
 * into a hand-written visibility join that would then have to be kept in sync
 * with the framework's rule.
 */
export async function listCollections(
  ctx: CollectionContext,
): Promise<Array<CollectionSelect & { pageTitle: string; displayName: string }>> {
  const rows = await getDb()
    .select()
    .from(collections)
    .where(eq(collections.tenantId, ctx.tenantId))
    .orderBy(asc(collections.createdAt));

  const visible: Array<
    CollectionSelect & { pageTitle: string; displayName: string }
  > = [];
  for (const row of rows) {
    try {
      const page = await readablePage(row.knowledgeTextId, ctx);
      visible.push({
        ...row,
        pageTitle: page.title,
        displayName: resolveDisplayName(row.name, page.title),
      });
    } catch {
      // not visible for this user — omit it, exactly like a hidden page
    }
  }
  return visible;
}

/** Get one collection with its fields. */
export async function getCollection(
  collectionId: string,
  ctx: CollectionContext,
): Promise<CollectionWithFields> {
  const { collection, pageTitle } = await loadReadable(collectionId, ctx);
  return {
    ...collection,
    pageTitle,
    displayName: resolveDisplayName(collection.name, pageTitle),
    fields: await loadFields(collection.id),
  };
}

/** Get the collection anchored to a page, or null when the page has none. */
export async function getCollectionByPageId(
  pageId: string,
  ctx: CollectionContext,
): Promise<CollectionWithFields | null> {
  const page = await readablePage(pageId, ctx);
  const rows = await getDb()
    .select()
    .from(collections)
    .where(
      and(
        eq(collections.knowledgeTextId, pageId),
        eq(collections.tenantId, ctx.tenantId),
      ),
    )
    .limit(1);
  const collection = rows[0];
  if (!collection) return null;
  return {
    ...collection,
    pageTitle: page.title,
    displayName: resolveDisplayName(collection.name, page.title),
    fields: await loadFields(collection.id),
  };
}

export interface CreateCollectionInput {
  /** the wiki page that becomes this collection */
  knowledgeTextId: string;
  /** optional own name; falls back to the page title */
  name?: string | null;
  description?: string | null;
  settings?: CollectionSettingsPatch;
  fields?: CreateFieldInput[];
}

/**
 * Turn an existing wiki page into a collection.
 *
 * Requires write permission on the page, so a user can only do this to a page
 * they could already edit. A page can carry at most one collection (enforced by
 * the unique index on knowledge_text_id).
 */
export async function createCollection(
  input: CreateCollectionInput,
  ctx: CollectionContext,
): Promise<CollectionWithFields> {
  const page = await writablePage(input.knowledgeTextId, ctx);

  const existing = await getDb()
    .select({ id: collections.id })
    .from(collections)
    .where(eq(collections.knowledgeTextId, input.knowledgeTextId))
    .limit(1);
  if (existing[0]) {
    throw new CollectionValueError(
      "This page already has a collection",
      "knowledgeTextId",
    );
  }

  const inserted = await getDb()
    .insert(collections)
    .values({
      tenantId: ctx.tenantId,
      knowledgeTextId: input.knowledgeTextId,
      name: input.name?.trim() || null,
      description: input.description ?? null,
      settings: input.settings ? mergeSettings({}, input.settings) : {},
      createdBy: ctx.userId,
    })
    .returning();
  const collection = inserted[0]!;

  for (const field of input.fields ?? []) {
    await addFieldUnchecked(collection, field);
  }

  return {
    ...collection,
    pageTitle: page.title,
    displayName: resolveDisplayName(collection.name, page.title),
    fields: await loadFields(collection.id),
  };
}

/**
 * Settings a caller may send: any key may also be null, which DELETES it —
 * the merge below keeps keys the patch does not mention, so JSON (which
 * cannot express undefined) needs an explicit way to clear one.
 */
export type CollectionSettingsPatch = {
  [K in keyof CollectionSettings]?: CollectionSettings[K] | null;
};

function mergeSettings(
  current: CollectionSettings,
  patch: CollectionSettingsPatch,
): CollectionSettings {
  const next: Record<string, unknown> = { ...current, ...patch };
  for (const key of Object.keys(next)) {
    if (next[key] === null) delete next[key];
  }
  return next as CollectionSettings;
}

export async function updateCollection(
  collectionId: string,
  patch: {
    name?: string | null;
    description?: string | null;
    settings?: CollectionSettingsPatch;
  },
  ctx: CollectionContext,
): Promise<CollectionWithFields> {
  const collection = await loadWritable(collectionId, ctx);

  const updated = await getDb()
    .update(collections)
    .set({
      // an empty name clears it and falls back to the page title again
      ...(patch.name !== undefined ? { name: patch.name?.trim() || null } : {}),
      ...(patch.description !== undefined
        ? { description: patch.description }
        : {}),
      ...(patch.settings !== undefined
        ? { settings: mergeSettings(collection.settings, patch.settings) }
        : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(collections.id, collectionId))
    .returning();

  const row = updated[0]!;
  // materializeCollection, not scheduleMaterialization: switching the setting
  // OFF has to strip the generated block, and the scheduler skips
  // non-materialized collections by design.
  await materializeCollection(row);
  return await getCollection(row.id, ctx);
}

/**
 * Delete the collection and all its data — the anchor page itself stays and
 * becomes a normal page again.
 */
export async function deleteCollection(
  collectionId: string,
  ctx: CollectionContext,
): Promise<void> {
  await loadWritable(collectionId, ctx);
  await getDb().delete(collections).where(eq(collections.id, collectionId));
}

// ---------------------------------------------------------------------------
// fields
// ---------------------------------------------------------------------------

export interface CreateFieldInput {
  label: string;
  type: CollectionFieldType;
  options?: CollectionFieldOptions;
  required?: boolean;
  hidden?: boolean;
}

function assertValidType(type: string): asserts type is CollectionFieldType {
  if (!COLLECTION_FIELD_TYPES.includes(type as CollectionFieldType)) {
    throw new CollectionValueError(`Unknown field type "${type}"`, "type");
  }
}

/**
 * Reject a select/multiSelect without choices: it would render an empty picker
 * and make every write fail with "not an option", which reads like a bug.
 */
function assertUsableOptions(
  type: CollectionFieldType,
  options: CollectionFieldOptions | undefined,
): void {
  if (type !== "select" && type !== "multiSelect") return;
  const choices = options?.choices ?? [];
  if (choices.length === 0) {
    throw new CollectionValueError(
      "A select field needs at least one option",
      "options",
    );
  }
  const values = choices.map((c) => c.value);
  if (values.some((v) => !v || !v.trim())) {
    throw new CollectionValueError("Options cannot be empty", "options");
  }
  if (new Set(values).size !== values.length) {
    throw new CollectionValueError("Options must be unique", "options");
  }
}

/** Insert a field; caller has already verified write permission. */
async function addFieldUnchecked(
  collection: CollectionSelect,
  input: CreateFieldInput,
): Promise<CollectionFieldSelect> {
  assertValidType(input.type);
  assertUsableOptions(input.type, input.options);

  const label = input.label?.trim();
  if (!label) {
    throw new CollectionValueError("A column needs a name", "label");
  }

  const existing = await loadFields(collection.id);
  const key = slugifyFieldKey(
    label,
    existing.map((f) => f.key),
  );
  const position = existing.length
    ? Math.max(...existing.map((f) => f.position)) + 1
    : 0;

  const inserted = await getDb()
    .insert(collectionFields)
    .values({
      collectionId: collection.id,
      tenantId: collection.tenantId,
      key,
      label,
      type: input.type,
      options: input.options ?? {},
      required: input.required ?? false,
      hidden: input.hidden ?? false,
      position,
    })
    .returning();
  return inserted[0]!;
}

export async function addField(
  collectionId: string,
  input: CreateFieldInput,
  ctx: CollectionContext,
): Promise<CollectionFieldSelect> {
  const collection = await loadWritable(collectionId, ctx);
  const field = await addFieldUnchecked(collection, input);
  await scheduleMaterialization(collection);
  return field;
}

export interface UpdateFieldInput {
  label?: string;
  options?: CollectionFieldOptions;
  required?: boolean;
  hidden?: boolean;
  type?: CollectionFieldType;
}

/**
 * Update a column.
 *
 * The `key` is intentionally not updatable: it is the jsonb key of every
 * existing record. Changing the `type` is allowed — existing values are left
 * untouched and re-validated the next time a record is written, which keeps a
 * retype from rewriting (or losing) data the user has not looked at yet.
 */
export async function updateField(
  collectionId: string,
  fieldId: string,
  patch: UpdateFieldInput,
  ctx: CollectionContext,
): Promise<CollectionFieldSelect> {
  const collection = await loadWritable(collectionId, ctx);

  const current = await getDb()
    .select()
    .from(collectionFields)
    .where(
      and(
        eq(collectionFields.id, fieldId),
        eq(collectionFields.collectionId, collectionId),
      ),
    )
    .limit(1);
  const field = current[0];
  if (!field) throw new CollectionNotFoundError("Field not found");

  const nextType = patch.type ?? (field.type as CollectionFieldType);
  if (patch.type) assertValidType(patch.type);
  if (patch.options !== undefined || patch.type !== undefined) {
    assertUsableOptions(nextType, patch.options ?? field.options);
  }
  if (patch.label !== undefined && !patch.label.trim()) {
    throw new CollectionValueError("A column needs a name", "label");
  }

  const updated = await getDb()
    .update(collectionFields)
    .set({
      ...(patch.label !== undefined ? { label: patch.label.trim() } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.options !== undefined ? { options: patch.options } : {}),
      ...(patch.required !== undefined ? { required: patch.required } : {}),
      ...(patch.hidden !== undefined ? { hidden: patch.hidden } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(collectionFields.id, fieldId))
    .returning();

  await scheduleMaterialization(collection);
  return updated[0]!;
}

/**
 * Delete a column.
 *
 * The values are removed from every record in the same statement — leaving them
 * in the jsonb would resurrect old data if a column of the same key were ever
 * created again.
 */
export async function deleteField(
  collectionId: string,
  fieldId: string,
  ctx: CollectionContext,
): Promise<void> {
  const collection = await loadWritable(collectionId, ctx);

  const rows = await getDb()
    .select()
    .from(collectionFields)
    .where(
      and(
        eq(collectionFields.id, fieldId),
        eq(collectionFields.collectionId, collectionId),
      ),
    )
    .limit(1);
  const field = rows[0];
  if (!field) throw new CollectionNotFoundError("Field not found");

  await getDb().delete(collectionFields).where(eq(collectionFields.id, fieldId));

  await getDb()
    .update(collectionRecords)
    .set({ data: sql`${collectionRecords.data} - ${field.key}` })
    .where(eq(collectionRecords.collectionId, collectionId));

  // a deleted column may have been the record label or the sort key
  const settings = collection.settings ?? {};
  const patched: CollectionSettings = { ...settings };
  if (settings.titleFieldKey === field.key) delete patched.titleFieldKey;
  if (settings.defaultSort?.key === field.key) delete patched.defaultSort;
  if (JSON.stringify(patched) !== JSON.stringify(settings)) {
    await getDb()
      .update(collections)
      .set({ settings: patched, updatedAt: new Date().toISOString() })
      .where(eq(collections.id, collectionId));
  }

  await scheduleMaterialization(collection);
}

/** Apply a new column order. Ids not listed keep their relative order after. */
export async function reorderFields(
  collectionId: string,
  fieldIds: string[],
  ctx: CollectionContext,
): Promise<CollectionFieldSelect[]> {
  const collection = await loadWritable(collectionId, ctx);
  const fields = await loadFields(collectionId);
  const known = new Set(fields.map((f) => f.id));

  const ordered = [
    ...fieldIds.filter((id) => known.has(id)),
    ...fields.filter((f) => !fieldIds.includes(f.id)).map((f) => f.id),
  ];

  for (let i = 0; i < ordered.length; i++) {
    await getDb()
      .update(collectionFields)
      .set({ position: i, updatedAt: new Date().toISOString() })
      .where(eq(collectionFields.id, ordered[i]!));
  }

  await scheduleMaterialization(collection);
  return await loadFields(collectionId);
}

// ---------------------------------------------------------------------------
// records
// ---------------------------------------------------------------------------

export interface ListRecordsOptions {
  /** case-insensitive substring match across all field values */
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ListRecordsResult {
  records: CollectionRecordSelect[];
  /** total matching the filter, before limit/offset */
  total: number;
  /** true when rows beyond this page exist (limit/offset cut the list off) */
  truncated: boolean;
}

/**
 * List records of a collection.
 *
 * Search is applied in SQL over the jsonb document as text. That is a
 * sequential scan, and deliberately so: it is one predicate that works for
 * every field type without a per-type index, and at the few-thousand-row scale
 * a collection is meant for it is far below the latency a user can notice.
 */
export async function listRecords(
  collectionId: string,
  options: ListRecordsOptions,
  ctx: CollectionContext,
): Promise<ListRecordsResult> {
  await loadReadable(collectionId, ctx);

  const search = options.search?.trim();
  const where = search
    ? and(
        eq(collectionRecords.collectionId, collectionId),
        sql`${collectionRecords.data}::text ILIKE ${`%${search}%`}`,
      )
    : eq(collectionRecords.collectionId, collectionId);

  const counted = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(collectionRecords)
    .where(where);
  const total = counted[0]?.count ?? 0;

  const limit = Math.min(
    options.limit ?? MAX_RECORDS_PER_REQUEST,
    MAX_RECORDS_PER_REQUEST,
  );

  const offset = options.offset ?? 0;

  const records = await getDb()
    .select()
    .from(collectionRecords)
    .where(where)
    .orderBy(asc(collectionRecords.position), asc(collectionRecords.createdAt))
    .limit(limit)
    .offset(offset);

  return { records, total, truncated: offset + records.length < total };
}

export async function createRecord(
  collectionId: string,
  data: Record<string, unknown>,
  ctx: CollectionContext,
): Promise<CollectionRecordSelect> {
  const collection = await loadWritable(collectionId, ctx);
  const fields = await loadFields(collectionId);
  const validated = validateRecordData(fields, data, "create");

  const maxPosition = await getDb()
    .select({ max: sql<number | null>`max(${collectionRecords.position})` })
    .from(collectionRecords)
    .where(eq(collectionRecords.collectionId, collectionId));

  const inserted = await getDb()
    .insert(collectionRecords)
    .values({
      collectionId,
      tenantId: ctx.tenantId,
      data: validated,
      position: (maxPosition[0]?.max ?? -1) + 1,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning();

  await scheduleMaterialization(collection);
  return inserted[0]!;
}

/** Insert many records at once — used by CSV import and by agent tools. */
export async function createRecords(
  collectionId: string,
  rows: Record<string, unknown>[],
  ctx: CollectionContext,
): Promise<CollectionRecordSelect[]> {
  const collection = await loadWritable(collectionId, ctx);
  const fields = await loadFields(collectionId);
  if (rows.length === 0) return [];

  const validated = rows.map((row) =>
    validateRecordData(fields, row, "create"),
  );

  const maxPosition = await getDb()
    .select({ max: sql<number | null>`max(${collectionRecords.position})` })
    .from(collectionRecords)
    .where(eq(collectionRecords.collectionId, collectionId));
  let position = (maxPosition[0]?.max ?? -1) + 1;

  const inserted = await getDb()
    .insert(collectionRecords)
    .values(
      validated.map((data) => ({
        collectionId,
        tenantId: ctx.tenantId,
        data,
        position: position++,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })),
    )
    .returning();

  await scheduleMaterialization(collection);
  return inserted;
}

/**
 * Patch a record. Only the keys present in `data` are touched, so two people
 * editing different columns of the same row do not overwrite each other.
 */
export async function updateRecord(
  collectionId: string,
  recordId: string,
  data: Record<string, unknown>,
  ctx: CollectionContext,
): Promise<CollectionRecordSelect> {
  const collection = await loadWritable(collectionId, ctx);
  const fields = await loadFields(collectionId);

  const rows = await getDb()
    .select()
    .from(collectionRecords)
    .where(
      and(
        eq(collectionRecords.id, recordId),
        eq(collectionRecords.collectionId, collectionId),
      ),
    )
    .limit(1);
  const record = rows[0];
  if (!record) throw new CollectionNotFoundError("Record not found");

  const patch = validateRecordData(fields, data, "patch");

  const updated = await getDb()
    .update(collectionRecords)
    .set({
      data: { ...record.data, ...patch },
      updatedBy: ctx.userId,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(collectionRecords.id, recordId))
    .returning();

  await scheduleMaterialization(collection);
  return updated[0]!;
}

export async function deleteRecord(
  collectionId: string,
  recordId: string,
  ctx: CollectionContext,
): Promise<void> {
  const collection = await loadWritable(collectionId, ctx);
  const deleted = await getDb()
    .delete(collectionRecords)
    .where(
      and(
        eq(collectionRecords.id, recordId),
        eq(collectionRecords.collectionId, collectionId),
      ),
    )
    .returning({ id: collectionRecords.id });
  if (!deleted[0]) throw new CollectionNotFoundError("Record not found");
  await scheduleMaterialization(collection);
}

/** Delete several records in one call — the table's bulk "delete selected". */
export async function deleteRecords(
  collectionId: string,
  recordIds: string[],
  ctx: CollectionContext,
): Promise<number> {
  const collection = await loadWritable(collectionId, ctx);
  if (recordIds.length === 0) return 0;
  const deleted = await getDb()
    .delete(collectionRecords)
    .where(
      and(
        eq(collectionRecords.collectionId, collectionId),
        inArray(collectionRecords.id, recordIds),
      ),
    )
    .returning({ id: collectionRecords.id });
  await scheduleMaterialization(collection);
  return deleted.length;
}
