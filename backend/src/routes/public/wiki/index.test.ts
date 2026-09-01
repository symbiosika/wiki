import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import type { SymbiosikaFrameworkHonoApp } from "@framework/types";
import {
  initTests,
  TEST_ORGANISATION_1,
  TEST_ORGANISATION_2,
  TEST_ORG1_USER_1,
  TEST_ORG1_USER_2,
} from "@framework/test/init.test";
import { testFetcher } from "@framework/test/fetcher.test";
import {
  testing_createTeamAndAddUsers,
  testing_deleteTeam,
} from "@framework/test/permissions.test";
import { getDb } from "@framework/lib/db/db-connection";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import { createKnowledgeText } from "@framework/lib/knowledge/knowledge-texts";
import { setKnowledgeTextPublicMode } from "@framework/lib/knowledge/knowledge-text-public";
import definePublicWikiRoutes from "./index";

const TENANT = TEST_ORGANISATION_1.id;
const OWNER = TEST_ORG1_USER_1.id;

let app: SymbiosikaFrameworkHonoApp;
let teamId: string;

/**
 * Ids created by this file, so cleanup removes exactly those.
 *
 * A blanket delete of the tenant's pages would be simpler, but cleanup here is
 * fire-and-forget (see below) and TEST_ORGANISATION_1 is shared with every
 * other suite — a stray tenant-wide delete can land while the next file is
 * building its fixtures.
 */
const created: string[] = [];

const deleteTestPages = () =>
  created.length > 0
    ? getDb().delete(knowledgeText).where(inArray(knowledgeText.id, created))
    : Promise.resolve();

const publish = (id: string) =>
  setKnowledgeTextPublicMode(id, "public", { tenantId: TENANT, userId: OWNER });

/** Page ids created per test group, so assertions can name them. */
let publishedRoot: string;
let publishedChild: string;
let excludedChild: string;
let internalPage: string;
let teamInternalPage: string;

/** A term that only appears in the fixtures created below. */
const NEEDLE = `pubneedle${crypto.randomUUID().replaceAll("-", "")}`;

