/**
 * Structured markdown import: turn a whole folder / repository of markdown
 * files into a wiki page tree in one go.
 *
 * The framework already imports a single file (or URL) as a page. This module
 * adds the *hierarchy* on top: given a flat list of files with their relative
 * paths, it reconstructs the intended page tree and creates the pages
 * parent-first so that
 *
 *   - a folder `Foo/` and a sibling note `Foo.md` collapse into ONE page
 *     `Foo` that both holds the note's content and parents the folder's
 *     children (instead of a duplicate empty folder page next to it),
 *   - a folder note *inside* its folder (`Foo/Foo.md`, `Foo/index.md`,
 *     `Foo/README.md`, `Foo/_index.md`) fills the folder's own page rather
 *     than becoming a child called "index" / "README",
 *   - folders that only group children (no matching note) become empty
 *     container pages,
 *   - the common top-level folder can optionally be stripped so the import
 *     lands directly at the chosen base location.
 *
 * Because we control the creation order here (parents synchronously before
 * children) the folder-note merge is deterministic — unlike enqueuing one
 * async import job per file, where the folder page does not exist yet when a
 * child needs it as a parent.
 *
 * Content ingestion (markdown → blocks, optional AI post-processing, embedding)
 * is delegated to the framework's `importMarkdownAsKnowledgeText`, so imported
 * pages are indistinguishable from single-file imports.
 */
import { importMarkdownAsKnowledgeText } from "@framework/lib/knowledge/knowledge-text-import";
import { createKnowledgeText } from "@framework/lib/knowledge/knowledge-texts";

/** Hard cap on the number of files handled in one request. */
export const MAX_TREE_IMPORT_FILES = 500;

/** Leaf file names (without extension, case-insensitive) that are treated as a
 * folder's own note rather than a child page. */
const INDEX_BASENAMES = new Set(["index", "readme", "_index"]);

/** One markdown/text file plus its path relative to the dropped root. */
export interface TreeImportFile {
  /** Full relative path incl. file name, slash separated (e.g. `repo/a/b.md`). */
  path: string;
  /** Raw markdown / plain-text content of the file. */
  content: string;
}

export interface ImportMarkdownTreeOptions {
  tenantId: string;
  userId: string;
  /** Team scope (mutually exclusive with tenantWide). */
  teamId?: string;
  /** Organisation-wide scope. */
  tenantWide?: boolean;
  /** Existing page to nest the whole imported tree under. */
  baseParentId?: string;
  /** Split each page's markdown into blocks at top-level headings (default true). */
  splitIntoBlocks?: boolean;
  /** Post-processor names (e.g. `agent:<id>`) to run on each page's markdown. */
  usePostProcessors?: string[];
  /** Mirror imported pages into the RAG pipeline. */
  embeddingEnabled?: boolean;
  /** Drop the single common leading folder segment shared by every file. */
  stripCommonRoot?: boolean;
}

export interface ImportMarkdownTreeResult {
  /** Number of pages created from a file's content. */
  pagesCreated: number;
  /** Number of empty container ("folder") pages created. */
  foldersCreated: number;
  /** Files that were not imported, with a reason. */
  skipped: { path: string; reason: string }[];
  /** Ids of the pages created directly at the base location. */
  rootPageIds: string[];
}

/** One node (page) in the reconstructed tree. */
export interface PlannedNode {
  /** Lower-cased, slash-joined path — the node's identity. */
  key: string;
  /** Original-case path segments from the base location down to this node. */
  segments: string[];
  /** Display title (the last segment). */
  title: string;
  /** Markdown content, if a file maps onto this node (a "folder" otherwise). */
  content?: string;
  /** Source path of the file that provided the content (for diagnostics). */
  sourcePath?: string;
  /** Parent node key, or null when the node sits at the base location. */
  parentKey: string | null;
}

