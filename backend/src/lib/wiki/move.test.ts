import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import {
  initTests,
  TEST_ORGANISATION_1,
  TEST_ORG1_USER_1,
} from "@framework/test/init.test";
import { getDb } from "@framework/lib/db/db-connection";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import { createKnowledgeText } from "@framework/lib/knowledge/knowledge-texts";
import { setKnowledgeTextPublicMode } from "@framework/lib/knowledge/knowledge-text-public";
import { movePage } from "./move";

const TENANT = TEST_ORGANISATION_1.id;
const OWNER = TEST_ORG1_USER_1.id;
const context = { tenantId: TENANT, userId: OWNER };

const deleteTestPages = () =>
  getDb().delete(knowledgeText).where(eq(knowledgeText.tenantId, TENANT));

const page = async (title: string, parentId?: string) =>
  await createKnowledgeText({
    title,
    text: `${title} content`,
    tenantId: TENANT,
    userId: OWNER,
    tenantWide: true,
    parentId,
  });

const isPublic = async (id: string): Promise<boolean> => {
  const rows = await getDb()
    .select({ publicEffective: knowledgeText.publicEffective })
    .from(knowledgeText)
    .where(eq(knowledgeText.id, id));
  return rows[0]!.publicEffective;
};

/**
 * A move writes `parentId` directly instead of going through
 * updateKnowledgeText, so the public-visibility propagation that normally
 * rides along there is triggered explicitly in movePage. These tests exist to
 * catch that wiring being lost — a silent leak if the derived flag is not
 * re-resolved after a subtree changes parents.
 */
describe("movePage — public visibility propagation", () => {
  beforeAll(async () => {
    await initTests();
    await deleteTestPages();
  });

  afterAll(async () => {
    await deleteTestPages();
  });

  test("moving an internal subtree under a published parent publishes it", async () => {
    const published = await page("Published Target");
    await setKnowledgeTextPublicMode(published.id, "public", context);

    const branch = await page("Internal Branch");
    const leaf = await page("Internal Leaf", branch.id);
    expect(await isPublic(branch.id)).toBe(false);
    expect(await isPublic(leaf.id)).toBe(false);

    await movePage(
      branch.id,
      { parentId: published.id, orderedIds: [branch.id] },
      context
    );

    expect(await isPublic(branch.id)).toBe(true);
    // the whole subtree follows, not just the moved page
    expect(await isPublic(leaf.id)).toBe(true);
  });

  test("moving a published subtree out to the root un-publishes it", async () => {
    const published = await page("Published Source");
    await setKnowledgeTextPublicMode(published.id, "public", context);
    const branch = await page("Inherited Branch", published.id);
    const leaf = await page("Inherited Leaf", branch.id);
    expect(await isPublic(leaf.id)).toBe(true);

    await movePage(branch.id, { parentId: null, orderedIds: [branch.id] }, context);

    expect(await isPublic(branch.id)).toBe(false);
    expect(await isPublic(leaf.id)).toBe(false);
  });

  test("an explicitly published page keeps its own intent when moved", async () => {
    const internal = await page("Internal Home");
    const ownIntent = await page("Own Intent");
    await setKnowledgeTextPublicMode(ownIntent.id, "public", context);

    await movePage(
      ownIntent.id,
      { parentId: internal.id, orderedIds: [ownIntent.id] },
      context
    );

    // its own "public" intent wins over the internal parent
    expect(await isPublic(ownIntent.id)).toBe(true);
    expect(await isPublic(internal.id)).toBe(false);
  });

  test("an excluded page stays internal when moved under a published parent", async () => {
    const published = await page("Published Host");
    await setKnowledgeTextPublicMode(published.id, "public", context);
    const excluded = await page("Excluded Branch");
    const child = await page("Below Excluded", excluded.id);
    await setKnowledgeTextPublicMode(excluded.id, "excluded", context);

    await movePage(
      excluded.id,
      { parentId: published.id, orderedIds: [excluded.id] },
      context
    );

    expect(await isPublic(excluded.id)).toBe(false);
    expect(await isPublic(child.id)).toBe(false);
  });

  test("a pure reorder does not change publishing", async () => {
    const parent = await page("Reorder Parent");
    const a = await page("Child A", parent.id);
    const b = await page("Child B", parent.id);
    await setKnowledgeTextPublicMode(parent.id, "public", context);

    const writes = await movePage(
      b.id,
      { parentId: parent.id, orderedIds: [b.id, a.id] },
      context
    );

    expect(writes).toBeGreaterThan(0);
    expect(await isPublic(a.id)).toBe(true);
    expect(await isPublic(b.id)).toBe(true);
  });
});
