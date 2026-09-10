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
    <div ref="proseRef" class="wiki-prose" @click="onClick" />
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
