import { pgTableCreator } from "drizzle-orm/pg-core";
import { PREFIX } from "./index";

export const pgBaseTable = pgTableCreator((name: string) => `${PREFIX}${name}`);

// import { sql } from "drizzle-orm";
// import { uuid, index } from "drizzle-orm/pg-core";
// import { relations } from "drizzle-orm";
// import {
//   createInsertSchema,
//   createSelectSchema,
//   createUpdateSchema,
// } from "drizzle-valibot";

// export const demoTable = pgBaseTable(
//   "demo_table",
//   {
//     id: uuid("id")
//       .primaryKey()
//       .default(sql`gen_random_uuid()`),
//   },
//   (table) => [index("demo_table_id_idx").on(table.id)]
// );

// const demoTableRelations = relations(demoTable, ({ one }) => ({}));

// const demoTableInsertSchema = createInsertSchema(demoTable);
// const demoTableSelectSchema = createSelectSchema(demoTable);
// const demoTableUpdateSchema = createUpdateSchema(demoTable);
