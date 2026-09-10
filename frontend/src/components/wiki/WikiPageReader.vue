<!--
  The read-only view of a wiki page's content.

  Same content, same styling, no editor: the blocks are rendered to plain DOM
  (see utils/wikiReader) instead of being loaded into TipTap. Reading is by far
  the common case, and on a long imported page — hundreds of tables, tens of
  thousands of cells — building a ProseMirror document is what freezes the
  browser. Nothing here is proportional to anything but the markup itself.

  The rendered tree lives inside `.wiki-editor > .wiki-prose`, the same wrapper
  the editor mounts into, so the editor's (global) stylesheet applies unchanged
  and the two modes cannot drift apart visually. It also keeps the contract the
  rest of the page relies on: every top-level element carries its
  `data-block-id`, which is what deep links and the table of contents scroll to.
-->
<template>
  <div class="wiki-editor">
    <div ref="proseRef" class="wiki-prose wiki-prose--read" @click="onClick" />
  </div>
</template>

<script setup lang="ts">
import {
  collectReaderHeadings,
  renderBlocksForReading,
} from '@/utils/wikiReader'
import {
  needsAuthenticatedFetch,
  resolveImageSrc,
} from '@/components/editor/authenticatedImageSrc'
import { useWiki } from '@/stores/wiki'
import type { WikiBlock, WikiTocEntry } from '@/types/wiki'

const props = defineProps<{
  blocks: WikiBlock[]
  /** enables navigation of page references (needs the tenant to resolve by title) */
  tenantId?: string
}>()

const emit = defineEmits<{
  /** the document's headings, for the table of contents */
  toc: [headings: WikiTocEntry[]]
}>()

const { t } = useI18n()
const wiki = useWiki()
const router = useRouter()

const proseRef = ref<HTMLElement | null>(null)

/**
 * Swap in a blob URL for every image that needs our bearer token. Only the
 * rendered element changes; the real path stays on `data-src` so anything
 * walking the DOM (the PDF export does) still sees it.
 */
const resolveImages = (root: HTMLElement) => {
  for (const image of Array.from(root.querySelectorAll('img'))) {
    const src = image.getAttribute('src') ?? ''
    if (!needsAuthenticatedFetch(src)) continue
    image.setAttribute('data-src', src)
    void resolveImageSrc(src)
      .then((resolved) => image.setAttribute('src', resolved))
      .catch(() => {
        // leave the original src: the browser shows its own broken-image state
      })
  }
}

const render = () => {
  const root = proseRef.value
  if (!root) return
  root.replaceChildren(
    renderBlocksForReading(props.blocks, {
      imageDescriptionLabel: t('Editor.image.descriptionLabel'),
    }),
  )
  resolveImages(root)
  emit('toc', collectReaderHeadings(root))
}

onMounted(render)
watch(() => props.blocks, render)

/**
 * Open a page reference. Delegated from the content root rather than bound per
 * chip: a page can hold hundreds of them, and one listener is one listener.
 * Phantom references (no id yet) are resolved by title, as in the editor.
 */
const onClick = async (event: MouseEvent) => {
  const chip = (event.target as HTMLElement | null)?.closest?.(
    '[data-wiki-link]',
  ) as HTMLElement | null
  if (!chip || !props.tenantId) return
  event.preventDefault()

  const target = chip.getAttribute('data-wiki-link') ?? ''
  let pageId = chip.getAttribute('data-page-id')
  if (!pageId && target) {
    const results = await wiki.search(props.tenantId, target)
    pageId =
      results.find(
        (result) => result.title.toLowerCase() === target.toLowerCase(),
      )?.id ?? null
  }
  if (!pageId) return
  router.push({
    name: 'WikiPage',
    params: { tenantId: props.tenantId, pageId },
  })
}
</script>

<style>
/*
 * Global, not scoped: the blocks below are built as plain DOM (see
 * utils/wikiReader), so they never carry a scope attribute. The editor's own
 * stylesheet (BlockEditor.vue) is global for the same reason and does the
 * actual styling — this file only adds what applies to reading.
 */

/*
 * Skip the layout and paint of blocks that are outside the viewport.
 *
 * Building the DOM is only half of what opening a long page costs; the other
 * half is laying out and painting it, and a page of tables is tens of
 * thousands of cells the reader will never scroll to. `content-visibility`
 * defers all of that per block until the block comes near the viewport, which
 * turns the cost from "the whole page" into "one screenful".
 *
 * The `auto` in `contain-intrinsic-size` is what makes it usable: the browser
 * remembers each block's real size once it has been rendered, so the scrollbar
 * settles instead of jumping as the reader scrolls. The lengths are only the
 * first guess for a block that has never been on screen — deliberately per
 * block type, so a table is not estimated like a line of text.
 *
 * Only in reading mode: inside the editor the same property would break the
 * caret and ProseMirror's position math, both of which need real layout.
 */
.wiki-editor .wiki-prose--read > * {
  content-visibility: auto;
  contain-intrinsic-size: auto 3rem;
}
.wiki-editor .wiki-prose--read > .tableWrapper,
.wiki-editor .wiki-prose--read > figure,
.wiki-editor .wiki-prose--read > pre,
.wiki-editor .wiki-prose--read > ul,
.wiki-editor .wiki-prose--read > ol {
  contain-intrinsic-size: auto 20rem;
}
/*
 * Headings are the scroll targets of the table of contents and of deep links,
 * and they are cheap, so they keep real layout: their position is then only as
 * approximate as the blocks above them.
 */
.wiki-editor .wiki-prose--read > h1,
.wiki-editor .wiki-prose--read > h2,
.wiki-editor .wiki-prose--read > h3 {
  content-visibility: visible;
}
</style>
