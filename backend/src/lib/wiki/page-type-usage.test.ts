import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { inArray } from "drizzle-orm";
import {
  initTests,
  TEST_ORGANISATION_1,
  TEST_ORG1_USER_1,
  TEST_ORG1_USER_2,
} from "@framework/test/init.test";
import { getDb } from "@framework/lib/db/db-connection";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import { createKnowledgeText } from "@framework/lib/knowledge/knowledge-texts";
import { getPageTypeUsage } from "./page-type-usage";

const TENANT = TEST_ORGANISATION_1.id;

/**
 * Only the ids created here are cleaned up. TEST_ORGANISATION_1 is shared with
 * every other suite, so the assertions below are written as deltas against the
 * counts taken before these fixtures exist rather than as absolute numbers.
 */
const created: string[] = [];

const makePage = async (options: {
  title: string;
  pageType?: string;
  userId?: string;
}) => {
  const page = await createKnowledgeText({
    tenantId: TENANT,
    title: options.title,
    text: "content",
    ...(options.pageType ? { pageType: options.pageType } : {}),
    userId: options.userId ?? TEST_ORG1_USER_1.id,
  });
  created.push(page.id);
  return page;
};

describe("getPageTypeUsage", () => {
  let before: Record<string, number> = {};

  beforeAll(async () => {
    await initTests();
    before = await getPageTypeUsage(TENANT);
  });

  afterAll(async () => {
    if (created.length > 0) {
      await getDb()
        .delete(knowledgeText)
        .where(inArray(knowledgeText.id, created))
        .catch(() => {});
    }
  });

  test("counts pages per page type", async () => {
    await makePage({ title: "Usage manual A", pageType: "manual" });
    await makePage({ title: "Usage manual B", pageType: "manual" });
    await makePage({ title: "Usage faq", pageType: "FAQ" });

    const usage = await getPageTypeUsage(TENANT);
    expect(usage.manual! - (before.manual ?? 0)).toBe(2);
    expect(usage.FAQ! - (before.FAQ ?? 0)).toBe(1);
  });

  test("ignores pages without a page type", async () => {
    const withoutType = await getPageTypeUsage(TENANT);
    await makePage({ title: "Usage untyped" });
    const withUntyped = await getPageTypeUsage(TENANT);

    // an untyped page must not appear under any key, least of all "null"
    expect(withUntyped).toEqual(withoutType);
    expect(Object.keys(withUntyped)).not.toContain("null");
  });

  test("omits unused page types instead of reporting zero", async () => {
    const usage = await getPageTypeUsage(TENANT);
    // "note" is in the default vocabulary but no fixture here uses it, so the
    // editor must be able to read "absent" as "safe to remove"
    expect(usage.note).toBeUndefined();
  });

  test("counts across users, not just the caller's own pages", async () => {
    // The count answers "what breaks if I remove this type", so a page owned by
    // somebody else has to be included — an admin editing the vocabulary would
    // otherwise be shown a count that is too low.
    const beforeOther = await getPageTypeUsage(TENANT);
    await makePage({
      title: "Usage policy of another user",
      pageType: "policy",
      userId: TEST_ORG1_USER_2.id,
    });
    const afterOther = await getPageTypeUsage(TENANT);
    expect((afterOther.policy ?? 0) - (beforeOther.policy ?? 0)).toBe(1);
  });
});