/** The result of turning a flat file list into an ordered, parent-first plan. */
export interface MarkdownTreePlan {
  /** Nodes in creation order — a parent always precedes its children. */
  ordered: PlannedNode[];
  /** Files that will not be imported, with a reason. */
  skipped: { path: string; reason: string }[];
  /** Count of content pages. */
  pageCount: number;
  /** Count of pure container ("folder") pages. */
  folderCount: number;
}

const stripExtension = (name: string): string => name.replace(/\.[^.]+$/, "");

/** Split a relative path into clean, extension-free segments. */
const toSegments = (path: string): string[] => {
  const parts = path
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== "." && s !== "..");
  if (parts.length === 0) return [];
  const last = parts.length - 1;
  parts[last] = stripExtension(parts[last]!);
  return parts.filter((s) => s.length > 0);
};

/**
 * Map a file's path segments to the page-path they represent, collapsing
 * folder notes / index files onto their folder. Returns `null` when the file
 * cannot be placed (e.g. an index file at the very root).
 */
const pagePathForFile = (segments: string[]): string[] | null => {
  if (segments.length === 0) return null;
  const leaf = segments[segments.length - 1]!.toLowerCase();
  const parent =
    segments.length >= 2 ? segments[segments.length - 2]!.toLowerCase() : null;
  // A folder note lives *inside* the folder: `Foo/index.md`, `Foo/README.md`,
  // or `Foo/Foo.md`. It fills the parent folder's own page, so drop the leaf.
  const isFolderNote =
    segments.length >= 2 && (INDEX_BASENAMES.has(leaf) || leaf === parent);
  if (isFolderNote) return segments.slice(0, -1);
  return segments;
};

/**
 * Strip the single leading segment when every file shares it (the wrapper
 * folder a whole repo/vault is dropped as). No-op unless all files agree and
 * stripping never empties a path.
 */
const stripLeadingSegment = (files: { segments: string[] }[]): void => {
  if (files.length === 0) return;
  const first = files[0]!.segments[0]?.toLowerCase();
  if (!first) return;
  const allShare = files.every(
    (f) => f.segments.length >= 2 && f.segments[0]!.toLowerCase() === first,
  );
  if (!allShare) return;
  for (const f of files) f.segments = f.segments.slice(1);
};

/**
 * Turn a flat list of markdown files into an ordered, parent-first plan of the
 * pages to create — collapsing folder notes / index files onto their folder
 * and materialising ancestor folders. Pure (no I/O) so it can be unit-tested
 * and mirrors the client-side preview in `frontend/src/utils/wikiImportTree.ts`.
 */
export const planMarkdownTree = (
  files: TreeImportFile[],
  options: { stripCommonRoot?: boolean } = {},
): MarkdownTreePlan => {
  const skipped: { path: string; reason: string }[] = [];

  // 1) Normalise paths into segments; drop entries that yield no segments.
  const normalised = files
    .map((f) => ({ file: f, segments: toSegments(f.path) }))
    .filter((f) => {
      if (f.segments.length === 0) {
        skipped.push({ path: f.file.path, reason: "empty path" });
        return false;
      }
      return true;
    });

  if (options.stripCommonRoot) stripLeadingSegment(normalised);

  // Deterministic order so a shorter sibling note (`Foo.md`) wins over an
  // in-folder note (`Foo/index.md`) when both target the same page.
  normalised.sort((a, b) => a.file.path.localeCompare(b.file.path));

  // 2) Build the node map, materialising every ancestor folder on the way.
  const nodes = new Map<string, PlannedNode>();
  const keyOf = (segments: string[]) =>
    segments.map((s) => s.toLowerCase()).join("/");

  const ensureNode = (segments: string[]): PlannedNode => {
    const key = keyOf(segments);
    let node = nodes.get(key);
    if (!node) {
      node = {
        key,
        segments,
        title: segments[segments.length - 1]!,
        parentKey: segments.length > 1 ? keyOf(segments.slice(0, -1)) : null,
      };
      nodes.set(key, node);
      // materialise ancestors so folders without a note still become pages
      if (segments.length > 1) ensureNode(segments.slice(0, -1));
    }
    return node;
  };

  for (const entry of normalised) {
    const pagePath = pagePathForFile(entry.segments);
    if (!pagePath || pagePath.length === 0) {
      skipped.push({
        path: entry.file.path,
        reason: "cannot place file at root",
      });
      continue;
    }
    const node = ensureNode(pagePath);
    const content = entry.file.content;
    if (content && content.trim().length > 0) {
      if (node.content === undefined) {
        node.content = content;
        node.sourcePath = entry.file.path;
      } else {
        // two files map onto the same page (e.g. Foo.md + Foo/index.md)
        skipped.push({
          path: entry.file.path,
          reason: `duplicate of page "${node.segments.join("/")}"`,
        });
      }
    }
  }

  // 3) Order parent-first (a parent always has fewer segments than its child).
  const ordered = [...nodes.values()].sort(
    (a, b) => a.segments.length - b.segments.length,
  );

  let pageCount = 0;
  let folderCount = 0;
  for (const node of ordered) {
    if (node.content !== undefined) pageCount++;
    else folderCount++;
  }

  return { ordered, skipped, pageCount, folderCount };
};

