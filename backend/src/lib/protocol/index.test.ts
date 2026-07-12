import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import {
  initTests,
  TEST_ORGANISATION_1,
  TEST_ORG1_USER_1,
} from "@framework/test/init.test";
import { getDb } from "@framework/lib/db/db-connection";
import { knowledgeText } from "@framework/lib/db/schema/knowledge";
import {
  ensurePersonalFolder,
  buildProtocolMarkdown,
  buildProtocolPageTitle,
  PROTOCOL_FOLDER_TITLE,
  type StructuredProtocol,
} from "./index";

const ctx = { tenantId: TEST_ORGANISATION_1.id, userId: TEST_ORG1_USER_1.id };

const cleanup = () =>
  getDb().delete(knowledgeText).where(eq(knowledgeText.tenantId, ctx.tenantId));

const sample: StructuredProtocol = {
  title: "Kundengespräch Acme",
  summary: "Acme erhöht die Bestellung um 20 %.",
  keyPoints: ["Bestellung +20 %", "Konditionen angenommen"],
  actionItems: ["Angebot bis Freitag anpassen"],
};

describe("Protocol lib", () => {
  beforeAll(async () => {
    await initTests();
    await cleanup();
  });

  afterAll(() => {
    cleanup().then(() => {});
  });

  test("buildProtocolPageTitle produces a dated title", () => {
    const title = buildProtocolPageTitle(sample, new Date("2026-07-13T14:05:00"));
    expect(title).toBe("2026-07-13 14:05 · Kundengespräch Acme");
  });

  test("buildProtocolMarkdown includes all sections + task list", () => {
    const md = buildProtocolMarkdown("Roh-Transkript hier.", sample);
    expect(md).toContain("# Kundengespräch Acme");
    expect(md).toContain("## Zusammenfassung");
    expect(md).toContain("## Kernpunkte");
    expect(md).toContain("- Bestellung +20 %");
    expect(md).toContain("## Aufgaben");
    expect(md).toContain("- [ ] Angebot bis Freitag anpassen");
    expect(md).toContain("## Originaltranskript");
    expect(md).toContain("Roh-Transkript hier.");
  });

  test("buildProtocolMarkdown omits empty sections", () => {
    const md = buildProtocolMarkdown("x", {
      title: "T",
      summary: "S",
      keyPoints: [],
      actionItems: [],
    });
    expect(md).not.toContain("## Kernpunkte");
    expect(md).not.toContain("## Aufgaben");
  });

  test("ensurePersonalFolder is idempotent", async () => {
    const a = await ensurePersonalFolder(ctx, PROTOCOL_FOLDER_TITLE);
    const b = await ensurePersonalFolder(ctx, PROTOCOL_FOLDER_TITLE);
    expect(a.id).toBe(b.id);
    expect(a.title).toBe(PROTOCOL_FOLDER_TITLE);
    expect(a.parentId).toBeNull();
    expect(a.tenantWide).toBe(false);

    // exactly one folder row exists
    const rows = await getDb()
      .select()
      .from(knowledgeText)
      .where(eq(knowledgeText.title, PROTOCOL_FOLDER_TITLE));
    expect(rows.filter((r) => r.tenantId === ctx.tenantId).length).toBe(1);
  });
});
