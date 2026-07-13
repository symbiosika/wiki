<template>
  <div
    v-if="hasAnything"
    class="mt-10 border-t border-surface-200 pt-6 dark:border-surface-700"
  >
    <!-- backlinks: pages linking here -->
    <section v-if="backlinks.length" class="mb-6">
      <h2
        class="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-surface-500 uppercase dark:text-surface-400"
      >
        <IconBacklink class="h-4 w-4" />
        {{ $t('Wiki.references.backlinks') }}
        <span class="font-normal text-surface-400"
          >({{ backlinks.length }})</span
        >
      </h2>
      <ul class="flex flex-col gap-1">
        <li v-for="link in backlinks" :key="link.page.id">
          <button
            type="button"
            class="w-full truncate rounded-md px-2 py-1 text-left text-sm text-surface-700 transition-colors hover:bg-surface-100 hover:text-primary dark:text-surface-300 dark:hover:bg-surface-800"
            @click="open(link.page.id)"
          >
            {{ link.page.title || $t('Wiki.untitled') }}
          </button>
        </li>
      </ul>
    </section>

    <!-- outgoing links -->
    <section v-if="links.length" class="mb-6">
      <h2
        class="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-surface-500 uppercase dark:text-surface-400"
      >
        <IconLink class="h-4 w-4" />
        {{ $t('Wiki.references.outgoing') }}
        <span class="font-normal text-surface-400">({{ links.length }})</span>
      </h2>
      <ul class="flex flex-col gap-1">
        <li
          v-for="(link, index) in links"
          :key="`${link.targetTitle}:${index}`"
        >
          <button
            v-if="link.resolved && link.page"
            type="button"
            class="w-full truncate rounded-md px-2 py-1 text-left text-sm text-surface-700 transition-colors hover:bg-surface-100 hover:text-primary dark:text-surface-300 dark:hover:bg-surface-800"
            @click="open(link.page.id)"
          >
            {{ link.page.title || $t('Wiki.untitled') }}
          </button>
          <span
            v-else
            class="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-surface-400 dark:text-surface-500"
            :title="$t('Wiki.references.phantomHint')"
          >
            {{ link.targetTitle }}
            <span class="text-xs italic">{{
              $t('Wiki.references.phantom')
            }}</span>
          </span>
        </li>
      </ul>
    </section>

    <!-- related (semantic) -->
    <section v-if="related.length">
      <h2
        class="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-surface-500 uppercase dark:text-surface-400"
      >
        <IconRelated class="h-4 w-4" />
        {{ $t('Wiki.references.related') }}
      </h2>
      <ul class="flex flex-col gap-1">
        <li v-for="page in related" :key="page.id">
          <button
            type="button"
            class="w-full truncate rounded-md px-2 py-1 text-left text-sm text-surface-700 transition-colors hover:bg-surface-100 hover:text-primary dark:text-surface-300 dark:hover:bg-surface-800"
            @click="open(page.id)"
          >
            {{ page.title || $t('Wiki.untitled') }}
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import IconLink from '~icons/mdi/link-variant'
import IconBacklink from '~icons/mdi/arrow-left-top'
import IconRelated from '~icons/mdi/lightbulb-on-outline'
import { useWiki } from '@/stores/wiki'
import type {
  WikiBacklink,
  WikiOutgoingLink,
  WikiRelatedPage,
} from '@/types/wiki'

const props = defineProps<{
  tenantId: string
  pageId: string
  /** bump to force a refetch (e.g. after the page content was saved) */
  refreshKey?: number | string
}>()

const wiki = useWiki()
const router = useRouter()

const links = ref<WikiOutgoingLink[]>([])
const backlinks = ref<WikiBacklink[]>([])
const related = ref<WikiRelatedPage[]>([])

const hasAnything = computed(
  () => links.value.length || backlinks.value.length || related.value.length,
)

const load = async () => {
  if (!props.tenantId || !props.pageId) return
  const pageId = props.pageId
  // fetch independently so one empty/failing source doesn't hide the others
  const [linksResult, backlinksResult, relatedResult] =
    await Promise.allSettled([
      wiki.getLinks(props.tenantId, pageId),
      wiki.getBacklinks(props.tenantId, pageId),
      wiki.getRelated(props.tenantId, pageId),
    ])
  // ignore results for a page we've since navigated away from
  if (props.pageId !== pageId) return
  links.value = linksResult.status === 'fulfilled' ? linksResult.value : []
  backlinks.value =
    backlinksResult.status === 'fulfilled' ? backlinksResult.value : []
  related.value =
    relatedResult.status === 'fulfilled' ? relatedResult.value : []
}

const open = (pageId: string) => {
  router.push({
    name: 'WikiPage',
    params: { tenantId: props.tenantId, pageId },
  })
}

watch(() => [props.pageId, props.refreshKey], load, { immediate: true })
</script>
