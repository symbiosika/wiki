import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import {
  initTests,
  TEST_ORGANISATION_1,
  TEST_ORGANISATION_2,
  TEST_ORG1_USER_1,
  TEST_ORG1_USER_2,
} from "@framework/test/init.test";
import { testFetcher } from "@framework/test/fetcher.test";
import { generateUserSessionJwt } from "@framework/lib/auth";
import {
  testing_createTeamAndAddUsers,
  testing_deleteTeam,
} from "@framework/test/permissions.test";
import { getDb } from "@framework/lib/db/db-connection";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import { createKnowledgeText } from "@framework/lib/knowledge/knowledge-texts";
import defineWikiRoutes from "./index";
import type { WikiTree } from "../../../../lib/wiki/tree";

let app: SymbiosikaFrameworkHonoApp;
let user1Token: string;
let org1User2Token: string;
let teamId: string;

const deleteWikiTestPages = () =>
  getDb()
    .delete(knowledgeText)
    .where(eq(knowledgeText.tenantId, TEST_ORGANISATION_1.id));

describe("Wiki Routes", () => {
  beforeAll(async () => {
    const tokens = await initTests();
    user1Token = tokens.user1Token;
    // token for the second member of org1 (initTests only returns
    // tokens for the first user of each organisation)
    org1User2Token = (
      await generateUserSessionJwt(
        {
          email: TEST_ORG1_USER_2.email,
          id: TEST_ORG1_USER_2.id,
          firstname: "",
          surname: "",
        },
        86400
      )
    ).token;

    app = new Hono();
    defineWikiRoutes(app);

    await deleteWikiTestPages();

    // team containing user1 + user2
    const team = await testing_createTeamAndAddUsers(TEST_ORGANISATION_1.id, [
      TEST_ORG1_USER_1.id,
      TEST_ORG1_USER_2.id,
    ]);
    teamId = team.teamId;
  });

  // Fire and forget cleanup (Bun limitation — see the backend-testing skill).
  // The trailing `.catch` is what keeps a late failure contained: this chain
  // outlives the file, and the team delete in particular has been seen to hit
  // the single-connection PGlite socket while the next file is already
  // querying. Unhandled, that rejection is counted as an error by Bun and
  // fails the whole run under a different file's name.
  afterAll(() => {
    deleteWikiTestPages()
      .then(() => testing_deleteTeam([teamId]))
      .catch((error) => console.warn("afterAll cleanup failed:", error));
  });

  test("Unauthorized access is rejected", async () => {
    const response = await testFetcher.get(
      app,
      `/tenant/${TEST_ORGANISATION_1.id}/wiki/tree`,
      undefined
    );
    expect(response.status).toBe(401);
  });

  test("Cross-tenant access is rejected", async () => {
    const response = await testFetcher.get(
      app,
      `/tenant/${TEST_ORGANISATION_2.id}/wiki/tree`,
      user1Token
    );
    expect(response.status).toBe(403);
  });

  test("Invalid tenant id is rejected", async () => {
    const response = await testFetcher.get(
      app,
      `/tenant/not-a-uuid/wiki/tree`,
      user1Token
    );
    expect(response.status).toBe(400);
  });

  test("Tree is partitioned into personal, teams and organisation", async () => {
    // personal page with one child (owned by user1)
    const personalRoot = await createKnowledgeText({
      tenantId: TEST_ORGANISATION_1.id,
      userId: TEST_ORG1_USER_1.id,
      title: "My private root",
    });
    await createKnowledgeText({
      tenantId: TEST_ORGANISATION_1.id,
      userId: TEST_ORG1_USER_1.id,
      parentId: personalRoot.id,
      title: "My private child",
    });

    // organisation-wide pages (created out of alphabetical order)
    await createKnowledgeText({
      tenantId: TEST_ORGANISATION_1.id,
      userId: TEST_ORG1_USER_1.id,
      tenantWide: true,
      title: "B Org Handbook",
    });
    await createKnowledgeText({
      tenantId: TEST_ORGANISATION_1.id,
      userId: TEST_ORG1_USER_1.id,
      tenantWide: true,
      title: "A Org Guidelines",
    });

    // team page
    await createKnowledgeText({
      tenantId: TEST_ORGANISATION_1.id,
      userId: TEST_ORG1_USER_1.id,
      teamId,
      title: "Team Notes",
    });

    const response = await testFetcher.get(
      app,
      `/tenant/${TEST_ORGANISATION_1.id}/wiki/tree`,
      user1Token
    );
    expect(response.status).toBe(200);
    expect(response.jsonResponse?.success).toBe(true);

    const tree: WikiTree = response.jsonResponse?.data;

    // personal section: nested child
    expect(tree.personal.length).toBe(1);
    expect(tree.personal[0]?.title).toBe("My private root");
    expect(tree.personal[0]?.children.length).toBe(1);
    expect(tree.personal[0]?.children[0]?.title).toBe("My private child");

    // organisation section: alphabetical order (no manual positions set)
    expect(tree.organisation.map((n) => n.title)).toEqual([
      "A Org Guidelines",
      "B Org Handbook",
    ]);

    // team section
    const teamSection = tree.teams.find((t) => t.teamId === teamId);
    expect(teamSection).toBeDefined();
    expect(teamSection?.pages.map((n) => n.title)).toEqual(["Team Notes"]);
  });

  test("Other users do not see foreign personal pages", async () => {
    const response = await testFetcher.get(
      app,
      `/tenant/${TEST_ORGANISATION_1.id}/wiki/tree`,
      org1User2Token
    );
    expect(response.status).toBe(200);

    const tree: WikiTree = response.jsonResponse?.data;
    expect(tree.personal.length).toBe(0);

    // ... but they do see team and organisation pages
    expect(tree.organisation.map((n) => n.title)).toEqual([
      "A Org Guidelines",
      "B Org Handbook",
    ]);
    const teamSection = tree.teams.find((t) => t.teamId === teamId);
    expect(teamSection?.pages.map((n) => n.title)).toEqual(["Team Notes"]);
  });

  test("Move re-parents and re-orders pages within a section", async () => {
    await deleteWikiTestPages();

    // three organisation-wide root pages
    const a = await createKnowledgeText({
      tenantId: TEST_ORGANISATION_1.id,
      userId: TEST_ORG1_USER_1.id,
      tenantWide: true,
      title: "A",
    });
    const b = await createKnowledgeText({
      tenantId: TEST_ORGANISATION_1.id,
      userId: TEST_ORG1_USER_1.id,
      tenantWide: true,
      title: "B",
    });
    const cPage = await createKnowledgeText({
      tenantId: TEST_ORGANISATION_1.id,
      userId: TEST_ORG1_USER_1.id,
      tenantWide: true,
      title: "C",
    });

    // reorder roots to C, A, B
    const reorder = await testFetcher.post(
      app,
      `/tenant/${TEST_ORGANISATION_1.id}/wiki/${cPage.id}/move`,
      user1Token,
      { parentId: null, orderedIds: [cPage.id, a.id, b.id] }
    );
    expect(reorder.status).toBe(200);
    expect(reorder.jsonResponse?.success).toBe(true);

    let tree: WikiTree = (
      await testFetcher.get(
        app,
        `/tenant/${TEST_ORGANISATION_1.id}/wiki/tree`,
        user1Token
      )
    ).jsonResponse?.data;
    expect(tree.organisation.map((n) => n.title)).toEqual(["C", "A", "B"]);

    // nest B under A
    const nest = await testFetcher.post(
      app,
      `/tenant/${TEST_ORGANISATION_1.id}/wiki/${b.id}/move`,
      user1Token,
      { parentId: a.id, orderedIds: [b.id] }
    );
    expect(nest.status).toBe(200);

    tree = (
      await testFetcher.get(
        app,
        `/tenant/${TEST_ORGANISATION_1.id}/wiki/tree`,
        user1Token
      )
    ).jsonResponse?.data;
    expect(tree.organisation.map((n) => n.title)).toEqual(["C", "A"]);
    const aNode = tree.organisation.find((n) => n.title === "A");
    expect(aNode?.children.map((n) => n.title)).toEqual(["B"]);
  });

  test("Move rejects creating a cycle (page into its own descendant)", async () => {
    await deleteWikiTestPages();

    const root = await createKnowledgeText({
      tenantId: TEST_ORGANISATION_1.id,
      userId: TEST_ORG1_USER_1.id,
      tenantWide: true,
      title: "Root",
    });
    const child = await createKnowledgeText({
      tenantId: TEST_ORGANISATION_1.id,
      userId: TEST_ORG1_USER_1.id,
      parentId: root.id,
      tenantWide: true,
      title: "Child",
    });

    // moving Root under its own Child must fail
    const response = await testFetcher.post(
      app,
      `/tenant/${TEST_ORGANISATION_1.id}/wiki/${root.id}/move`,
      user1Token,
      { parentId: child.id, orderedIds: [root.id] }
    );
    expect(response.status).toBe(400);
    expect(response.jsonResponse?.success).toBe(false);
  });

  test("Pages with an invisible parent appear as section roots", async () => {
    // A tenant-wide page whose parent is a private page of user1:
    // user2 cannot see the parent, so the child must appear as a root
    // of the organisation section.
    const privateParent = await createKnowledgeText({
      tenantId: TEST_ORGANISATION_1.id,
      userId: TEST_ORG1_USER_1.id,
      title: "Private parent",
    });
    await createKnowledgeText({
      tenantId: TEST_ORGANISATION_1.id,
      userId: TEST_ORG1_USER_1.id,
      parentId: privateParent.id,
      tenantWide: true,
      title: "Orphaned org page",
    });

    const response = await testFetcher.get(
      app,
      `/tenant/${TEST_ORGANISATION_1.id}/wiki/tree`,
      org1User2Token
    );
    expect(response.status).toBe(200);

    const tree: WikiTree = response.jsonResponse?.data;
    const titles = tree.organisation.map((n) => n.title);
    expect(titles).toContain("Orphaned org page");
  });
});
