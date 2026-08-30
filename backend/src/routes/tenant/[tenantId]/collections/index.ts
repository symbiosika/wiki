/**
 * Collection routes — typed tables that live on a wiki page.
 *
 *   GET    /collections                          list visible collections
 *   POST   /collections                          turn a page into a collection
 *   GET    /collections/by-page/:pageId          the collection of a page (or null)
 *   GET    /collections/:id                      collection + fields
 *   PUT    /collections/:id                      description / settings
 *   DELETE /collections/:id                      drop the table, keep the page
 *   POST   /collections/:id/fields               add a column
 *   PUT    /collections/:id/fields/reorder       reorder columns
 *   PUT    /collections/:id/fields/:fieldId      edit a column
 *   DELETE /collections/:id/fields/:fieldId      drop a column (and its values)
 *   GET    /collections/:id/records              list / search records
 *   POST   /collections/:id/records              create one or many records
 *   PUT    /collections/:id/records/:recordId    patch a record
 *   DELETE /collections/:id/records/:recordId    delete a record
 *   POST   /collections/:id/records/delete       bulk delete
 *
 * Authorization is NOT decided here. `isTenantMember` establishes that the
 * caller belongs to the organisation; everything finer — may this user see or
 * edit this particular collection — is enforced in lib/collections/store.ts by
 * resolving the anchor page through the framework's visibility rules. A user
 * who cannot see the page gets the same 404 as for a collection that does not
 * exist, which is also what keeps this router from leaking the existence of
 * other people's private pages.
 */
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import {
  authAndSetUsersInfo,
  checkUserPermission,
} from "@framework/lib/utils/hono-middlewares";
import { isTenantMember } from "@framework/routes/tenant";
import { HTTPException } from "hono/http-exception";
import { describeRoute, validator } from "hono-openapi";
import * as v from "valibot";
import {
  addField,
  createCollection,
  createRecord,
  createRecords,
  deleteCollection,
  deleteField,
  deleteRecord,
  deleteRecords,
  getCollection,
  getCollectionByPageId,
  listCollections,
  listRecords,
  reorderFields,
  updateCollection,
  updateField,
  updateRecord,
  CollectionNotFoundError,
  CollectionValueError,
} from "../../../../lib/collections/store";
import { COLLECTION_FIELD_TYPES } from "../../../../db/schema";

const tenantParam = v.object({ tenantId: v.pipe(v.string(), v.uuid()) });
const collectionParam = v.object({
  tenantId: v.pipe(v.string(), v.uuid()),
  id: v.pipe(v.string(), v.uuid()),
});
const fieldParam = v.object({
  tenantId: v.pipe(v.string(), v.uuid()),
  id: v.pipe(v.string(), v.uuid()),
  fieldId: v.pipe(v.string(), v.uuid()),
});
const recordParam = v.object({
  tenantId: v.pipe(v.string(), v.uuid()),
  id: v.pipe(v.string(), v.uuid()),
  recordId: v.pipe(v.string(), v.uuid()),
});
const pageParam = v.object({
  tenantId: v.pipe(v.string(), v.uuid()),
  pageId: v.pipe(v.string(), v.uuid()),
});

const fieldTypeSchema = v.picklist(COLLECTION_FIELD_TYPES);

const choiceSchema = v.object({
  value: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  color: v.optional(v.string()),
});

const fieldOptionsSchema = v.object({
  choices: v.optional(v.array(choiceSchema)),
  precision: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10))),
  suffix: v.optional(v.pipe(v.string(), v.maxLength(16))),
});

const settingsSchema = v.object({
  titleFieldKey: v.optional(v.string()),
  defaultSort: v.optional(
    v.object({
      key: v.string(),
      direction: v.picklist(["asc", "desc"]),
    }),
  ),
  materialize: v.optional(v.boolean()),
});

const createFieldBody = v.object({
  label: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
  type: fieldTypeSchema,
  options: v.optional(fieldOptionsSchema),
  required: v.optional(v.boolean()),
  hidden: v.optional(v.boolean()),
});

const nameSchema = v.pipe(v.string(), v.maxLength(200));

const createCollectionBody = v.object({
  knowledgeTextId: v.pipe(v.string(), v.uuid()),
  name: v.optional(v.nullable(nameSchema)),
  description: v.optional(v.nullable(v.string())),
  settings: v.optional(settingsSchema),
  fields: v.optional(v.array(createFieldBody)),
});

const updateCollectionBody = v.object({
  name: v.optional(v.nullable(nameSchema)),
  description: v.optional(v.nullable(v.string())),
  settings: v.optional(settingsSchema),
});

const updateFieldBody = v.object({
  label: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(120))),
  type: v.optional(fieldTypeSchema),
  options: v.optional(fieldOptionsSchema),
  required: v.optional(v.boolean()),
  hidden: v.optional(v.boolean()),
});

const reorderBody = v.object({
  fieldIds: v.array(v.pipe(v.string(), v.uuid())),
});

/** Record payloads are free-form: the field schema decides what is valid. */
const recordDataSchema = v.record(v.string(), v.any());

