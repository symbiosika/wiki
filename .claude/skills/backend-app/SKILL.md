---
name: backend-app
description: >
  Use when editing or creating files in backend/src/routes/ or backend/src/lib/.
  Use when the user asks to add an API endpoint, create a route, write business logic,
  run the dev server, run migrations, or asks about the API/logic separation pattern.
  Use when working with app-specific database tables in backend/src/db/.
---

# App Backend Development

The app uses the symbiosika-framework (`backend/framework/`). Path alias: `@framework/*` → `./framework/src/*`

## Commands

- `bun run docker:up` / `docker:down` - Start/stop development database
- `bun run dev` - Start dev server with hot reload
- `bun run init` - Generate secrets (AES keys, JWT keys) into .env
- `bun run app:generate` - Generate app-specific migrations
- `bun run app:migrate` - Apply app-specific migrations
- `bun run migrate` - Run framework + app migrations together

## Server Configuration (`src/index.ts`)

```typescript
import { defineServer } from "@framework/index";
import * as appSchema from "./db/schema";

const server = defineServer({
  port: 3100,
  appName: "My App",
  basePath: "/api/v1",
  loginUrl: "/login.html",
  magicLoginVerifyUrl: "/magic-login-verify.html",
  staticPublicDataPath: "./public",
  staticPrivateDataPath: "./static",
  customDbSchema: { ...appSchema },
  customHonoAppsWithAuth: [
    {
      baseRoute: "",
      app: (app) => {
        defineMyRoutes(app);
      },
    },
  ],
  customPostRegisterActions: [
    async (userId, email) => await ensureDefaultTenantAndAddUser(userId, email),
  ],
});
```

## Route Structure

- App routes: `backend/src/routes/`
- Tenant-scoped routes: `backend/src/routes/tenant/[tenantId]/`

### Route File Pattern

Every route file follows this exact structure:

```typescript
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import { Hono } from "hono";
import { validator } from "hono-openapi";
import * as v from "valibot";
import { HTTPException } from "hono/http-exception";
import { getX, createX, updateX, deleteX } from "../../../lib/x";

const app: SymbiosikaFrameworkHonoApp = new Hono();

// GET / - List all
app.get(
  "/",
  validator("param", v.object({ tenantId: v.string() })),
  async (c) => {
    const { tenantId } = c.req.valid("param");
    try {
      const data = await getX(tenantId);
      return c.json({ success: true, data });
    } catch (error) {
      return c.json({ success: false, error: "Failed to fetch" }, 500);
    }
  }
);

// POST / - Create
app.post(
  "/",
  validator("param", v.object({ tenantId: v.string() })),
  async (c) => {
    const { tenantId } = c.req.valid("param");
    const body = await c.req.json();
    try {
      const entry = await createX(tenantId, body);
      return c.json({ success: true, data: entry });
    } catch (error) {
      if (error instanceof v.ValiError) {
        throw new HTTPException(400, { message: "Validation error", cause: error.issues });
      }
      if (error instanceof Error && (error as any).issues) {
        return c.json({ success: false, error: error.message }, 400);
      }
      return c.json({ success: false, error: "Failed to create" }, 500);
    }
  }
);

// Route registration export
export const defineXRoutes = (honoApp: SymbiosikaFrameworkHonoApp) => {
  honoApp.route("/tenant/:tenantId/x", app);
};
```

### Response Pattern

Always use consistent JSON structure:
- Success: `c.json({ success: true, data: ... })`
- Not found: `c.json({ success: false, error: "X not found" }, 404)`
- Validation: `c.json({ success: false, error: error.message }, 400)`
- Server error: `c.json({ success: false, error: "Failed to ..." }, 500)`

### Error Handling Pattern

```typescript
try {
  // route logic
} catch (error) {
  if (error instanceof HTTPException) throw error;
  if (error instanceof v.ValiError) {
    throw new HTTPException(400, { message: "Validation error", cause: error.issues });
  }
  if (error instanceof Error && (error as any).issues) {
    return c.json({ success: false, error: error.message }, 400);
  }
  return c.json({ success: false, error: "Failed to ..." }, 500);
}
```

### Middleware Chain

Routes use this middleware order:
1. all endpoints in customHonoAppsWithAuth uses JWT auth that sets `c.get("usersId")`, `c.get("usersEmail")`
2. `checkUserPermission` - For sensitive operations (optional)
3. `validator("param", ...)` - Path param validation
4. `validator("query", ...)` - Query string validation (optional)
5. `validator("json", ...)` - Body validation (optional)

## API and Business Logic Separation

**CRITICAL**: Never mix API concerns with business logic.

### Route files (`src/routes/`) handle ONLY:
- Endpoint definitions, routing, middleware
- Request validation with `validator()` from `hono-openapi`
- Parameter extraction: `c.req.valid("param")`, `c.req.valid("query")`, `c.req.valid("json")`
- Context values: `c.get("usersId")`
- HTTP responses and error formatting

