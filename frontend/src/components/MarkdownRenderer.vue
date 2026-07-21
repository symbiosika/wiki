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
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- input is sanitized in utils/markdown.ts -->
  <div class="md-body" v-html="html" />
</template>
