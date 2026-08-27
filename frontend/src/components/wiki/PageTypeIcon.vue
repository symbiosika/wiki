<template>
  <!--
    Renders nothing at all when the page has no type, or the type has no icon
    configured — the caller does not have to guard, and rows without a type keep
    their exact previous layout.
  -->
  <span
    v-if="resolved && resolved.icon.kind !== 'none'"
    class="flex shrink-0 items-center justify-center"
    :title="resolved.label"
    :aria-label="resolved.label"
  >
    <component
      :is="resolved.icon.component"
      v-if="resolved.icon.kind === 'component'"
      :class="[size, resolved.iconClasses]"
    />
    <!--
      Emoji carry their own colours, so the palette class is deliberately not
      applied here. The size class only sets the box; the glyph inherits the
      surrounding font size and is centred in it.
    -->
    <span v-else :class="size" class="grid place-items-center leading-none">
      {{ resolved.icon.value }}
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useWiki } from '@/stores/wiki'
import { resolvePageTypeStyle } from '@/utils/pageTypeStyle'

const props = withDefaults(
  defineProps<{
    /** The page's controlled `pageType` facet; null renders nothing. */
    pageType: string | null | undefined
    /** Tailwind size classes for the icon box. */
    size?: string
  }>(),
  { size: 'h-3.5 w-3.5' },
)

const wiki = useWiki()

const resolved = computed(() =>
  resolvePageTypeStyle(props.pageType, wiki.state.config?.pageTypeStyles),
)
</script>
