---
name: database-tables
description: >
  Use when the user asks to create a new database table, add or modify columns, add indexes or relations,
  or generate/run database migrations. Use when editing files in backend/src/db/ or backend/framework/src/lib/db/.
  Use when the user mentions Drizzle ORM schema definitions.
---

# Database Tables Skill

This skill helps you create and manage database tables in the business-app using Drizzle ORM with PostgreSQL.

## When to use this skill

Use this skill when:
- Creating new database tables
- Modifying existing table schemas
- Adding columns, indexes, or relations
- Working with database migrations

## Project Structure

The project uses a dual-configuration setup:
- **Framework tables**: Managed in `backend/framework/` with prefix `base_`
- **App tables**: Managed in `backend/src/db/schema.ts` with prefix `app_`

## Creating a New Table

### 1. Define the Table Schema

Add your table definition to `backend/src/db/schema.ts`:

```typescript
import { pgBaseTable } from "@framework/lib/db/schema";
import { uuid, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const myTable = pgBaseTable(
  "my_table",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("my_table_tenant_id_idx").on(table.tenantId),
  ]
);
```

### 2. Add Relations (Optional)

If your table relates to other tables:

```typescript
import { relations } from "drizzle-orm";

export const myTableRelations = relations(myTable, ({ one }) => ({
  tenant: one(tenants, {
    fields: [myTable.tenantId],
    references: [tenants.id],
  }),
}));
```

### 3. Add Type Exports and Schemas

```typescript
export type MyTableSelect = typeof myTable.$inferSelect;
export type MyTableInsert = typeof myTable.$inferInsert;

export const myTableSelectSchema = createSelectSchema(myTable);
export const myTableInsertSchema = createInsertSchema(myTable);
export const myTableUpdateSchema = createUpdateSchema(myTable);
```

### 4. Generate Migration

Navigate to the `backend` directory and run:

```bash
cd backend
bun run generate
```

This generates migration files in `backend/drizzle-sql/` for both framework and app schemas.

### 5. Apply Migration

Run the migration to apply changes to the database:

```bash
bun run migrate
```

This applies migrations for both framework and app schemas.

## Common Patterns

### Enums

Define enums before tables:

```typescript
export const statusEnum = pgEnum("status", ["active", "inactive", "pending"]);
```

### Foreign Keys

Always include `onDelete` behavior:

```typescript
tenantId: uuid("tenant_id")
  .references(() => tenants.id, { onDelete: "cascade" })
  .notNull(),
```

### Indexes

Add indexes for frequently queried columns:

```typescript
(table) => [
  index("my_table_tenant_id_idx").on(table.tenantId),
  index("my_table_name_idx").on(table.name),
]
```

### Timestamps

Always include `createdAt` and `updatedAt`:

```typescript
createdAt: timestamp("created_at", { mode: "string" })
  .notNull()
  .defaultNow(),
updatedAt: timestamp("updated_at", { mode: "string" })
  .notNull()
  .defaultNow(),
```

## Important Notes

- **Always run from `backend` directory**: The commands `bun run generate` and `bun run migrate` must be executed from the `backend` directory
- **Prefix**: App tables automatically get the `app_` prefix (defined in `backend/src/db/index.ts`)
- **Framework tables**: Use `pgBaseTable` from `@framework/lib/db/schema` which applies the `base_` prefix
- **Migration files**: Generated in `backend/drizzle-sql/` with timestamped names
- **Never edit migrations directly**: Always modify the schema file and regenerate

