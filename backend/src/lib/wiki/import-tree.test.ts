import { describe, test, expect } from "bun:test";
import { planMarkdownTree, type PlannedNode } from "./import-tree";

/** Compact "path(content|folder)" view of the ordered plan. */
const shape = (ordered: PlannedNode[]): string[] =>
  ordered.map(
    (n) => `${n.segments.join("/")}${n.content !== undefined ? "" : "/"}`,
  );

describe("planMarkdownTree", () => {
  test("nests files under their folders and materialises ancestors", () => {
    const plan = planMarkdownTree([
      { path: "Docs/Intro.md", content: "# Intro" },
      { path: "Docs/Guide/Setup.md", content: "# Setup" },
    ]);
    expect(shape(plan.ordered)).toEqual([
      "Docs/",
      "Docs/Guide/",
      "Docs/Intro",
      "Docs/Guide/Setup",
    ]);
    expect(plan.pageCount).toBe(2);
    expect(plan.folderCount).toBe(2);
  });

  test("orders parents before children", () => {
    const plan = planMarkdownTree([
      { path: "a/b/c/deep.md", content: "x" },
    ]);
    // every node must appear after its parent
    const seen = new Set<string | null>([null]);
    for (const n of plan.ordered) {
      expect(seen.has(n.parentKey)).toBe(true);
      seen.add(n.key);
    }
  });

  test("merges a sibling folder note (Foo/ + Foo.md) into one page", () => {
    const plan = planMarkdownTree([
      { path: "Entwicklung.md", content: "# Dev" },
      { path: "Entwicklung/Sub.md", content: "# Sub" },
    ]);
    const dev = plan.ordered.find((n) => n.key === "entwicklung")!;
    expect(dev.content).toBe("# Dev");
    const sub = plan.ordered.find((n) => n.key === "entwicklung/sub")!;
    expect(sub.parentKey).toBe("entwicklung");
    // no duplicate empty "Entwicklung" folder
    expect(plan.ordered.filter((n) => n.key === "entwicklung")).toHaveLength(1);
    expect(plan.folderCount).toBe(0);
  });

  test("merges README / index / _index into the folder page", () => {
    const plan = planMarkdownTree([
      { path: "Handbook/README.md", content: "# Handbook" },
      { path: "Handbook/Chapter.md", content: "# Chapter" },
      { path: "Api/index.md", content: "# Api" },
      { path: "Legacy/_index.md", content: "# Legacy" },
    ]);
    expect(plan.ordered.find((n) => n.key === "handbook")!.content).toBe(
      "# Handbook",
    );
    expect(plan.ordered.find((n) => n.key === "api")!.content).toBe("# Api");
    expect(plan.ordered.find((n) => n.key === "legacy")!.content).toBe(
      "# Legacy",
    );
    expect(plan.ordered.some((n) => n.key === "handbook/readme")).toBe(false);
  });

  test("merges an in-folder same-named note (Foo/Foo.md)", () => {
    const plan = planMarkdownTree([
      { path: "Team/Team.md", content: "# Team" },
      { path: "Team/Member.md", content: "# Member" },
    ]);
    expect(plan.ordered.find((n) => n.key === "team")!.content).toBe("# Team");
    expect(plan.ordered.find((n) => n.key === "team/member")).toBeTruthy();
    expect(plan.ordered.some((n) => n.key === "team/team")).toBe(false);
  });

  test("treats an empty file as a folder", () => {
    const plan = planMarkdownTree([
      { path: "Empty.md", content: "  \n " },
      { path: "Empty/Child.md", content: "x" },
    ]);
    const empty = plan.ordered.find((n) => n.key === "empty")!;
    expect(empty.content).toBeUndefined();
    expect(plan.ordered.find((n) => n.key === "empty/child")!.parentKey).toBe(
      "empty",
    );
  });

  test("reports a duplicate; the shorter sibling note wins", () => {
    const plan = planMarkdownTree([
      { path: "Foo.md", content: "a" },
      { path: "Foo/index.md", content: "b" },
    ]);
    expect(plan.ordered.find((n) => n.key === "foo")!.content).toBe("a");
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]!.path).toBe("Foo/index.md");
  });

  test("strips the common wrapper folder when asked", () => {
    const files = [
      { path: "my-repo/a.md", content: "a" },
      { path: "my-repo/sub/b.md", content: "b" },
    ];
    expect(
      planMarkdownTree(files).ordered.some((n) => n.key === "my-repo"),
    ).toBe(true);

    const stripped = planMarkdownTree(files, { stripCommonRoot: true });
    expect(shape(stripped.ordered).sort()).toEqual(["a", "sub/", "sub/b"]);
  });

  test("does not strip when files do not share a single root", () => {
    const plan = planMarkdownTree(
      [
        { path: "a/x.md", content: "x" },
        { path: "b/y.md", content: "y" },
      ],
      { stripCommonRoot: true },
    );
    expect(plan.ordered.filter((n) => n.parentKey === null).map((n) => n.key).sort()).toEqual(["a", "b"]);
  });

  test("skips entries whose path is empty", () => {
    const plan = planMarkdownTree([{ path: "   ", content: "x" }]);
    expect(plan.ordered).toHaveLength(0);
    expect(plan.skipped).toHaveLength(1);
  });
});
