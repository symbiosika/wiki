/**
 * Deciding how a long wiki page is cut into subpages — the pure half of
 * ./split.ts.
 *
 * Kept free of the database so the decision itself can be unit-tested: which
 * heading level a document is really structured by, what belongs to which
 * section, and what stays on the parent. The half that writes rows lives next
 * door, in ./split.ts.
 */

/** A page's content block, reduced to what the split has to look at. */
export type SplitBlock = {
  id?: string;
  type: "markdown" | "html";
  content: string;
};

/** One section of the page: its heading, and the blocks under it. */
export type PlannedSection = {
  title: string;
  level: number;
  blocks: SplitBlock[];
};

export type SplitPlan = {
  /** heading level the page is split at */
  level: number;
  /** blocks above the first section — they stay on the parent */
  intro: SplitBlock[];
  sections: PlannedSection[];
};

/**
 * More children than this and the "page" was never a document — refuse rather
 * than flood a tenant's sidebar with a few thousand pages that have to be
 * deleted one by one.
 */
export const MAX_SUBPAGES = 300;

export const NOTHING_TO_SPLIT_MESSAGE =
  "This page has no repeated heading level to split at";
export const TOO_MANY_SECTIONS_MESSAGE = `This page would split into more than ${MAX_SUBPAGES} subpages`;

/** `## Heading` at the start of a markdown block (ATX, closing #'s allowed). */
const MARKDOWN_HEADING = /^[ \t]{0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;

/** `<h2 …>Heading</h2>` at the start of an html block. */
const HTML_HEADING = /^\s*<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/i;

/** Plain text of an html snippet — the heading text without its markup. */
const htmlToText = (html: string): string =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** The heading a block STARTS with, if any — what makes a block a section. */
const leadingHeading = (
  block: SplitBlock
): { level: number; title: string } | null => {
  if (block.type === "html") {
    const match = HTML_HEADING.exec(block.content);
    if (!match) return null;
    const title = htmlToText(match[2] ?? "");
    return title ? { level: Number(match[1]), title } : null;
  }
  const firstLine = block.content
    .split("\n")
    .find((line) => line.trim().length > 0);
  if (firstLine === undefined) return null;
  const match = MARKDOWN_HEADING.exec(firstLine);
  if (!match) return null;
  const title = match[2]?.trim() ?? "";
  return title ? { level: match[1]!.length, title } : null;
};

/**
 * Remove the heading line the section is named after: the child page's title
 * carries it, and repeating it as the first line of the body reads like a
 * mistake. Returns null when nothing but the heading is left.
 */
const withoutLeadingHeading = (block: SplitBlock): SplitBlock | null => {
  if (block.type === "html") {
    const rest = block.content.replace(HTML_HEADING, "").trim();
    return rest ? { ...block, content: rest } : null;
  }
  const lines = block.content.split("\n");
  const index = lines.findIndex((line) => line.trim().length > 0);
  const rest = lines
    .slice(index + 1)
    .join("\n")
    .replace(/^\s+/, "");
  return rest.trim() ? { ...block, content: rest } : null;
};

/**
 * Pick the level to split at: the shallowest heading level that occurs more
 * than once. A document's structure is the level it repeats — splitting at a
 * level that occurs once would just move the whole page one step down the tree.
 */
const splitLevel = (blocks: SplitBlock[]): number | null => {
  const counts = new Map<number, number>();
  for (const block of blocks) {
    const heading = leadingHeading(block);
    if (!heading) continue;
    counts.set(heading.level, (counts.get(heading.level) ?? 0) + 1);
  }
  const repeated = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([level]) => level)
    .sort((a, b) => a - b);
  return repeated[0] ?? null;
};

/** Make sibling titles distinct, so a `[[reference]]` names exactly one page. */
const uniqueTitle = (title: string, taken: Set<string>): string => {
  if (!taken.has(title.toLowerCase())) {
    taken.add(title.toLowerCase());
    return title;
  }
  for (let n = 2; ; n++) {
    const candidate = `${title} (${n})`;
    if (!taken.has(candidate.toLowerCase())) {
      taken.add(candidate.toLowerCase());
      return candidate;
    }
  }
};

/**
 * Work out how a page would be split, without touching anything. Pure, so the
 * decision — which level, which section gets which block — is testable on its
 * own; `null` means the page has no structure to split at.
 */
export const planPageSplit = (blocks: SplitBlock[]): SplitPlan | null => {
  const level = splitLevel(blocks);
  if (level === null) return null;

  const intro: SplitBlock[] = [];
  const sections: PlannedSection[] = [];
  const titles = new Set<string>();

  for (const block of blocks) {
    const heading = leadingHeading(block);
    if (heading?.level === level) {
      const body = withoutLeadingHeading(block);
      sections.push({
        title: uniqueTitle(heading.title, titles),
        level,
        blocks: body ? [body] : [],
      });
      continue;
    }
    const current = sections[sections.length - 1];
    if (current) current.blocks.push(block);
    else intro.push(block);
  }

  return { level, intro, sections };
};