/** Accepts a single record or a batch, so CSV import needs no second route. */
const createRecordBody = v.union([
  v.object({ data: recordDataSchema }),
  v.object({ records: v.pipe(v.array(recordDataSchema), v.maxLength(2000)) }),
]);

const updateRecordBody = v.object({ data: recordDataSchema });

const bulkDeleteBody = v.object({
  recordIds: v.pipe(v.array(v.pipe(v.string(), v.uuid())), v.maxLength(2000)),
});

const listRecordsQuery = v.object({
  search: v.optional(v.pipe(v.string(), v.maxLength(200))),
  limit: v.optional(v.pipe(v.string(), v.transform(Number), v.number())),
  offset: v.optional(v.pipe(v.string(), v.transform(Number), v.number())),
});

const ok = { 200: { description: "Successful response" } };

/**
 * Map the lib layer's errors onto status codes.
 *
 * A missing collection and a collection the caller may not see are the same
 * 404 on purpose — the framework's page read throws the same way for both, and
 * distinguishing them here would tell a prober that a private page exists.
 */
function toHttpError(error: unknown): HTTPException {
  if (error instanceof HTTPException) return error;
  if (error instanceof CollectionValueError) {
    return new HTTPException(400, { message: error.message });
  }
  if (error instanceof CollectionNotFoundError) {
    return new HTTPException(404, { message: error.message });
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/not found or access denied/i.test(message)) {
    return new HTTPException(404, { message: "Collection not found" });
  }
  if (/no write access|access denied|not allowed/i.test(message)) {
    return new HTTPException(403, { message });
  }
  return new HTTPException(400, { message });
}

