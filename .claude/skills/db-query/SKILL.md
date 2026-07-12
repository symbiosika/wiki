---
name: db-query
description: >
  Use when you need to inspect or verify real data in the development database. Use when the user
  asks to "check the DB", "look up rows", "run a query", "see what's in table X", count records,
  confirm a migration worked, or debug why something looks wrong by reading the actual data.
  Runs a raw SQL query and prints the rows (or the error) as JSON to the console.
---

# DB Query Skill

Run any SQL query against the development database and read the result as JSON.
Use it to **answer questions about the actual data** — what exists, how many,
what the values are — instead of guessing or writing a throwaway script.

## What you can do with it

- **Look things up**: read rows from any table to see the real data.
- **Count / aggregate**: `count(*)`, `sum`, `group by` to understand volume and distribution.
- **Verify your work**: after a migration, insert, or fix, query the table to confirm the data is as expected.
- **Debug**: when behavior looks wrong, inspect the underlying rows to find the cause.
- **Discover the schema**: list tables and columns when you don't know the structure yet.

Anything the connected DB user can run will execute. Prefer `SELECT` for
inspection. The result is plain JSON, so you can read it directly and reason
about the values.

## Usage

```bash
bun run db:query "<SQL>"
```

Always wrap the query in quotes so the shell passes it as a single argument.

## Examples

**1. List the available tables** (when you don't know the schema yet):

```bash
bun run db:query "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
```

```json
{
  "ok": true,
  "rowCount": 2,
  "rows": [
    { "tablename": "base_tenants" },
    { "tablename": "base_users" }
  ]
}
```

**2. Inspect rows in a table** (note the table prefix — see below):

```bash
bun run db:query "SELECT id, email FROM base_users LIMIT 5"
```

```json
{
  "ok": true,
  "rowCount": 1,
  "rows": [
    { "id": "a1b2...", "email": "user@example.com" }
  ]
}
```

On error you get the reason, so you can correct the query:

```json
{
  "ok": false,
  "error": "Failed query: ... (relation \"users\" does not exist)"
}
```

## Important

- **Zero config**: no setup, connection string, or flags needed. Just run it.
- **Uses the app's database**: it connects automatically to the same development
  database the app uses (the local `POSTGRES_*` environment). Whatever you query
  is the real data the running app sees.
- **Table names need their prefix**: framework tables are prefixed (e.g.
  `base_users`, `base_tenants`, not `users`/`tenants`). If a query fails with
  "relation does not exist", you likely dropped the prefix — list the tables
  (example 1) to find the exact name.