### Business logic files (`src/lib/`) contain:
- All database operations via `getDb()` from `@framework/lib/db/db-connection`
- Data validation with `v.parse()` using insert/update schemas
- Business rules and data transformations
- Reusable functions callable from routes and AI tools

### Business Logic Pattern

```typescript
import { getDb } from "@framework/lib/db/db-connection";
import { xTable } from "../../db/schema";
import { eq, and, desc } from "drizzle-orm";
import * as v from "valibot";
import { xTableInsertSchema, xTableUpdateSchema } from "../../db/schema";

export async function getX(tenantId: string) {
  return await getDb()
    .select()
    .from(xTable)
    .where(eq(xTable.tenantId, tenantId))
    .orderBy(desc(xTable.createdAt));
}

export async function getXById(tenantId: string, id: string) {
  const entry = await getDb()
    .select().from(xTable)
    .where(and(eq(xTable.id, id), eq(xTable.tenantId, tenantId)))
    .limit(1);
  return entry.length > 0 ? entry[0] : null;
}

export async function createX(tenantId: string, data: unknown) {
  const validated = v.parse(xTableInsertSchema, {
    ...(data as Record<string, unknown>),
    tenantId,
  });
  const result = await getDb().insert(xTable).values(validated).returning();
  return result[0]!;
}

export async function updateX(tenantId: string, id: string, data: unknown) {
  const validated = v.parse(xTableUpdateSchema, data);
  const result = await getDb()
    .update(xTable)
    .set({ ...validated, updatedAt: new Date().toISOString() })
    .where(and(eq(xTable.id, id), eq(xTable.tenantId, tenantId)))
    .returning();
  return result.length > 0 ? result[0] : null;
}

export async function deleteX(tenantId: string, id: string): Promise<boolean> {
  const result = await getDb()
    .delete(xTable)
    .where(and(eq(xTable.id, id), eq(xTable.tenantId, tenantId)))
    .returning();
  return result.length > 0;
}
```

### Key Rules

- **All queries must be tenant-scoped**: Always include `eq(table.tenantId, tenantId)` in WHERE
- **TenantId from params**: `const { tenantId } = c.req.valid("param")`
- **Timestamps**: `createdAt` is auto-set via `defaultNow()`, `updatedAt` must be set manually on update
- **Returning pattern**: Use `.returning()` and access `result[0]!`
- **Existence checks**: `.limit(1)` then `entry.length > 0 ? entry[0] : null`
- **System entities**: Check `entity.system` flag before edit/delete

## Database Schema (`src/db/`)

- `src/db/index.ts` - Constants (e.g., `PREFIX = "app_"`)
- `src/db/schema.ts` - Re-exports all tables and enums
- `src/db/tables/` - One file per table
- `src/db/tables/enums.ts` - Shared enums

### Table Definition Pattern

```typescript
import { sql } from "drizzle-orm";
import { uuid, index, varchar, timestamp, numeric } from "drizzle-orm/pg-core";
import { pgBaseTable } from "@framework/lib/db/schema";
import { relations } from "drizzle-orm";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-valibot";
import { tenants } from "@framework/lib/db/schema/users";

export const xTable = pgBaseTable(
  "x_table",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull().defaultNow(),
  },
  (table) => [
    index("x_table_tenant_id_idx").on(table.tenantId),
  ]
);

export const xTableRelations = relations(xTable, ({ one }) => ({
  tenant: one(tenants, { fields: [xTable.tenantId], references: [tenants.id] }),
}));

export type XTableSelect = typeof xTable.$inferSelect;
export type XTableInsert = typeof xTable.$inferInsert;
export const xTableSelectSchema = createSelectSchema(xTable);
export const xTableInsertSchema = createInsertSchema(xTable);
export const xTableUpdateSchema = createUpdateSchema(xTable);
```

### Schema Re-export (`schema.ts`)

```typescript
export * from "./tables/enums";
export * from "./tables/x-table";
```

### Common Table Rules

- All tables MUST have: `id` (UUID), `tenantId` (FK with cascade), `createdAt`, `updatedAt`
- Always add index on `tenantId`
- Use `pgBaseTable` (not `pgTable`) - it adds the app prefix
- Enums go in `tables/enums.ts`
- Valibot schemas auto-generated via `drizzle-valibot`

## Tag Handling Pattern

For resources with tags (many-to-many):

```typescript
// Extract tags from data before insert
const { tagIds, ...entryData } = data as { tagIds?: string[]; [key: string]: unknown };

// After creating entry, insert tag relations
if (tagIds?.length) {
  await getDb().insert(entryTags).values(
    tagIds.map((tagId) => ({ entryId: newEntry.id, tagId }))
  );
}

// For updates, replace all tags
if (tagIds !== undefined) {
  await getDb().delete(entryTags).where(eq(entryTags.entryId, id));
  if (tagIds?.length) {
    await getDb().insert(entryTags).values(
      tagIds.map((tagId) => ({ entryId: id, tagId }))
    );
  }
}
```