export default function defineCollectionRoutes(
  app: SymbiosikaFrameworkHonoApp,
  API_BASE_PATH: string = "",
) {
  const base = `${API_BASE_PATH}/tenant/:tenantId/collections`;

  /** Shared context: who is asking, in which organisation. */
  const ctxOf = (c: any, tenantId: string) => ({
    tenantId,
    userId: c.get("usersId") as string,
  });

  // list --------------------------------------------------------------------
  app.get(
    base,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["collections"],
      summary: "List collections",
      responses: ok,
    }),
    validator("param", tenantParam),
    isTenantMember,
    async (c) => {
      const { tenantId } = c.req.valid("param");
      try {
        return c.json(await listCollections(ctxOf(c, tenantId)));
      } catch (e) {
        throw toHttpError(e);
      }
    },
  );

  // create ------------------------------------------------------------------
  app.post(
    base,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["collections"],
      summary: "Turn a wiki page into a collection",
      responses: ok,
    }),
    validator("param", tenantParam),
    validator("json", createCollectionBody),
    isTenantMember,
    async (c) => {
      const { tenantId } = c.req.valid("param");
      try {
        const collection = await createCollection(
          c.req.valid("json"),
          ctxOf(c, tenantId),
        );
        return c.json(collection);
      } catch (e) {
        throw toHttpError(e);
      }
    },
  );

  // by page -----------------------------------------------------------------
  app.get(
    `${base}/by-page/:pageId`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["collections"],
      summary: "Get the collection anchored to a page",
      responses: ok,
    }),
    validator("param", pageParam),
    isTenantMember,
    async (c) => {
      const { tenantId, pageId } = c.req.valid("param");
      try {
        return c.json(
          await getCollectionByPageId(pageId, ctxOf(c, tenantId)),
        );
      } catch (e) {
        throw toHttpError(e);
      }
    },
  );

  // get one -----------------------------------------------------------------
  app.get(
    `${base}/:id`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["collections"],
      summary: "Get a collection with its fields",
      responses: ok,
    }),
    validator("param", collectionParam),
    isTenantMember,
    async (c) => {
      const { tenantId, id } = c.req.valid("param");
      try {
        return c.json(await getCollection(id, ctxOf(c, tenantId)));
      } catch (e) {
        throw toHttpError(e);
      }
    },
  );

  // update ------------------------------------------------------------------
  app.put(
    `${base}/:id`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["collections"],
      summary: "Update a collection",
      responses: ok,
    }),
    validator("param", collectionParam),
    validator("json", updateCollectionBody),
    isTenantMember,
    async (c) => {
      const { tenantId, id } = c.req.valid("param");
      try {
        return c.json(
          await updateCollection(id, c.req.valid("json"), ctxOf(c, tenantId)),
        );
      } catch (e) {
        throw toHttpError(e);
      }
    },
  );

  // delete ------------------------------------------------------------------
  app.delete(
    `${base}/:id`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["collections"],
      summary: "Delete a collection (the page stays)",
      responses: ok,
    }),
    validator("param", collectionParam),
    isTenantMember,
    async (c) => {
      const { tenantId, id } = c.req.valid("param");
      try {
        await deleteCollection(id, ctxOf(c, tenantId));
        return c.json({ success: true });
      } catch (e) {
        throw toHttpError(e);
      }
    },
  );

  // ---- fields -------------------------------------------------------------

  app.post(
    `${base}/:id/fields`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["collections"],
      summary: "Add a column",
      responses: ok,
    }),
    validator("param", collectionParam),
    validator("json", createFieldBody),
    isTenantMember,
    async (c) => {
      const { tenantId, id } = c.req.valid("param");
      try {
        return c.json(
          await addField(id, c.req.valid("json"), ctxOf(c, tenantId)),
        );
      } catch (e) {
        throw toHttpError(e);
      }
    },
  );

  // NOTE: registered before /:fieldId so "reorder" is not read as a field id.
  app.put(
    `${base}/:id/fields/reorder`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["collections"],
      summary: "Reorder columns",
      responses: ok,
    }),
    validator("param", collectionParam),
    validator("json", reorderBody),
    isTenantMember,
    async (c) => {
      const { tenantId, id } = c.req.valid("param");
      try {
        const { fieldIds } = c.req.valid("json");
        return c.json(await reorderFields(id, fieldIds, ctxOf(c, tenantId)));
      } catch (e) {
        throw toHttpError(e);
      }
    },
  );

  app.put(
    `${base}/:id/fields/:fieldId`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["collections"],
      summary: "Update a column",
      responses: ok,
    }),
    validator("param", fieldParam),
    validator("json", updateFieldBody),
    isTenantMember,
    async (c) => {
      const { tenantId, id, fieldId } = c.req.valid("param");
      try {
        return c.json(
          await updateField(
            id,
            fieldId,
            c.req.valid("json"),
            ctxOf(c, tenantId),
          ),
        );
      } catch (e) {
        throw toHttpError(e);
      }
    },
  );

  app.delete(
    `${base}/:id/fields/:fieldId`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["collections"],
      summary: "Delete a column and its values",
      responses: ok,
    }),
    validator("param", fieldParam),
    isTenantMember,
    async (c) => {
      const { tenantId, id, fieldId } = c.req.valid("param");
      try {
        await deleteField(id, fieldId, ctxOf(c, tenantId));
        return c.json({ success: true });
      } catch (e) {
        throw toHttpError(e);
      }
    },
  );

  // ---- records ------------------------------------------------------------

  app.get(
    `${base}/:id/records`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["collections"],
      summary: "List records",
      responses: ok,
    }),
    validator("param", collectionParam),
    validator("query", listRecordsQuery),
    isTenantMember,
    async (c) => {
      const { tenantId, id } = c.req.valid("param");
      const query = c.req.valid("query");
      try {
        return c.json(
          await listRecords(
            id,
            {
              search: query.search,
              limit: Number.isFinite(query.limit) ? query.limit : undefined,
              offset: Number.isFinite(query.offset) ? query.offset : undefined,
            },
            ctxOf(c, tenantId),
          ),
        );
      } catch (e) {
        throw toHttpError(e);
      }
    },
  );

  app.post(
    `${base}/:id/records`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["collections"],
      summary: "Create one or many records",
      responses: ok,
    }),
    validator("param", collectionParam),
    validator("json", createRecordBody),
    isTenantMember,
    async (c) => {
      const { tenantId, id } = c.req.valid("param");
      const body = c.req.valid("json");
      try {
        if ("records" in body) {
          const created = await createRecords(
            id,
            body.records,
            ctxOf(c, tenantId),
          );
          return c.json({ records: created });
        }
        return c.json(
          await createRecord(id, body.data, ctxOf(c, tenantId)),
        );
      } catch (e) {
        throw toHttpError(e);
      }
    },
  );

  // NOTE: registered before /:recordId, same reason as fields/reorder.
  app.post(
    `${base}/:id/records/delete`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["collections"],
      summary: "Delete several records",
      responses: ok,
    }),
    validator("param", collectionParam),
    validator("json", bulkDeleteBody),
    isTenantMember,
    async (c) => {
      const { tenantId, id } = c.req.valid("param");
      try {
        const { recordIds } = c.req.valid("json");
        const deleted = await deleteRecords(id, recordIds, ctxOf(c, tenantId));
        return c.json({ success: true, deleted });
      } catch (e) {
        throw toHttpError(e);
      }
    },
  );

  app.put(
    `${base}/:id/records/:recordId`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["collections"],
      summary: "Update a record",
      responses: ok,
    }),
    validator("param", recordParam),
    validator("json", updateRecordBody),
    isTenantMember,
    async (c) => {
      const { tenantId, id, recordId } = c.req.valid("param");
      try {
        return c.json(
          await updateRecord(
            id,
            recordId,
            c.req.valid("json").data,
            ctxOf(c, tenantId),
          ),
        );
      } catch (e) {
        throw toHttpError(e);
      }
    },
  );

  app.delete(
    `${base}/:id/records/:recordId`,
    authAndSetUsersInfo,
    checkUserPermission,
    describeRoute({
      tags: ["collections"],
      summary: "Delete a record",
      responses: ok,
    }),
    validator("param", recordParam),
    isTenantMember,
    async (c) => {
      const { tenantId, id, recordId } = c.req.valid("param");
      try {
        await deleteRecord(id, recordId, ctxOf(c, tenantId));
        return c.json({ success: true });
      } catch (e) {
        throw toHttpError(e);
      }
    },
  );
}
