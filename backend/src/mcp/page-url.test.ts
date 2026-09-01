/**
 * Unit tests for the page-link annotation (no network).
 * Run: bun test
 */
import { describe, test, expect } from "bun:test";
import { pageUrl, annotatePageUrls, withPageUrls } from "./page-url";
import { wikiPageUrl } from "../lib/wiki/page-url";

const TENANT = "t-1";
const link = (pageId: string, anchor?: string) =>
  wikiPageUrl(TENANT, pageId, anchor);

describe("pageUrl()", () => {
  test("points into the app's hash route, not a bare path", () => {
    expect(pageUrl(TENANT, "p1")).toContain("/static/app/#/tenant/t-1/wiki/p1");
  });

  test("appends a heading anchor", () => {
    expect(pageUrl(TENANT, "p1", "urlaub")).toBe(link("p1", "urlaub"));
  });
});

describe("annotatePageUrls()", () => {
  test("links a page identified by id + title (search hit)", () => {
    const hits = annotatePageUrls(
      [{ id: "p1", title: "Urlaub", snippet: "…", score: 1 }],
      TENANT,
    ) as any[];
    expect(hits[0].url).toBe(link("p1"));
    expect(hits[0].title).toBe("Urlaub");
  });

  test("links via an explicit pageId (chunk context, view results)", () => {
    const result = annotatePageUrls(
      { pageId: "p2", path: "Handbuch/HR", chunks: [{ order: 0, text: "…" }] },
      TENANT,
    ) as any;
    expect(result.url).toBe(link("p2"));
    expect(result.chunks[0].url).toBeUndefined();
  });

  test("places the url right after the identity field", () => {
    const keys = Object.keys(
      annotatePageUrls({ id: "p1", title: "T", content: "x" }, TENANT) as any,
    );
    expect(keys).toEqual(["id", "url", "title", "content"]);
  });

  test("outline headings inherit the page and link to their anchor", () => {
    const outline = annotatePageUrls(
      {
        id: "p1",
        title: "Handbuch",
        outline: [
          { level: 1, title: "Urlaub", anchor: "urlaub", line: 1 },
          { level: 2, title: "Sonderurlaub", anchor: "sonderurlaub", line: 9 },
        ],
      },
      TENANT,
    ) as any;
    expect(outline.url).toBe(link("p1"));
    expect(outline.outline[0].url).toBe(link("p1", "urlaub"));
    expect(outline.outline[1].url).toBe(link("p1", "sonderurlaub"));
  });

  test("a section links to its anchor", () => {
    const section = annotatePageUrls(
      { id: "p1", anchor: "urlaub", heading: "Urlaub", content: "…" },
      TENANT,
    ) as any;
    expect(section.url).toBe(link("p1", "urlaub"));
  });

  test("walks nested structures (tree, subtree, link targets)", () => {
    const tree = annotatePageUrls(
      {
        personal: [
          { id: "p1", title: "A", children: [{ id: "p2", title: "B", children: [] }] },
        ],
        teams: [{ teamId: "team-1", name: "HR", role: "member", pages: [] }],
      },
      TENANT,
    ) as any;
    expect(tree.personal[0].url).toBe(link("p1"));
    expect(tree.personal[0].children[0].url).toBe(link("p2"));
    // a team section is not a page
    expect(tree.teams[0].url).toBeUndefined();
  });

  test("leaves non-page rows alone (organisations, facet config)", () => {
    const data = annotatePageUrls(
      {
        tenants: [{ id: "t-1", name: "Symbiosika", role: "admin" }],
        pageTypes: ["policy", "faq"],
        autoSummaries: true,
      },
      TENANT,
    ) as any;
    expect(data.tenants[0].url).toBeUndefined();
    expect(data).toEqual({
      tenants: [{ id: "t-1", name: "Symbiosika", role: "admin" }],
      pageTypes: ["policy", "faq"],
      autoSummaries: true,
    });
  });

  test("links a collection to the page it lives on, next to its pageId", () => {
    const collection = annotatePageUrls(
      { id: "c1", name: "Mitglieder", pageId: "p9", fields: [] },
      TENANT,
    ) as any;
    expect(collection.url).toBe(link("p9"));
    expect(Object.keys(collection)).toEqual([
      "id",
      "name",
      "pageId",
      "url",
      "fields",
    ]);
  });

  test("leaves rows whose id is not a page id alone (collection records)", () => {
    const records = annotatePageUrls(
      { total: 1, records: [{ title: "Anna", text: "…", id: "r1" }] },
      TENANT,
      { idsArePageIds: false },
    ) as any;
    expect(records.records[0].url).toBeUndefined();
  });

  test("never overwrites a url the API already provided", () => {
    const row = annotatePageUrls(
      { id: "p1", title: "T", url: "https://example.com/own" },
      TENANT,
    ) as any;
    expect(row.url).toBe("https://example.com/own");
  });
});

describe("withPageUrls()", () => {
  test("annotates text block and structured content in sync", () => {
    const data = { id: "p1", title: "Urlaub", content: "…" };
    const result = withPageUrls(
      {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      },
      TENANT,
    );
    const text = JSON.parse((result.content[0] as any).text);
    expect(text.url).toBe(link("p1"));
    expect((result.structuredContent as any).url).toBe(link("p1"));
  });

  test("keeps arrays as arrays in the text block", () => {
    const rows = [{ id: "p1", title: "A" }];
    const result = withPageUrls(
      {
        content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
        structuredContent: { items: rows },
      },
      TENANT,
    );
    const text = JSON.parse((result.content[0] as any).text);
    expect(Array.isArray(text)).toBe(true);
    expect(text[0].url).toBe(link("p1"));
  });

  test("passes through errors, plain text, images and missing tenants", () => {
    const error = { isError: true, content: [{ type: "text" as const, text: "API 403" }] };
    expect(withPageUrls(error, TENANT)).toEqual(error);

    const plain = { content: [{ type: "text" as const, text: "Page deleted." }] };
    expect(withPageUrls(plain, TENANT)).toEqual(plain);

    const image = {
      content: [{ type: "image" as const, data: "AAA", mimeType: "image/png" }],
    };
    expect(withPageUrls(image, TENANT)).toEqual(image);

    const page = {
      content: [{ type: "text" as const, text: '{"id":"p1","title":"A"}' }],
    };
    expect(withPageUrls(page, undefined)).toEqual(page);
  });
});