describe("Public Wiki Routes", () => {
  beforeAll(async () => {
    await initTests();

    app = new Hono();
    definePublicWikiRoutes(app);

    const team = await testing_createTeamAndAddUsers(TENANT, [
      OWNER,
      TEST_ORG1_USER_2.id,
    ]);
    teamId = team.teamId;

    // organisation-wide published branch
    const root = await createKnowledgeText({
      title: "Public Root",
      text: `published root mentioning ${NEEDLE}`,
      tenantId: TENANT,
      userId: OWNER,
      tenantWide: true,
    });
    publishedRoot = root.id;

    const child = await createKnowledgeText({
      title: "Public Child",
      text: "published child content",
      tenantId: TENANT,
      userId: OWNER,
      tenantWide: true,
      parentId: root.id,
    });
    publishedChild = child.id;

    // an internal page below the published branch (the escape hatch)
    const excluded = await createKnowledgeText({
      title: "Excluded Child",
      text: `internal but below a published parent, mentions ${NEEDLE}`,
      tenantId: TENANT,
      userId: OWNER,
      tenantWide: true,
      parentId: root.id,
    });
    excludedChild = excluded.id;

    // a page that was never published at all
    const internal = await createKnowledgeText({
      title: "Internal Page",
      text: `fully internal content mentioning ${NEEDLE}`,
      tenantId: TENANT,
      userId: OWNER,
      tenantWide: true,
    });
    internalPage = internal.id;

    // a team page, never published
    const teamPage = await createKnowledgeText({
      title: "Team Internal",
      text: `team-only content mentioning ${NEEDLE}`,
      tenantId: TENANT,
      userId: OWNER,
      teamId,
    });
    teamInternalPage = teamPage.id;

    created.push(
      publishedRoot,
      publishedChild,
      excludedChild,
      internalPage,
      teamInternalPage
    );

    await publish(publishedRoot);
    await setKnowledgeTextPublicMode(excludedChild, "excluded", {
      tenantId: TENANT,
      userId: OWNER,
    });
  });

  // Fire and forget cleanup (Bun runtime limitation — see the backend-testing
  // skill); scoped to this file's own rows, so a late delete cannot disturb
  // another suite. The trailing `.catch` keeps a late failure contained: this
  // chain outlives the file, and unhandled it would be counted as an error by
  // Bun and fail the whole run under a different file's name.
  afterAll(() => {
    deleteTestPages()
      .then(() => testing_deleteTeam([teamId]))
      .catch((error) => console.warn("afterAll cleanup failed:", error));
  });

  describe("no authentication is required", () => {
    test("the overview is served without a token", async () => {
      const response = await testFetcher.get(
        app,
        `/public/wiki/${TENANT}/overview`,
        undefined
      );
      expect(response.status).toBe(200);
      expect(response.jsonResponse.pageCount).toBeGreaterThan(0);
    });

    test("a published page is served without a token", async () => {
      const response = await testFetcher.get(
        app,
        `/public/wiki/${TENANT}/pages/${publishedRoot}`,
        undefined
      );
      expect(response.status).toBe(200);
      expect(response.jsonResponse.id).toBe(publishedRoot);
      expect(response.jsonResponse.title).toBe("Public Root");
    });

    test("an inherited child is served too", async () => {
      const response = await testFetcher.get(
        app,
        `/public/wiki/${TENANT}/pages/${publishedChild}`,
        undefined
      );
      expect(response.status).toBe(200);
      expect(response.jsonResponse.id).toBe(publishedChild);
    });
  });

  describe("internal content is never served", () => {
    test("an unpublished page returns 404", async () => {
      const response = await testFetcher.get(
        app,
        `/public/wiki/${TENANT}/pages/${internalPage}`,
        undefined
      );
      expect(response.status).toBe(404);
      expect(response.textResponse).not.toContain("internal content");
    });

    test("an excluded page below a published parent returns 404", async () => {
      const response = await testFetcher.get(
        app,
        `/public/wiki/${TENANT}/pages/${excludedChild}`,
        undefined
      );
      expect(response.status).toBe(404);
    });

    test("a team page returns 404", async () => {
      const response = await testFetcher.get(
        app,
        `/public/wiki/${TENANT}/pages/${teamInternalPage}`,
        undefined
      );
      expect(response.status).toBe(404);
    });

    test("the overview contains only published pages", async () => {
      const response = await testFetcher.get(
        app,
        `/public/wiki/${TENANT}/overview`,
        undefined
      );
      expect(response.status).toBe(200);

      const body = response.textResponse;
      expect(body).toContain("Public Root");
      expect(body).toContain("Public Child");
      // none of the internal titles may appear anywhere in the payload
      expect(body).not.toContain("Excluded Child");
      expect(body).not.toContain("Internal Page");
      expect(body).not.toContain("Team Internal");
    });

    test("a tenant that published nothing yields an empty overview", async () => {
      // TEST_ORGANISATION_2 has no published pages
      const response = await testFetcher.get(
        app,
        `/public/wiki/${TEST_ORGANISATION_2.id}/overview`,
        undefined
      );
      expect(response.status).toBe(200);
      expect(response.jsonResponse.pageCount).toBe(0);
      expect(response.jsonResponse.sections).toEqual([]);
    });
  });

  describe("search only reaches published pages", () => {
    test("a term shared by published and internal pages returns only the published one", async () => {
      const response = await testFetcher.get(
        app,
        `/public/wiki/${TENANT}/search?q=${NEEDLE}&mode=fulltext&limit=25`,
        undefined
      );
      expect(response.status).toBe(200);

      const ids = response.jsonResponse.hits.map((h: { id: string }) => h.id);
      expect(ids).toContain(publishedRoot);
      expect(ids).not.toContain(internalPage);
      expect(ids).not.toContain(excludedChild);
      expect(ids).not.toContain(teamInternalPage);

      // and no internal text leaked through a snippet
      expect(response.textResponse).not.toContain("fully internal content");
      expect(response.textResponse).not.toContain("team-only content");
    });

    test("an empty query is rejected", async () => {
      const response = await testFetcher.get(
        app,
        `/public/wiki/${TENANT}/search?q=`,
        undefined
      );
      expect(response.status).toBe(400);
    });

    test("an over-long query is rejected", async () => {
      const response = await testFetcher.get(
        app,
        `/public/wiki/${TENANT}/search?q=${"x".repeat(500)}`,
        undefined
      );
      expect(response.status).toBe(400);
    });

    test("the result limit is capped regardless of what is requested", async () => {
      const response = await testFetcher.get(
        app,
        `/public/wiki/${TENANT}/search?q=published&mode=fulltext&limit=9999`,
        undefined
      );
      expect(response.status).toBe(200);
      expect(response.jsonResponse.hits.length).toBeLessThanOrEqual(25);
    });
  });

  describe("organisation lookup by slug", () => {
    const SLUG = "test-organisation-1"; // from TEST_ORGANISATION_1.name

    test("resolves a slug to the organisation", async () => {
      const response = await testFetcher.get(
        app,
        `/public/wiki/by-slug/${SLUG}`,
        undefined
      );
      expect(response.status).toBe(200);
      expect(response.jsonResponse.id).toBe(TENANT);
      expect(response.jsonResponse.slug).toBe(SLUG);
      expect(response.jsonResponse.name).toBe(TEST_ORGANISATION_1.name);
    });

    test("accepts a slug that differs only in case or padding", async () => {
      const response = await testFetcher.get(
        app,
        `/public/wiki/by-slug/${SLUG.toUpperCase()}`,
        undefined
      );
      expect(response.status).toBe(200);
      expect(response.jsonResponse.id).toBe(TENANT);
    });

    test("an unknown slug returns 404", async () => {
      const response = await testFetcher.get(
        app,
        `/public/wiki/by-slug/no-such-organisation`,
        undefined
      );
      expect(response.status).toBe(404);
    });

    test("an organisation without published pages is not resolvable", async () => {
      // TEST_ORGANISATION_2 exists but publishes nothing, so its very
      // existence must not be confirmable through this endpoint
      const response = await testFetcher.get(
        app,
        `/public/wiki/by-slug/test-organisation-2`,
        undefined
      );
      expect(response.status).toBe(404);
    });

    test("the list contains publishing organisations only", async () => {
      const response = await testFetcher.get(
        app,
        `/public/wiki/organisations`,
        undefined
      );
      expect(response.status).toBe(200);

      const ids = response.jsonResponse.organisations.map(
        (o: { id: string }) => o.id
      );
      expect(ids).toContain(TENANT);
      expect(ids).not.toContain(TEST_ORGANISATION_2.id);
      expect(response.textResponse).not.toContain(TEST_ORGANISATION_2.name);
    });

    test("the payload carries branding fields with safe defaults", async () => {
      const response = await testFetcher.get(
        app,
        `/public/wiki/by-slug/${SLUG}`,
        undefined
      );
      expect(response.status).toBe(200);
      // no logo and no branding setting configured for the test org
      expect(response.jsonResponse.hasLogo).toBe(false);
      expect(response.jsonResponse.logoUpdatedAt).toBeNull();
      expect(response.jsonResponse.brandColor).toBeNull();
    });

    test("the logo route 404s when there is no logo", async () => {
      const response = await testFetcher.get(
        app,
        `/public/wiki/${TENANT}/logo`,
        undefined
      );
      expect(response.status).toBe(404);
    });

    test("the logo route 404s for an organisation that publishes nothing", async () => {
      // must not become a way to confirm that a tenant id exists
      const response = await testFetcher.get(
        app,
        `/public/wiki/${TEST_ORGANISATION_2.id}/logo`,
        undefined
      );
      expect(response.status).toBe(404);
    });

    test("the overview names the organisation", async () => {
      const response = await testFetcher.get(
        app,
        `/public/wiki/${TENANT}/overview`,
        undefined
      );
      expect(response.status).toBe(200);
      expect(response.jsonResponse.organisation.id).toBe(TENANT);
      expect(response.jsonResponse.organisation.name).toBe(
        TEST_ORGANISATION_1.name
      );
      expect(response.jsonResponse.organisation.slug).toBe(SLUG);
    });
  });

  describe("input validation", () => {
    test("a malformed tenant id is rejected", async () => {
      const response = await testFetcher.get(
        app,
        `/public/wiki/not-a-uuid/overview`,
        undefined
      );
      expect(response.status).toBe(400);
    });

    test("a malformed page id is rejected", async () => {
      const response = await testFetcher.get(
        app,
        `/public/wiki/${TENANT}/pages/not-a-uuid`,
        undefined
      );
      expect(response.status).toBe(400);
    });

    test("an unknown page id returns 404, same as an internal one", async () => {
      const unknown = await testFetcher.get(
        app,
        `/public/wiki/${TENANT}/pages/${crypto.randomUUID()}`,
        undefined
      );
      const internal = await testFetcher.get(
        app,
        `/public/wiki/${TENANT}/pages/${internalPage}`,
        undefined
      );
      // indistinguishable: a probe cannot tell "exists but internal" from
      // "does not exist"
      expect(unknown.status).toBe(404);
      expect(internal.status).toBe(404);
      expect(unknown.textResponse).toBe(internal.textResponse);
    });

    test("a page of another tenant is not reachable through this tenant", async () => {
      const otherTenantPage = await createKnowledgeText({
        title: "Other Tenant Published",
        text: "content",
        tenantId: TEST_ORGANISATION_2.id,
        userId: null,
        tenantWide: true,
      });
      await setKnowledgeTextPublicMode(otherTenantPage.id, "public", {
        tenantId: TEST_ORGANISATION_2.id,
      });

      // published, but under a different tenant → not visible here
      const response = await testFetcher.get(
        app,
        `/public/wiki/${TENANT}/pages/${otherTenantPage.id}`,
        undefined
      );
      expect(response.status).toBe(404);

      await getDb()
        .delete(knowledgeText)
        .where(eq(knowledgeText.id, otherTenantPage.id));
    });
  });

  describe("images", () => {
    test("a malformed filename is rejected", async () => {
      const response = await testFetcher.get(
        app,
        `/public/wiki/${TENANT}/pages/${publishedRoot}/images/not-a-file`,
        undefined
      );
      expect(response.status).toBe(404);
    });

    test("a well-formed but unreferenced file is refused", async () => {
      // the page text references no images at all, so even a syntactically
      // valid filename must not resolve
      const response = await testFetcher.get(
        app,
        `/public/wiki/${TENANT}/pages/${publishedRoot}/images/${crypto.randomUUID()}.png`,
        undefined
      );
      expect(response.status).toBe(404);
    });

    test("images of an internal page are refused", async () => {
      const response = await testFetcher.get(
        app,
        `/public/wiki/${TENANT}/pages/${internalPage}/images/${crypto.randomUUID()}.png`,
        undefined
      );
      expect(response.status).toBe(404);
    });
  });

  describe("no write path exists", () => {
    test.each(["POST", "PUT", "PATCH", "DELETE"])(
      "%s on a published page is not routed",
      async (method) => {
        const response = await app.request(
          `/public/wiki/${TENANT}/pages/${publishedRoot}`,
          { method }
        );
        // only GET handlers are registered, so anything else falls through
        expect(response.status).toBe(404);
      }
    );

    test("the overview route rejects a POST", async () => {
      const response = await app.request(`/public/wiki/${TENANT}/overview`, {
        method: "POST",
      });
      expect(response.status).toBe(404);
    });
  });
});
