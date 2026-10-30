/**
 * An organisation owner always keeps write access to the organisation's
 * knowledge. Driven through the real framework members endpoint
 * (PUT /api/v1/tenant/:tenantId/members/:memberId) and knowledge-texts create
 * endpoint, behind the same fetch wrapper the server uses (../../index.ts).
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import {
  initTests,
  TEST_ORGANISATION_1,
  TEST_ORG1_USER_1,
  TEST_ORG1_USER_2,
  TEST_ORG1_USER_3,
} from "@framework/test/init.test";
import { generateUserSessionJwt } from "@framework/lib/auth";
import { getDb } from "@framework/lib/db/db-connection";
import { tenantMembers } from "@framework/lib/db/db-schema";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import defineTenantRoutes from "@framework/routes/tenant";
import defineRoutesForKnowledgeTexts from "@framework/routes/tenant/[tenantId]/knowledge/texts";
import {
  memberUpdateTarget,
  withOwnerKnowledgeWriteAccess,
} from "./owner-knowledge-access";

const BASE = "/api/v1";
const TENANT = TEST_ORGANISATION_1.id;
const TITLE_PREFIX = "owner-knowledge-access-test";

let fetchApp: (request: Request) => Promise<Response | undefined>;
let ownerToken: string;
let user2Token: string;
let user3Token: string;

const tokenFor = async (user: { id: string; email: string }) =>
  (
    await generateUserSessionJwt(
      { email: user.email, id: user.id, firstname: "", surname: "" },
      86400,
    )
  ).token;

const call = async (
  method: string,
  path: string,
  token: string,
  body: unknown,
) => {
  const response = (await fetchApp(
    new Request(`http://wiki.local${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  ))!;
  const text = await response.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: response.status, json, text };
};

const storedMember = async (userId: string) => {
  const [row] = await getDb()
    .select({
      role: tenantMembers.role,
      knowledgeAccess: tenantMembers.knowledgeAccess,
    })
    .from(tenantMembers)
    .where(
      and(eq(tenantMembers.tenantId, TENANT), eq(tenantMembers.userId, userId)),
    );
  return row!;
};

const setMember = (
  token: string,
  userId: string,
  body: { role?: string; knowledgeAccess?: string },
) => call("PUT", `/tenant/${TENANT}/members/${userId}`, token, body);

const createOrgWidePage = (token: string, title: string) =>
  call("POST", `/tenant/${TENANT}/knowledge/texts`, token, {
    tenantId: TENANT,
    title: `${TITLE_PREFIX} ${title}`,
    text: "",
    tenantWide: true,
  });

const resetMembers = async () => {
  await getDb()
    .update(tenantMembers)
    .set({ knowledgeAccess: "write" })
    .where(
      and(
        eq(tenantMembers.tenantId, TENANT),
        eq(tenantMembers.userId, TEST_ORG1_USER_1.id),
      ),
    );
  await getDb()
    .update(tenantMembers)
    .set({ role: "member", knowledgeAccess: "write" })
    .where(
      and(
        eq(tenantMembers.tenantId, TENANT),
        inArray(tenantMembers.userId, [
          TEST_ORG1_USER_2.id,
          TEST_ORG1_USER_3.id,
        ]),
      ),
    );
};

const deleteTestPages = () =>
  getDb()
    .delete(knowledgeText)
    .where(
      and(
        eq(knowledgeText.tenantId, TENANT),
        sql`${knowledgeText.title} LIKE ${TITLE_PREFIX + "%"}`,
      ),
    );

describe("Organisation owner keeps write access to the knowledge", () => {
  beforeAll(async () => {
    const tokens = await initTests();
    ownerToken = tokens.user1Token;
    user2Token = await tokenFor(TEST_ORG1_USER_2);
    user3Token = await tokenFor(TEST_ORG1_USER_3);

    const app: SymbiosikaFrameworkHonoApp = new Hono();
    defineTenantRoutes(app, BASE);
    defineRoutesForKnowledgeTexts(app, BASE);
    const wrapped = withOwnerKnowledgeWriteAccess((request: Request) =>
      app.fetch(request),
    );
    fetchApp = async (request) => wrapped(request);

    await resetMembers();
    await deleteTestPages();
  });

  afterAll(() => {
    resetMembers()
      .then(() => deleteTestPages())
      .catch((error) => console.warn("afterAll cleanup failed:", error));
  });

  test("only member updates are matched", () => {
    const member = `http://wiki.local${BASE}/tenant/${TENANT}/members/${TEST_ORG1_USER_1.id}`;
    expect(memberUpdateTarget(new Request(member, { method: "PUT" }))).toEqual({
      tenantId: TENANT,
      memberId: TEST_ORG1_USER_1.id,
    });
    expect(memberUpdateTarget(new Request(member, { method: "DELETE" }))).toBe(
      null,
    );
    expect(
      memberUpdateTarget(
        new Request(`http://wiki.local${BASE}/tenant/${TENANT}/members`, {
          method: "PUT",
        }),
      ),
    ).toBe(null);
  });

  test("the test owner is an owner with write access", async () => {
    const owner = await storedMember(TEST_ORG1_USER_1.id);
    expect(owner.role).toBe("owner");
    expect(owner.knowledgeAccess).toBe("write");
  });

  test("an owner setting themselves to read-only keeps write access", async () => {
    const res = await setMember(ownerToken, TEST_ORG1_USER_1.id, {
      knowledgeAccess: "read",
    });
    expect(res.status).toBe(200);
    // the response reflects what is actually stored
    expect(res.json?.knowledgeAccess).toBe("write");
    expect((await storedMember(TEST_ORG1_USER_1.id)).knowledgeAccess).toBe(
      "write",
    );

    const page = await createOrgWidePage(ownerToken, "by owner");
    expect(page.status).toBe(200);
  });

  test("an owner can set themselves to read/write", async () => {
    const res = await setMember(ownerToken, TEST_ORG1_USER_1.id, {
      knowledgeAccess: "write",
    });
    expect(res.status).toBe(200);
    expect(res.json?.knowledgeAccess).toBe("write");
  });

  test("an admin cannot make the owner read-only", async () => {
    await setMember(ownerToken, TEST_ORG1_USER_3.id, { role: "admin" });

    const res = await setMember(user3Token, TEST_ORG1_USER_1.id, {
      knowledgeAccess: "read",
    });
    expect(res.status).toBe(200);
    expect(res.json?.knowledgeAccess).toBe("write");
    expect((await storedMember(TEST_ORG1_USER_1.id)).knowledgeAccess).toBe(
      "write",
    );

    await setMember(ownerToken, TEST_ORG1_USER_3.id, { role: "member" });
  });

  test("a plain member cannot change anyone's access", async () => {
    const onOwner = await setMember(user2Token, TEST_ORG1_USER_1.id, {
      knowledgeAccess: "read",
    });
    expect(onOwner.status).toBe(403);

    const onOther = await setMember(user2Token, TEST_ORG1_USER_3.id, {
      knowledgeAccess: "read",
    });
    expect(onOther.status).toBe(403);

    const onSelf = await setMember(user2Token, TEST_ORG1_USER_2.id, {
      knowledgeAccess: "read",
    });
    expect(onSelf.status).toBe(403);

    expect((await storedMember(TEST_ORG1_USER_3.id)).knowledgeAccess).toBe(
      "write",
    );
    expect((await storedMember(TEST_ORG1_USER_2.id)).knowledgeAccess).toBe(
      "write",
    );
  });

  test("a member can still be made read-only and then cannot write", async () => {
    const res = await setMember(ownerToken, TEST_ORG1_USER_2.id, {
      knowledgeAccess: "read",
    });
    expect(res.status).toBe(200);
    expect(res.json?.knowledgeAccess).toBe("read");

    const page = await createOrgWidePage(user2Token, "by read-only member");
    expect(page.status).toBe(400);
    expect(page.text).toContain("no write access");
  });

  test("promoting a read-only member to owner grants write access", async () => {
    await setMember(ownerToken, TEST_ORG1_USER_2.id, {
      knowledgeAccess: "read",
    });

    const res = await setMember(ownerToken, TEST_ORG1_USER_2.id, {
      role: "owner",
    });
    expect(res.status).toBe(200);
    expect(res.json?.knowledgeAccess).toBe("write");
    const promoted = await storedMember(TEST_ORG1_USER_2.id);
    expect(promoted.role).toBe("owner");
    expect(promoted.knowledgeAccess).toBe("write");

    const page = await createOrgWidePage(user2Token, "by promoted owner");
    expect(page.status).toBe(200);

    await resetMembers();
  });

  test("an unauthenticated request is refused and changes nothing", async () => {
    const res = await fetchApp(
      new Request(
        `http://wiki.local${BASE}/tenant/${TENANT}/members/${TEST_ORG1_USER_2.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ knowledgeAccess: "read" }),
        },
      ),
    );
    expect(res!.status).toBe(401);
    expect((await storedMember(TEST_ORG1_USER_2.id)).knowledgeAccess).toBe(
      "write",
    );
  });
});
