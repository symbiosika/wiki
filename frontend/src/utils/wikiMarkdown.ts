/**
 * Client-side "copy as markdown" for a wiki page.
 *
 * Turns the live editor blocks into a single markdown document — the same
 * representation the backend materializes for search/embedding (see the
 * framework's `materializeBlocksText`) and the MCP server hands to AI agents.
 * Mirroring it here means the button reflects unsaved edits without waiting for
 * an autosave round-trip.
 *
 * HTML blocks are converted to markdown with turndown (GFM: tables, strike,
 * task lists); markdown blocks are kept verbatim. Everything is dynamically
 * imported so the turndown payload only loads when a user actually copies.
 */
import type { WikiBlock } from '@/types/wiki'

/**
 * Assemble a page's markdown from its blocks, optionally prefixed with the
 * title as an H1 so the copied text is a self-contained document.
 */
export const blocksToMarkdown = async (
  blocks: WikiBlock[],
  title?: string,
): Promise<string> => {
  const [{ default: TurndownService }, { gfm }] = await Promise.all([
    import('turndown'),
    import('turndown-plugin-gfm'),
  ])

  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  })
  turndown.use(gfm)

  const body = blocks
    .map((block) =>
      block.type === 'html'
        ? turndown.turndown(block.content).trim()
        : block.content.trim(),
    )
    .filter((part) => part.length > 0)
    .join('\n\n')

  const heading = title?.trim()
  return heading ? `# ${heading}\n\n${body}`.trim() : body
}
