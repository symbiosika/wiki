<script setup lang="ts">
/**
 * Renders a markdown string as nicely styled, sanitized HTML.
 *
 * Use this anywhere the app displays markdown that isn't edited in the TipTap
 * editor: AI chat answers, note previews, read-only blocks, etc. The heavy
 * lifting (parsing + sanitizing) lives in `utils/markdown.ts`; the look comes
 * from the `.md-body` styles in `assets/base.css`.
 *
 * The markdown is parsed reactively, so streaming content (e.g. an assistant
 * reply arriving token by token) re-renders as it grows.
 */
import { renderMarkdown, renderMarkdownInline } from '@/utils/markdown'
import {
  needsAuthenticatedFetch,
  resolveImageSrc,
} from '@/components/editor/authenticatedImageSrc'

const props = withDefaults(
  defineProps<{
    /** Raw markdown source. */
    content: string
    /**
     * Render inline (no wrapping block elements) — handy for single-line
     * labels. Defaults to full block-level rendering.
     */
    inline?: boolean
  }>(),
  { inline: false },
)

const html = computed(() =>
  props.inline
    ? renderMarkdownInline(props.content)
    : renderMarkdown(props.content),
)

/**
 * Markdown can embed authenticated image paths, and an `<img src>` cannot send
 * a bearer token — inside a Microsoft Teams tab those images would all 401. The
 * rendered HTML arrives through `v-html`, so there is no binding to attach a
 * resolved source to; the elements are patched after each render instead.
 *
 * Read-only display, so patching the DOM is safe here: nothing serialises this
 * markup back into stored content.
 */
const container = ref<HTMLElement | null>(null)

watch(
  [html, container],
  async () => {
    const root = container.value
    if (!root) return
    await nextTick()

    for (const image of Array.from(root.querySelectorAll('img'))) {
      const src = image.getAttribute('src') ?? ''
      if (!needsAuthenticatedFetch(src)) continue

      image.setAttribute('data-src', src)
      try {
        image.setAttribute('src', await resolveImageSrc(src))
      } catch {
        // Leave the original source: the browser shows its own broken-image
        // state, which is more honest than an empty element.
      }
    }
  },
  { immediate: true },
)
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- input is sanitized in utils/markdown.ts -->
  <div ref="container" class="md-body" v-html="html" />
</template>
