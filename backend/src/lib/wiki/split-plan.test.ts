/**
 * How a long page is cut up: which heading level the split lands on, what
 * stays on the parent, and what each subpage ends up containing.
 *
 * The decision is pure on purpose — it is the half that can be wrong in a way
 * nobody notices until a page has already been split into the wrong shape.
 */
import { describe, test, expect } from "bun:test";
import { planPageSplit, type SplitBlock } from "./split-plan";

const md = (content: string): SplitBlock => ({ type: "markdown", content });
const html = (content: string): SplitBlock => ({ type: "html", content });

describe("planPageSplit", () => {
  test("splits at the shallowest repeated heading level", () => {
    const plan = planPageSplit([
      md("# Price list 2026\n\nValid from January."),
      md("## Model A\n\n| a | b |\n| --- | --- |"),
      md("### Details A"),
      md("## Model B"),
    ]);
    expect(plan?.level).toBe(2);
    expect(plan?.sections.map((s) => s.title)).toEqual(["Model A", "Model B"]);
  });

  test("keeps everything above the first section on the parent", () => {
    const plan = planPageSplit([
      md("# Price list 2026"),
      md("Valid from January."),
      md("## Model A"),
      md("## Model B"),
    ]);
    expect(plan?.intro.map((b) => b.content)).toEqual([
      "# Price list 2026",
      "Valid from January.",
    ]);
  });

  test("drops the heading line from the section it names", () => {
    const plan = planPageSplit([
      md("## Model A\n\n| a | b |\n| --- | --- |"),
      md("## Model B\n\ntext"),
    ]);
    expect(plan?.sections[0]!.blocks.map((b) => b.content)).toEqual([
      "| a | b |\n| --- | --- |",
    ]);
  });

  test("a section that is nothing but its heading has no blocks", () => {
    const plan = planPageSplit([md("## Model A"), md("## Model B")]);
    expect(plan?.sections[0]!.blocks).toEqual([]);
  });

  test("collects the blocks that follow a section heading", () => {
    const plan = planPageSplit([
      md("## Model A"),
      md("first"),
      md("### Sub"),
      md("## Model B"),
      md("second"),
    ]);
    expect(plan?.sections[0]!.blocks.map((b) => b.content)).toEqual([
      "first",
      "### Sub",
    ]);
    expect(plan?.sections[1]!.blocks.map((b) => b.content)).toEqual(["second"]);
  });

  test("reads headings out of html blocks the editor saved", () => {
    const plan = planPageSplit([
      html("<h2>Model &amp; A</h2>"),
      html("<p>text</p>"),
      html('<h2 data-block-id="x">Model B</h2>'),
    ]);
    expect(plan?.level).toBe(2);
    expect(plan?.sections.map((s) => s.title)).toEqual(["Model & A", "Model B"]);
    expect(plan?.sections[0]!.blocks.map((b) => b.content)).toEqual([
      "<p>text</p>",
    ]);
  });

  test("makes duplicate section titles distinct, ignoring case", () => {
    const plan = planPageSplit([
      md("## Model A"),
      md("## Model A"),
      md("## model a"),
    ]);
    expect(plan?.sections.map((s) => s.title)).toEqual([
      "Model A",
      "Model A (2)",
      "model a (3)",
    ]);
  });

  test("splits a page whose whole content is one markdown block", () => {
    const plan = planPageSplit([
      md("Intro line\n\n## Model A\n\ntext\n\n## Model B\n\nmore"),
    ]);
    // one block, one leading heading: nothing repeats, so there is no split
    expect(plan).toBeNull();
  });

  test("no repeated heading level means nothing to split", () => {
    expect(planPageSplit([md("# Only title"), md("text")])).toBeNull();
    expect(planPageSplit([md("plain text")])).toBeNull();
    expect(planPageSplit([])).toBeNull();
  });

  test("ignores a heading that is not at the start of its block", () => {
    const plan = planPageSplit([
      md("text\n\n## Not a section"),
      md("more\n\n## Also not"),
    ]);
    expect(plan).toBeNull();
  });
});
