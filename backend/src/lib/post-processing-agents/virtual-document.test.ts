import { describe, test, expect } from "bun:test";
import { VirtualDocument } from "./virtual-document";

const sample = [
  "# Title", // 1
  "", // 2
  "intro line", // 3
  "## Section A", // 4
  "content a1", // 5
  "content a2", // 6
  "## Section B", // 7
  "content b1", // 8
  "```", // 9
  "# not a heading (in fence)", // 10
  "```", // 11
  "tail", // 12
].join("\n");

describe("VirtualDocument", () => {
  test("stats reports lines, chars, approx tokens and version", () => {
    const doc = new VirtualDocument(sample);
    const s = doc.stats();
    expect(s.totalLines).toBe(12);
    expect(s.version).toBe(0);
    expect(s.approxTokens).toBe(Math.ceil(s.totalChars / 4));
  });

  test("outline ignores headings inside code fences", () => {
    const doc = new VirtualDocument(sample);
    const outline = doc.outline();
    expect(outline.map((e) => e.text)).toEqual([
      "Title",
      "Section A",
      "Section B",
    ]);
    expect(outline[0]).toEqual({ line: 1, level: 1, text: "Title" });
    // the "# not a heading" inside the fence must not appear
    expect(outline.some((e) => e.text.includes("not a heading"))).toBe(false);
  });

  test("readLines caps maxLines at the hard cap of 500", () => {
    const big = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join(
      "\n",
    );
    const doc = new VirtualDocument(big);
    const r = doc.readLines(1, 9999);
    expect(r.fromLine).toBe(1);
    expect(r.toLine).toBe(500);
    expect(r.totalLines).toBe(1000);
  });

  test("readLines honours 1-based first/last line edges", () => {
    const doc = new VirtualDocument(sample);
    const first = doc.readLines(1, 1);
    expect(first.content).toBe("# Title");
    const last = doc.readLines(12, 5);
    expect(last.content).toBe("tail");
    expect(last.toLine).toBe(12);
  });

  test("readLines rejects fromLine past the end", () => {
    const doc = new VirtualDocument(sample);
    expect(() => doc.readLines(99)).toThrow();
  });

  test("search literal + context, respects maxResults cap", () => {
    const doc = new VirtualDocument(sample);
    const r = doc.search("content", { contextLines: 0, maxResults: 2 });
    expect(r.totalMatches).toBe(3);
    expect(r.matches.length).toBe(2);
    expect(r.truncated).toBe(true);
  });

  test("search regex opt-in", () => {
    const doc = new VirtualDocument(sample);
    const r = doc.search("^## Section", { isRegex: true });
    expect(r.totalMatches).toBe(2);
    // literal search for the same string finds nothing (^ is escaped)
    const literal = doc.search("^## Section");
    expect(literal.totalMatches).toBe(0);
  });

  test("replaceExact errors when not found (0 occurrences)", () => {
    const doc = new VirtualDocument(sample);
    expect(() => doc.replaceExact("nope", "x")).toThrow(/0 occurrences/);
  });

  test("replaceExact errors when not unique (>1 occurrences)", () => {
    const doc = new VirtualDocument("aa\nbb\naa");
    expect(() => doc.replaceExact("aa", "x")).toThrow(/2 occurrences/);
  });

  test("replaceExact replaceAll replaces every occurrence and bumps version", () => {
    const doc = new VirtualDocument("aa\nbb\naa");
    const r = doc.replaceExact("aa", "x", true);
    expect(r.replacements).toBe(2);
    expect(doc.getContent()).toBe("x\nbb\nx");
    expect(doc.version).toBe(1);
  });

  test("replaceLines validates the range", () => {
    const doc = new VirtualDocument(sample);
    expect(() => doc.replaceLines(5, 3, "x")).toThrow();
    expect(() => doc.replaceLines(0, 1, "x")).toThrow();
    expect(() => doc.replaceLines(1, 999, "x")).toThrow();
  });

  test("replaceLines rewrites a range and updates totalLines/version", () => {
    const doc = new VirtualDocument(sample);
    const r = doc.replaceLines(4, 6, "## Renamed\none line");
    expect(r.version).toBe(1);
    const content = doc.getContent().split("\n");
    expect(content[3]).toBe("## Renamed");
    expect(content[4]).toBe("one line");
    expect(content[5]).toBe("## Section B");
    expect(r.totalLines).toBe(11);
  });

  test("anchor mismatch throws a stale-view error", () => {
    const doc = new VirtualDocument(sample);
    expect(() =>
      doc.replaceLines(4, 6, "x", { expectedFirstLine: "WRONG" }),
    ).toThrow(/stale view/);
    // correct anchor succeeds
    const r = doc.replaceLines(4, 6, "x", {
      expectedFirstLine: "## Section A",
      expectedLastLine: "content a2",
    });
    expect(r.version).toBe(1);
  });

  test("insertLines with afterLine 0 prepends", () => {
    const doc = new VirtualDocument("a\nb");
    doc.insertLines(0, "top");
    expect(doc.getContent()).toBe("top\na\nb");
  });

  test("insertLines appends after the last line", () => {
    const doc = new VirtualDocument("a\nb");
    doc.insertLines(2, "end");
    expect(doc.getContent()).toBe("a\nb\nend");
  });

  test("deleteLines removes a range and never yields an empty array", () => {
    const doc = new VirtualDocument("only");
    doc.deleteLines(1, 1);
    expect(doc.getContent()).toBe("");
    expect(doc.stats().totalLines).toBe(1);
  });

  test("version increments on every mutation only", () => {
    const doc = new VirtualDocument("a\nb\nc");
    expect(doc.version).toBe(0);
    doc.readLines(1); // read: no bump
    expect(doc.version).toBe(0);
    doc.insertLines(1, "x");
    doc.deleteLines(1, 1);
    expect(doc.version).toBe(2);
  });
});
