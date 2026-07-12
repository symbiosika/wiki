---
name: backend-testing
description: >
  Use when the user asks to write, create, fix, or run a backend test.
  Use when editing *.test.ts files in backend/.
  Use when the user asks about test setup, initTests(), testFetcher, or test assertions.
---

# Backend Testing

Uses Bun's built-in test framework (`bun:test`).

## Running Tests

```bash
bun test src/routes/tenant/[tenantId]/example.test.ts
```

Always run from root `/backend` directory. Never use `cd`.

## Test File Structure

Tests are co-located with route files (`*.test.ts`). Security and edge-case tests can be in separate files.

```typescript
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { initTests, TEST_ORGANISATION_1 } from "@framework/test/init.test";
import { testFetcher } from "@framework/test/fetcher.test";
import { getDb } from "@framework/lib/db/db-connection";
import { Hono } from "hono";
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import { defineXRoutes } from "./index";
import { xTable } from "../../../../db/schema";
import { eq, and } from "drizzle-orm";

let app: SymbiosikaFrameworkHonoApp;
let adminToken: string;

describe("X Routes", () => {
  beforeAll(async () => {
    const { user1Token } = await initTests();
    adminToken = user1Token;

    app = new Hono();
    defineXRoutes(app);

    // Clean up existing test data
    await getDb()
      .delete(xTable)
      .where(eq(xTable.tenantId, TEST_ORGANISATION_1.id));
  });

  afterAll(() => {
    // Fire and forget cleanup (Bun runtime limitation)
    getDb()
      .delete(xTable)
      .where(eq(xTable.tenantId, TEST_ORGANISATION_1.id))
      .then(() => {});
  });

  test("Full CRUD cycle", async () => {
    // CREATE
    const createResponse = await testFetcher.post(
      app,
      `/tenant/${TEST_ORGANISATION_1.id}/x`,
      adminToken,
      { name: "Test Entry" }
    );
    expect(createResponse.status).toBe(200);
    expect(createResponse.jsonResponse?.success).toBe(true);
    const entryId = createResponse.jsonResponse?.data.id;

    // READ
    const getResponse = await testFetcher.get(
      app,
      `/tenant/${TEST_ORGANISATION_1.id}/x/${entryId}`,
      adminToken
    );
    expect(getResponse.status).toBe(200);
    expect(getResponse.jsonResponse?.data.name).toBe("Test Entry");

    // UPDATE
    const updateResponse = await testFetcher.put(
      app,
      `/tenant/${TEST_ORGANISATION_1.id}/x/${entryId}`,
      adminToken,
      { name: "Updated Entry" }
    );
    expect(updateResponse.status).toBe(200);

    // DELETE
    const deleteResponse = await testFetcher.delete(
      app,
      `/tenant/${TEST_ORGANISATION_1.id}/x/${entryId}`,
      adminToken
    );
    expect(deleteResponse.status).toBe(200);
  });

  test("Unauthorized access", async () => {
    const response = await testFetcher.get(
      app,
      `/tenant/${TEST_ORGANISATION_1.id}/x`,
      undefined // No token
    );
    expect(response.status).toBe(401);
  });
});
```

## Test Infrastructure

### initTests()

Returns tokens and sets up test data:
```typescript
const { user1Token, user2Token, user3Token, adminToken, password } = await initTests();
```

### testFetcher

Methods: `get`, `post`, `put`, `patch`, `delete`, `postFormData`, `postWithPlainResponse`

Signature: `testFetcher.method(app, path, token, body?)`

Returns: `{ status, jsonResponse, textResponse, headers }`

Token passed as `Authorization: Bearer ${token}`. Use `undefined` for unauthenticated requests.

### Test Data Constants

```typescript
import {
  TEST_ORGANISATION_1,  // Org owned by user1
  TEST_ORGANISATION_2,
  TEST_ORGANISATION_3,
  TEST_ORG1_USER_1,     // Owner of org1
  TEST_ORG1_USER_2,     // Member of org1
  TEST_ORG1_USER_3,     // Member of org1
  TEST_ORG2_USER_1,
  TEST_ADMIN_USER,      // Owner of all orgs
  TEST_PASSWORD,        // "gFskj6Dn6gFskj6Dn6"
} from "@framework/test/init.test";
```

### Test Helpers

```typescript
import {
  testing_createTeamAndAddUsers,
  testing_deleteTeam,
  testing_createKnowledgeGroup,
  testing_deleteKnowledgeGroup,
} from "@framework/test/permissions.test";
```

## Rules

- **Never mock functions** - use real implementations with test data
- **Use real database connections** - never mock the DB
- **All tests in single `describe` block** - Bun bug workaround
- **Async cleanup**: Use `.then(() => {})` in `afterAll` (Bun limitation)
- **Clean up test data** in `beforeAll` AND `afterAll`
- **Path alias**: `@framework/*` → `./framework/src/*`

## Common Assertions

```typescript
// Status codes
expect(response.status).toBe(200);   // Success
expect(response.status).toBe(400);   // Validation error
expect(response.status).toBe(401);   // Unauthorized
expect(response.status).toBe(403);   // Forbidden
expect(response.status).toBe(404);   // Not found

// Response structure
expect(response.jsonResponse?.success).toBe(true);
expect(response.jsonResponse?.data).toBeDefined();
expect(Array.isArray(response.jsonResponse?.data)).toBe(true);
expect(response.jsonResponse?.data.length).toBeGreaterThan(0);

// Data validation
expect(response.jsonResponse?.data.id).toBe(entryId);
expect(response.jsonResponse?.data.name).toBe("Expected Name");

// Error testing
expect(async () => await fn()).toThrow();

// Flexible (edge cases)
expect([200, 400]).toContain(response.status);
```

## Security Test Pattern

```typescript
test("Cross-tenant access rejected", async () => {
  const response = await testFetcher.get(
    app,
    `/tenant/${TEST_ORGANISATION_1.id}/x`,
    user2Token // User from different tenant
  );
  expect(response.status).toBe(403);
});
```

## Workaound for hanging postgre tasks

Bun has problems with hanging postgre tasks!

https://github.com/oven-sh/bun/issues/19130

This will fail hang forever:
```ts
import { test, expect } from 'bun:test';
import { SQL } from 'bun';

const sql = new SQL('postgres://user@localhost:5432/db', { prepare: false });

test('hangs forever', async () => {
  await expect(
    sql.unsafe(`SELECT * FROM table_that_does_not_exist`)
  ).rejects.toThrow();
});

```

This is a workaround(!):
```ts
let threw = false;
try {
  await sql.unsafe(`SELECT * FROM table_that_does_not_exist`);
} catch {
  threw = true;
}
expect(threw).toBe(true);
```