/**
 * Reconstruct a page tree from a flat list of markdown files and create the
 * pages parent-first. Pure structural folders become empty pages; files
 * become content pages via the framework's markdown import.
 */
export const importMarkdownTree = async (
  files: TreeImportFile[],
  options: ImportMarkdownTreeOptions,
): Promise<ImportMarkdownTreeResult> => {
  const plan = planMarkdownTree(files, {
    stripCommonRoot: options.stripCommonRoot,
  });
  const skipped = plan.skipped;

  /** Nearest already-created ancestor id, or the base location. */
  const createdIds = new Map<string, string>();
  const parentKeyOf = new Map(plan.ordered.map((n) => [n.key, n.parentKey]));
  const resolveParentId = (node: PlannedNode): string | undefined => {
    let parentKey = node.parentKey;
    while (parentKey) {
      const id = createdIds.get(parentKey);
      if (id) return id;
      parentKey = parentKeyOf.get(parentKey) ?? null;
    }
    return options.baseParentId;
  };

  let pagesCreated = 0;
  let foldersCreated = 0;
  const rootPageIds: string[] = [];

  for (const node of plan.ordered) {
    const parentId = resolveParentId(node);
    try {
      if (node.content !== undefined) {
        const { knowledgeText } = await importMarkdownAsKnowledgeText(
          { title: node.title, text: node.content, sourceUri: node.sourcePath },
          {
            tenantId: options.tenantId,
            userId: options.userId,
            teamId: options.teamId,
            tenantWide: options.tenantWide,
            parentId,
            title: node.title,
            splitIntoBlocks: options.splitIntoBlocks,
            usePostProcessors: options.usePostProcessors,
            embeddingEnabled: options.embeddingEnabled,
          },
        );
        createdIds.set(node.key, knowledgeText.id);
        pagesCreated++;
      } else {
        // structural folder with no note of its own — an empty container page
        const page = await createKnowledgeText({
          tenantId: options.tenantId,
          userId: options.userId,
          createdBy: options.userId,
          updatedBy: options.userId,
          teamId: options.teamId,
          tenantWide: options.tenantWide ?? false,
          parentId,
          title: node.title,
          text: "",
          contentMode: "blocks",
        });
        createdIds.set(node.key, page.id);
        foldersCreated++;
      }
      const createdId = createdIds.get(node.key);
      if (node.parentKey === null && createdId) {
        rootPageIds.push(createdId);
      }
    } catch (error) {
      skipped.push({
        path: node.sourcePath ?? node.segments.join("/"),
        reason: error instanceof Error ? error.message : "failed to create page",
      });
    }
  }

  return { pagesCreated, foldersCreated, skipped, rootPageIds };
};
