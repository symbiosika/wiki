import { describe, test, expect } from "bun:test";
import { VirtualDocument } from "./virtual-document";
import { createVirtualDocumentTools, type AgentOutputSink } from "./tools";

const sample = ["# Title", "one", "two", "## Section", "three"].join("\n");

// The AI-SDK tool `execute` takes (args, options); tests don't need the second.
const call = (t: any, args: unknown): Promise<string> =>
  t.execute(args, {} as any);

const setup = () => {
  const doc = new VirtualDocument(sample);
  const out: AgentOutputSink = { meta: {} };
  return { doc, out, tools: createVirtualDocumentTools(doc, out) };
};

describe("createVirtualDocumentTools", () => {
  test("doc_stats returns an OK line with sizes and heading count", async () => {
    const { tools } = setup();
    const r = await call(tools.doc_stats, {});
    expect(r.startsWith("OK:")).toBe(true);
    expect(r).toContain("totalLines=5");
    expect(r).toContain("headings=2");
  });

  test("view_outline lists headings with line numbers", async () => {
    const { tools } = setup();
    const r = await call(tools.view_outline, {});
    expect(r).toContain("# Title");
    expect(r).toContain("## Section");
  });

  test("read_lines returns line-numbered output", async () => {
    const { tools } = setup();
    const r = await call(tools.read_lines, { fromLine: 1, maxLines: 2 });
    expect(r).toContain("lines 1-2 of 5");
    expect(r).toContain("1| # Title");
  });

  test("search_document finds matches", async () => {
    const { tools } = setup();
    const r = await call(tools.search_document, { query: "two" });
    expect(r).toContain("1 match");
  });

  test("replace_exact returns OK with drift info", async () => {
    const { tools, doc } = setup();
    const r = await call(tools.replace_exact, {
      oldString: "one",
      newString: "ONE",
    });
    expect(r).toContain("OK: replaced 1 occurrence");
    expect(r).toContain("version: 1");
    expect(doc.getContent()).toContain("ONE");
  });

  test("replace_exact returns ERROR string on non-unique match", async () => {
    const doc = new VirtualDocument("x\nx");
    const out: AgentOutputSink = { meta: {} };
    const tools = createVirtualDocumentTools(doc, out);
    const r = await call(tools.replace_exact, { oldString: "x", newString: "y" });
    expect(r.startsWith("ERROR:")).toBe(true);
    expect(r).toContain("not unique");
  });

  test("replace_lines reports stale view as an ERROR string", async () => {
    const { tools } = setup();
    const r = await call(tools.replace_lines, {
      fromLine: 1,
      toLine: 1,
      newText: "z",
      expectedFirstLine: "WRONG",
    });
    expect(r.startsWith("ERROR:")).toBe(true);
    expect(r).toContain("stale view");
  });

  test("insert_lines and delete_lines mutate and report version", async () => {
    const { tools, doc } = setup();
    const ins = await call(tools.insert_lines, { afterLine: 0, text: "top" });
    expect(ins).toContain("OK: inserted");
    expect(doc.getContent().startsWith("top")).toBe(true);
    const del = await call(tools.delete_lines, { fromLine: 1, toLine: 1 });
    expect(del).toContain("OK: deleted");
  });

  test("set_title writes to the output sink", async () => {
    const { tools, out } = setup();
    const r = await call(tools.set_title, { title: "Better Title" });
    expect(r).toContain("OK:");
    expect(out.title).toBe("Better Title");
  });

  test("set_meta shallow-merges into the output sink", async () => {
    const { tools, out } = setup();
    await call(tools.set_meta, { values: { voltage: "5V", pins: 8 } });
    await call(tools.set_meta, { values: { pins: 16, smd: true } });
    expect(out.meta).toEqual({ voltage: "5V", pins: 16, smd: true });
  });
});
