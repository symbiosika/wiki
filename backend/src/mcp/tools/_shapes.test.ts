/**
 * Unit tests for the context-economy response shaping (no network).
 * Run: bun test
 */
import { describe, test, expect } from "bun:test";
import {
  annotateEmbeddedImages,
  compactSnippetImages,
  stripEmpty,
  slimPageRow,
  slimPageRows,
  pageMetadata,
  slimHistoryRows,
  pageVersion,
  slimOverview,
  slimBatchRows,
} from "./_shapes";

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
      agentInstructions: { content: "…", updatedAt: "2026-07-01T00:00:00Z" },
    });
    expect(o.metrics).toEqual({ totalPages: 2 });
    expect((o.topLevel as any[])[0].summaryContentHash).toBeUndefined();
    expect((o.recentChanges as any[])[0].id).toBe("p1");
    expect(o.agentInstructions).toEqual({
      content: "…",
      updatedAt: "2026-07-01T00:00:00Z",
    });
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

describe("annotateEmbeddedImages", () => {
  const ref =
    "/api/v1/tenant/t1/files/db/knowledge/0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d.png";
  const tail = "/files/db/knowledge/0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d.png";

  test("lists embedded images and adds the hint", () => {
    const out = annotateEmbeddedImages({
      id: "p1",
      title: "T",
      content: `intro\n\n![diagram](${ref})\n\n<img src="${ref}">`,
    }) as Record<string, unknown>;
    expect(out.embeddedImages).toEqual([{ ref: tail, alt: "diagram" }]);
    expect(String(out.embeddedImagesHint)).toContain("get_page_image");
  });

  test("carries the description of an image", () => {
    const out = annotateEmbeddedImages({
      id: "p1",
      content:
        `![Schaltplan](${ref})\n` +
        `<image-description src="${ref}">Steuerplatine mit Netzteil links</image-description>`,
    }) as Record<string, unknown>;
    expect(out.embeddedImages).toEqual([
      {
        ref: tail,
        alt: "Schaltplan",
        description: "Steuerplatine mit Netzteil links",
      },
    ]);
    // the hint has to say that the description IS content, not a side note
    expect(String(out.embeddedImagesHint)).toContain("page content");
  });

  test("says so when an image has no description", () => {
    const out = annotateEmbeddedImages({
      id: "p1",
      content: `![a](${ref})`,
    }) as Record<string, unknown>;
    expect(String(out.embeddedImagesHint)).toContain("looking");
  });

  test("lists images extracted from an imported document (images bucket)", () => {
    const imported =
      "/api/v1/tenant/t1/files/db/images/3885f189-5b63-4daf-8ea4-d981078039eb.jpeg";
    const out = annotateEmbeddedImages({
      id: "p1",
      title: "Systemkatalog",
      content: `## Zimmer-Funkruf über Funkbox\n\n![img-0.jpeg](${imported})`,
    }) as Record<string, unknown>;
    // the alt text is only the parser's file name, so it is not reported
    expect(out.embeddedImages).toEqual([
      { ref: "/files/db/images/3885f189-5b63-4daf-8ea4-d981078039eb.jpeg" },
    ]);
  });

  test("annotates a subtree's children too", () => {
    const out = annotateEmbeddedImages({
      id: "root",
      content: "kein Bild",
      children: [
        { id: "child", content: `![a](${ref})`, children: [] },
      ],
    }) as Record<string, unknown>;
    const child = (out.children as Record<string, unknown>[])[0]!;
    expect(child.embeddedImages).toEqual([{ ref: tail, alt: "a" }]);
    // the parent itself gains nothing but must not lose its own fields
    expect(out.id).toBe("root");
    expect(out.embeddedImages).toBeUndefined();
  });

  test("annotates every row of a batch", () => {
    const out = annotateEmbeddedImages([
      { id: "p1", content: "nur Text" },
      { id: "p2", content: `![a](${ref})` },
    ]) as Record<string, unknown>[];
    expect(out[0]!.embeddedImages).toBeUndefined();
    expect(out[1]!.embeddedImages).toEqual([{ ref: tail, alt: "a" }]);
  });

  test("leaves pages without images untouched", () => {
    const page = { id: "p1", content: "plain text" };
    expect(annotateEmbeddedImages(page)).toBe(page);
  });

  test("ignores non-page payloads", () => {
    expect(annotateEmbeddedImages("x")).toBe("x");
    expect(annotateEmbeddedImages(null)).toBe(null);
    expect(annotateEmbeddedImages([1])).toEqual([1]);
  });
});

describe("compactSnippetImages", () => {
  const ref =
    "/api/v1/tenant/t1/files/db/knowledge/0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d.png";

  test("shrinks the image in a search hit's snippet to its description", () => {
    const out = compactSnippetImages([
      {
        id: "p1",
        title: "Anlage",
        snippet:
          `Aufbau ![Schaltplan](${ref})\n` +
          `<image-description src="${ref}">Steuerplatine</image-description> Ende`,
      },
    ]) as Record<string, unknown>[];
    expect(out[0]!.snippet).toBe("Aufbau [image: Steuerplatine] Ende");
  });

  test("leaves a hit without images untouched", () => {
    const hits = [{ id: "p1", snippet: "Urlaub über das Portal" }];
    expect(compactSnippetImages(hits)).toEqual(hits);
  });

  test("ignores payloads that are not search hits", () => {
    expect(compactSnippetImages(null)).toBe(null);
    expect(compactSnippetImages("x")).toBe("x");
  });
});
