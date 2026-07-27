import { describe, test, expect } from "bun:test";
import { buildTreeFromRows } from "./tree";

type Row = Parameters<typeof buildTreeFromRows>[0][number];

const row = (partial: Partial<Row> & { id: string; title: string }): Row =>
  ({
    tenantId: "t",
    tenantWide: false,
    teamId: null,
    userId: null,
    parentId: null,
    position: null,
    contentMode: "blocks",
    hidden: false,
    meta: {},
    embeddingEnabled: false,
    knowledgeEntryId: null,
    publicMode: null,
    publicEffective: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
    ...partial,
  }) as Row;

describe("buildTreeFromRows", () => {
  test("returns an empty list for no rows", () => {
    expect(buildTreeFromRows([])).toEqual([]);
  });

  test("carries publicEffective onto every node", () => {
    // The sidebar marks published pages with a globe. Inheritance means a page
    // can be public through an ancestor without an own `publicMode`, so the
    // resolved flag has to travel per node — the client cannot derive it.
    const [node] = buildTreeFromRows([
      row({ id: "a", title: "A", publicEffective: true }),
    ]);
    expect(node!.publicEffective).toBe(true);

    const [child] = buildTreeFromRows([
      row({ id: "b", title: "B", publicEffective: false }),
    ]);
    expect(child!.publicEffective).toBe(false);
  });

  test("defaults publicEffective to false when the row omits it", () => {
    // The column is non-null in the schema, so this input is impossible to
    // express without lying to the type system — hence the double cast. It is
    // still worth pinning: the fallback decides which way an unexpected row
    // falls, and "public by accident" is the one outcome that must not happen.
    const missing = {
      ...row({ id: "c", title: "C" }),
      publicEffective: undefined,
    } as unknown as Row;

    const [node] = buildTreeFromRows([missing]);
    expect(node!.publicEffective).toBe(false);
  });

  test("nests children under parents and keeps input order", () => {
    const rows = [
      row({ id: "a", title: "A" }),
      row({ id: "a1", title: "A1", parentId: "a" }),
      row({ id: "a2", title: "A2", parentId: "a" }),
      row({ id: "b", title: "B" }),
      row({ id: "a1x", title: "A1X", parentId: "a1" }),
    ];
    const tree = buildTreeFromRows(rows);
    expect(tree.map((n) => n.id)).toEqual(["a", "b"]);
    expect(tree[0]?.children.map((n) => n.id)).toEqual(["a1", "a2"]);
    expect(tree[0]?.children[0]?.children.map((n) => n.id)).toEqual(["a1x"]);
  });

  test("treats rows with unknown parents as roots", () => {
    const rows = [row({ id: "x", title: "X", parentId: "missing" })];
    const tree = buildTreeFromRows(rows);
    expect(tree.map((n) => n.id)).toEqual(["x"]);
  });

  test("a row referencing itself as parent does not loop", () => {
    const rows = [row({ id: "s", title: "Self", parentId: "s" })];
    const tree = buildTreeFromRows(rows);
    expect(tree.map((n) => n.id)).toEqual(["s"]);
    expect(tree[0]?.children).toEqual([]);
  });
});
