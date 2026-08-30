/**
 * Collection tools: read and maintain the typed tables that live on wiki pages.
 *
 * A collection is a wiki page whose body is a table — members, offers, a
 * product list. The page-shaped tools (`get_page`, `search_wiki`) still find
 * and read such a page, but they see prose; these tools see the actual records,
 * with their types, and can write single rows without rewriting the page.
 *
 * The intended order of use is:
 *   1. `list_collections` (or `search_wiki` → `get_collection` by page id)
 *   2. `get_collection` — ALWAYS read the schema before writing, so the field
 *      keys and the allowed options of a select column are known
 *   3. `query_collection_records` / `create_collection_record` / …
 *
 * Permissions are the page's: a collection on someone's private page is
 * invisible here, and writing needs edit rights on that page. Field values are
 * validated server-side against the column types, and a rejected write comes
 * back naming the offending column.
 */

import { z } from "zod";
import { defineTool } from "./_helpers.ts";
import { callApi, tenantPath } from "../app-api.ts";

/** Drop bookkeeping columns that only cost the model context. */
function slimCollection(data: unknown): unknown {
  const c = data as any;
  if (!c || typeof c !== "object") return data;
  return {
    id: c.id,
    name: c.name,
    pageId: c.knowledgeTextId,
    description: c.description ?? undefined,
    fields: (c.fields ?? []).map((f: any) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required || undefined,
      hidden: f.hidden || undefined,
      options: f.options?.choices
        ? f.options.choices.map((choice: any) => choice.value)
        : undefined,
      suffix: f.options?.suffix ?? undefined,
    })),
  };
}

/** Records as `{ id, ...values }` — the nested `data` wrapper helps nobody. */
function slimRecords(data: unknown): unknown {
  const d = data as any;
  if (!d || !Array.isArray(d.records)) return data;
  return {
    total: d.total,
    truncated: d.truncated || undefined,
    records: d.records.map((r: any) => ({ id: r.id, ...r.data })),
  };
}

function slimRecord(data: unknown): unknown {
  const r = data as any;
  if (!r || typeof r !== "object" || !r.data) return data;
  return { id: r.id, ...r.data };
}

export function registerCollectionTools(mcp: any): void {
  defineTool(
    mcp,
    {
      name: "list_collections",
      title: "List collections (tables)",
      description:
        "Lists the typed tables (collections) the user can see — things like " +
        "members, current offers or a product list. Returns id, name and the " +
        "id of the wiki page each one lives on. Use `get_collection` next to " +
        "learn a table's columns before reading or writing rows.",
      inputSchema: z.object({}),
    },
    async (_args, authInfo) =>
      callApi(authInfo, tenantPath(authInfo, "/collections"), {
        transform: (data) =>
          Array.isArray(data)
            ? data.map((c: any) => ({
                id: c.id,
                name: c.name,
                pageId: c.knowledgeTextId,
                description: c.description ?? undefined,
              }))
            : data,
      }),
  );

  defineTool(
    mcp,
    {
      name: "get_collection",
      title: "Get a collection's columns",
      description:
        "Returns a collection with its column definitions: each column's " +
        "`key` (use this as the field name when writing), label, type and — " +
        "for select columns — the allowed `options`. ALWAYS call this before " +
        "creating or updating a record: writing a value that is not one of a " +
        "select column's options is rejected. Accepts either the collection id " +
        "or the id of the wiki page it lives on.",
      inputSchema: z.object({
        collectionId: z.string().optional().describe("The collection id."),
        pageId: z
          .string()
          .optional()
          .describe("Alternatively, the id of the page the table lives on."),
      }),
    },
    async (args, authInfo) => {
      const path = args.collectionId
        ? `/collections/${args.collectionId}`
        : `/collections/by-page/${args.pageId}`;
      return callApi(authInfo, tenantPath(authInfo, path), {
        transform: slimCollection,
      });
    },
  );

  defineTool(
    mcp,
    {
      name: "query_collection_records",
      title: "Query records of a collection",
      description:
        "Returns the rows of a collection as flat `{ id, <column key>: value }` " +
        "objects. `search` filters to rows containing the text in any column " +
        "(case-insensitive substring) — use it instead of pulling the whole " +
        "table when looking for specific entries. `limit` / `offset` page " +
        "through large tables; `total` reports how many rows matched.",
      inputSchema: z.object({
        collectionId: z.string().describe("The collection id."),
        search: z
          .string()
          .optional()
          .describe("Free-text filter applied across all columns."),
        limit: z.number().optional().describe("Max rows to return."),
        offset: z.number().optional().describe("Rows to skip (paging)."),
      }),
    },
    async (args, authInfo) =>
      callApi(
        authInfo,
        tenantPath(authInfo, `/collections/${args.collectionId}/records`),
        {
          query: {
            search: args.search,
            limit: args.limit,
            offset: args.offset,
          },
          transform: slimRecords,
        },
      ),
  );

  defineTool(
    mcp,
    {
      name: "create_collection_record",
      title: "Add a record to a collection",
      description:
        "Adds one row. `values` maps column KEYS (from `get_collection`, not " +
        "the labels) to values: text as a string, numbers as numbers, yes/no " +
        "columns as true/false, dates as YYYY-MM-DD, select columns as one of " +
        "their allowed options, multi-select as an array of them. Omitted " +
        "columns stay empty; a required column must be present.",
      inputSchema: z.object({
        collectionId: z.string().describe("The collection id."),
        values: z
          .record(z.string(), z.any())
          .describe("Column key → value for the new row."),
      }),
    },
    async (args, authInfo) =>
      callApi(
        authInfo,
        tenantPath(authInfo, `/collections/${args.collectionId}/records`),
        {
          method: "POST",
          json: { data: args.values },
          transform: slimRecord,
        },
      ),
  );

  defineTool(
    mcp,
    {
      name: "update_collection_record",
      title: "Update a record",
      description:
        "Changes individual values of one row. Only the columns present in " +
        "`values` are touched — everything else keeps its current value, so " +
        "there is no read-modify-write and no risk of clearing columns you did " +
        "not mean to. Pass null to empty a column. Get the `recordId` from " +
        "`query_collection_records`.",
      inputSchema: z.object({
        collectionId: z.string().describe("The collection id."),
        recordId: z.string().describe("The record id."),
        values: z
          .record(z.string(), z.any())
          .describe("Column key → new value; omitted columns are untouched."),
      }),
    },
    async (args, authInfo) =>
      callApi(
        authInfo,
        tenantPath(
          authInfo,
          `/collections/${args.collectionId}/records/${args.recordId}`,
        ),
        {
          method: "PUT",
          json: { data: args.values },
          transform: slimRecord,
        },
      ),
  );

  defineTool(
    mcp,
    {
      name: "delete_collection_record",
      title: "Delete a record",
      description:
        "Permanently deletes one row of a collection. There is no undo — " +
        "confirm with the user before calling this.",
      inputSchema: z.object({
        collectionId: z.string().describe("The collection id."),
        recordId: z.string().describe("The record id."),
      }),
    },
    async (args, authInfo) =>
      callApi(
        authInfo,
        tenantPath(
          authInfo,
          `/collections/${args.collectionId}/records/${args.recordId}`,
        ),
        { method: "DELETE" },
      ),
  );
}
