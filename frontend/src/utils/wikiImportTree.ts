/**
 * Client-side reconstruction of the wiki page tree produced by a folder /
 * repository markdown import.
 *
 * This MUST mirror the server logic in
 * `backend/src/lib/wiki/import-tree.ts` so the preview shown before import
 * matches exactly what the backend will create: same folder-note / index
 * collapsing, same common-root stripping, same duplicate handling.
 *
 * Used both to render the "this is how it will look" tree preview and to build
 * the request payload for `POST /wiki/import-tree`.
 */

/** Leaf names (without extension, lower-cased) treated as a folder's own note. */
const INDEX_BASENAMES = new Set(['index', 'readme', '_index'])

/** One file going into the import — full relative path plus its text content. */
export interface ImportTreeFile {
  /** Full relative path incl. file name, slash separated (e.g. `repo/a/b.md`). */
  path: string
  /** Raw markdown / text content; empty/whitespace makes the node a folder. */
  content?: string
}

/** A node (page) in the reconstructed preview tree. */
export interface ImportTreeNode {
  /** Display title (last path segment). */
  title: string
  /** Full segment path from the base location down to this node. */
  segments: string[]
  /** True when a file supplies this page's content (vs. a pure folder). */
  hasContent: boolean
  children: ImportTreeNode[]
}

export interface ImportTreeResult {
  roots: ImportTreeNode[]
  /** Files that will not be imported, with a reason. */
  skipped: { path: string; reason: string }[]
  /** Count of content pages. */
  pageCount: number
  /** Count of pure container ("folder") pages. */
  folderCount: number
}

const stripExtension = (name: string): string => name.replace(/\.[^.]+$/, '')

/** Split a relative path into clean, extension-free segments. */
export const toSegments = (path: string): string[] => {
  const parts = path
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '.' && s !== '..')
  if (parts.length === 0) return []
  const last = parts.length - 1
  parts[last] = stripExtension(parts[last]!)
  return parts.filter((s) => s.length > 0)
}

/**
 * Map a file's segments to the page-path it represents, collapsing folder
 * notes / index files onto their folder. Returns null when the file cannot be
 * placed (e.g. an index file at the very root).
 */
const pagePathForFile = (segments: string[]): string[] | null => {
  if (segments.length === 0) return null
  const leaf = segments[segments.length - 1]!.toLowerCase()
  const parent =
    segments.length >= 2 ? segments[segments.length - 2]!.toLowerCase() : null
  const isFolderNote =
    segments.length >= 2 && (INDEX_BASENAMES.has(leaf) || leaf === parent)
  if (isFolderNote) return segments.slice(0, -1)
  return segments
}

/** Drop the single leading segment when every file shares it. */
const stripLeadingSegment = (files: { segments: string[] }[]): void => {
  if (files.length === 0) return
  const first = files[0]!.segments[0]?.toLowerCase()
  if (!first) return
  const allShare = files.every(
    (f) => f.segments.length >= 2 && f.segments[0]!.toLowerCase() === first,
  )
  if (!allShare) return
  for (const f of files) f.segments = f.segments.slice(1)
}

interface InternalNode {
  segments: string[]
  title: string
  hasContent: boolean
  parentKey: string | null
  children: InternalNode[]
}

/**
 * Reconstruct the page tree for a set of markdown files. Pure structural
 * folders (no matching note) appear as nodes with `hasContent: false`.
 */
export const buildImportTree = (
  files: ImportTreeFile[],
  options: { stripCommonRoot?: boolean } = {},
): ImportTreeResult => {
  const skipped: { path: string; reason: string }[] = []

  const normalised = files
    .map((f) => ({ file: f, segments: toSegments(f.path) }))
    .filter((f) => {
      if (f.segments.length === 0) {
        skipped.push({ path: f.file.path, reason: 'empty path' })
        return false
      }
      return true
    })

  if (options.stripCommonRoot) stripLeadingSegment(normalised)

  // deterministic order: a shorter sibling note wins over an in-folder note
  normalised.sort((a, b) => a.file.path.localeCompare(b.file.path))

  const nodes = new Map<string, InternalNode>()
  const keyOf = (segments: string[]) =>
    segments.map((s) => s.toLowerCase()).join('/')

  const ensureNode = (segments: string[]): InternalNode => {
    const key = keyOf(segments)
    let node = nodes.get(key)
    if (!node) {
      const parentSegments = segments.slice(0, -1)
      node = {
        segments,
        title: segments[segments.length - 1]!,
        hasContent: false,
        parentKey: segments.length > 1 ? keyOf(parentSegments) : null,
        children: [],
      }
      nodes.set(key, node)
      if (segments.length > 1) {
        const parent = ensureNode(parentSegments)
        parent.children.push(node)
      }
    }
    return node
  }

  for (const entry of normalised) {
    const pagePath = pagePathForFile(entry.segments)
    if (!pagePath || pagePath.length === 0) {
      skipped.push({
        path: entry.file.path,
        reason: 'cannot place file at root',
      })
      continue
    }
    const node = ensureNode(pagePath)
    const hasContent =
      entry.file.content === undefined || entry.file.content.trim().length > 0
    if (hasContent) {
      if (!node.hasContent) {
        node.hasContent = true
      } else {
        skipped.push({
          path: entry.file.path,
          reason: `duplicate of "${node.segments.join('/')}"`,
        })
      }
    }
  }

  let pageCount = 0
  let folderCount = 0
  for (const node of nodes.values()) {
    if (node.hasContent) pageCount++
    else folderCount++
  }

  const toPublic = (node: InternalNode): ImportTreeNode => ({
    title: node.title,
    segments: node.segments,
    hasContent: node.hasContent,
    children: node.children
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title))
      .map(toPublic),
  })

  const roots = [...nodes.values()]
    .filter((n) => n.parentKey === null)
    .sort((a, b) => a.title.localeCompare(b.title))
    .map(toPublic)

  return { roots, skipped, pageCount, folderCount }
}
