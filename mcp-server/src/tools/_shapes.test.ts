/**
 * Unit tests for the context-economy response shaping (no network).
 * Run: bun test
 */
import { describe, test, expect } from "bun:test";
import {
  stripEmpty,
  slimPageRow,
  slimPageRows,
  pageMetadata,
  slimHistoryRows,
  pageVersion,
  slimOverview,
  slimBatchRows,
} from "./_shapes.ts";

/** A full knowledgeText row as the app API returns it (list columns + text). */
const fullRow = {
  id: "p1",
  tenantId: "t1",
  tenantWide: false,
  teamId: null,
  userId: "u1",
  parentId: "p0",
  title: "Urlaubsregelung",
  text: "# Urlaub\n\nInhalt",
  meta: {},
  hidden: false,
  contentMode: "text",
  position: null,
  embeddingEnabled: true,
  knowledgeEntryId: "ke1",
  createdBy: "u1",
  updatedBy: "u2",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
  deletedAt: null,
  summary: "Regelt den Urlaub.",
  summaryMode: "auto",
  summaryStale: false,
  summaryContentHash: "abc",
  summaryUpdatedAt: "2026-07-01T00:00:00Z",
  summaryModel: "m",
  pageType: "policy",
  status: "verified",
  verifiedAt: null,
  verifiedBy: null,
  ownerUserId: null,
  ownerTeamId: null,
  validUntil: null,
  supersedesId: null,
  isAgentInstructions: false,
};

describe("stripEmpty()", () => {
  test("drops null and undefined but keeps false / empty string", () => {
    expect(stripEmpty({ a: null, b: undefined, c: false, d: "", e: 0 })).toEqual({
      c: false,
      d: "",
      e: 0,
    });
  });
});

describe("slimPageRow()", () => {
  test("keeps identity, tree place, scope, summary and facets only", () => {
    expect(slimPageRow(fullRow)).toEqual({
      id: "p1",
      title: "Urlaubsregelung",
      parentId: "p0",
      scope: "personal",
      summary: "Regelt den Urlaub.",
      pageType: "policy",
      status: "verified",
      updatedAt: "2026-07-01T00:00:00Z",
    });
  });

  test("derives team / organisation scope", () => {
    expect(slimPageRow({ ...fullRow, teamId: "team-9" }).scope).toBe("team");
    expect(slimPageRow({ ...fullRow, teamId: "team-9" }).teamId).toBe("team-9");
    expect(slimPageRow({ ...fullRow, tenantWide: true }).scope).toBe(
      "organisation",
    );
  });

  test("slimPageRows maps arrays and tolerates non-arrays", () => {
    expect(slimPageRows([fullRow])).toHaveLength(1);
    expect(slimPageRows(undefined)).toEqual([]);
  });
});

describe("pageMetadata()", () => {
  test("drops body text and internal wiring, adds scope + contentChars", () => {
    const m = pageMetadata(fullRow);
    expect(m.text).toBeUndefined();
    expect(m.knowledgeEntryId).toBeUndefined();
    expect(m.summaryContentHash).toBeUndefined();
    expect(m.summaryStale).toBeUndefined();
    expect(m.summaryModel).toBeUndefined();
    expect(m.scope).toBe("personal");
    expect(m.contentChars).toBe(fullRow.text.length);
    // curation facets stay visible
    expect(m.pageType).toBe("policy");
    expect(m.status).toBe("verified");
    expect(m.updatedBy).toBe("u2");
  });
});

describe("history shaping", () => {
  const historyRow = {
    id: "h1",
    knowledgeTextId: "p1",
    title: "Urlaubsregelung",
    text: "alter inhalt",
    blocks: [{ id: "b1", content: "alter inhalt" }],
    updatedBy: "u2",
    versionUpdatedAt: "2026-06-01T00:00:00Z",
    createdAt: "2026-06-02T00:00:00Z",
  };

  test("slimHistoryRows drops old contents but keeps who/when/size", () => {
    expect(slimHistoryRows([historyRow])).toEqual([
      {
        versionId: "h1",
        title: "Urlaubsregelung",
        contentChars: "alter inhalt".length,
        updatedBy: "u2",
        versionUpdatedAt: "2026-06-01T00:00:00Z",
        supersededAt: "2026-06-02T00:00:00Z",
      },
    ]);
  });

  test("pageVersion returns the full content but not the block snapshot", () => {
    const v = pageVersion(historyRow);
    expect(v.content).toBe("alter inhalt");
    expect(v.pageId).toBe("p1");
    expect(v.blocks).toBeUndefined();
  });
});

describe("composite shapes", () => {
  test("slimOverview slims embedded lists, keeps the rest", () => {
    const o = slimOverview({
      metrics: { totalPages: 2 },
      topLevel: [fullRow],
      recentChanges: [fullRow],
      agentInstructions: { id: "i", title: "Regeln", content: "…" },
    });
    expect(o.metrics).toEqual({ totalPages: 2 });
    expect((o.topLevel as any[])[0].summaryContentHash).toBeUndefined();
    expect((o.recentChanges as any[])[0].id).toBe("p1");
    expect(o.agentInstructions).toEqual({ id: "i", title: "Regeln", content: "…" });
  });

  test("slimBatchRows surfaces text as content", () => {
    const rows = slimBatchRows([fullRow]);
    expect(rows[0]!.content).toBe(fullRow.text);
    expect(rows[0]!.text).toBeUndefined();
    // without includeText the rows simply have no content field
    const { text, ...noText } = fullRow;
    expect(slimBatchRows([noText])[0]!.content).toBeUndefined();
  });
});
