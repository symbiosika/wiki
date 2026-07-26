<template>
  <aside
    class="flex w-full shrink-0 flex-col border-l border-surface-200 bg-surface-0 lg:w-80 dark:border-surface-800 dark:bg-surface-950"
  >
    <!-- header -->
    <div
      class="flex items-start gap-2 border-b border-surface-200 px-3 py-2 dark:border-surface-800"
    >
      <div class="min-w-0 flex-1">
        <p
          class="truncate text-sm font-medium text-surface-900 dark:text-surface-0"
        >
          {{ cardLabel(card.text) || $t('IdeaBoards.untitledCard') }}
        </p>
        <p class="text-xs text-surface-400 dark:text-surface-500">
          {{ card.authorLabel ?? $t('IdeaBoards.unknownAuthor') }}
        </p>
      </div>
      <button
        type="button"
        :aria-label="$t('Common.close')"
        class="rounded-md p-1 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800"
        @click="emit('close')"
      >
        <IconClose class="h-4 w-4" />
      </button>
    </div>

    <div class="flex-1 space-y-5 overflow-y-auto px-3 py-3">
      <!-- card actions -->
      <section class="space-y-2">
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="color in IDEA_CARD_COLORS"
            :key="color"
            type="button"
            :disabled="readonly"
            :aria-label="color"
            class="h-6 w-6 rounded-full border transition-transform disabled:opacity-50"
            :class="[
              swatchClass(color),
              card.color === color
                ? 'scale-110 ring-2 ring-primary ring-offset-1 dark:ring-offset-surface-950'
                : '',
            ]"
            @click="emit('update-color', color)"
          />
        </div>
        <div class="flex flex-wrap gap-2">
          <SecondaryButton
            size="small"
            :label="
              card.kind === 'heading'
                ? $t('IdeaBoards.makeNote')
                : $t('IdeaBoards.makeHeading')
            "
            :disabled="readonly"
            @click="
              emit('update-kind', card.kind === 'heading' ? 'note' : 'heading')
            "
          />
          <SecondaryButton
            v-if="!card.pageId"
            size="small"
            :label="$t('IdeaBoards.promote')"
            :disabled="readonly || !card.text.trim()"
            @click="emit('promote')"
          />
          <SecondaryButton
            v-else
            size="small"
            :label="$t('IdeaBoards.openPage')"
            @click="emit('open-page', card.pageId)"
          />
          <SecondaryButton
            size="small"
            :label="$t('Common.delete')"
            :disabled="readonly"
            @click="emit('delete')"
          />
        </div>
      </section>

      <!-- comments -->
      <section class="space-y-2">
        <h3
          class="text-[11px] font-semibold tracking-wider text-surface-400 uppercase dark:text-surface-500"
        >
          {{ $t('IdeaBoards.comments') }}
        </h3>

        <p
          v-if="comments.length === 0"
          class="text-xs text-surface-400 dark:text-surface-500"
        >
          {{ $t('IdeaBoards.noComments') }}
        </p>

        <div
          v-for="comment in comments"
          :key="comment.id"
          class="rounded-md border border-surface-200 px-2 py-1.5 dark:border-surface-700"
        >
          <div class="flex items-baseline gap-2">
            <span
              class="min-w-0 flex-1 truncate text-[11px] font-medium text-surface-500 dark:text-surface-400"
            >
              {{ comment.authorLabel ?? $t('IdeaBoards.unknownAuthor') }}
            </span>
            <span class="text-[10px] text-surface-400 dark:text-surface-500">
              {{ formatDateTime(comment.createdAt) }}
            </span>
          </div>

          <!-- inline edit, only ever offered on your own comments -->
          <template v-if="editingId === comment.id">
            <Textarea
              v-model="editText"
              rows="2"
              class="mt-1 w-full text-sm"
              @keydown.escape="cancelEdit"
            />
            <div class="mt-1 flex justify-end gap-1">
              <SecondaryButton
                size="small"
                :label="$t('Common.cancel')"
                @click="cancelEdit"
              />
              <Button
                size="small"
                :label="$t('Common.save')"
                :disabled="!editText.trim()"
                @click="saveEdit(comment.id)"
              />
            </div>
          </template>
          <template v-else>
            <p
              class="mt-0.5 text-sm whitespace-pre-wrap text-surface-800 dark:text-surface-200"
            >
              {{ comment.text }}
            </p>
            <div
              v-if="canEdit(comment) || canDelete(comment)"
              class="mt-1 flex justify-end gap-2"
            >
              <button
                v-if="canEdit(comment)"
                type="button"
                class="text-[11px] text-surface-500 hover:text-surface-800 dark:hover:text-surface-200"
                @click="startEdit(comment)"
              >
                {{ $t('Common.edit') }}
              </button>
              <button
                v-if="canDelete(comment)"
                type="button"
                class="text-[11px] text-red-500 hover:text-red-600"
                @click="emit('delete-comment', comment.id)"
              >
                {{ $t('Common.delete') }}
              </button>
            </div>
          </template>
        </div>

        <div v-if="!readonly" class="space-y-1">
          <Textarea
            v-model="newComment"
            rows="2"
            class="w-full text-sm"
            :placeholder="$t('IdeaBoards.commentPlaceholder')"
          />
          <div class="flex justify-end">
            <Button
              size="small"
              :label="$t('IdeaBoards.addComment')"
              :disabled="!newComment.trim()"
              @click="submitComment"
            />
          </div>
        </div>
      </section>

      <!-- links -->
      <section class="space-y-2">
        <h3
          class="text-[11px] font-semibold tracking-wider text-surface-400 uppercase dark:text-surface-500"
        >
          {{ $t('IdeaBoards.links') }}
        </h3>

        <p
          v-if="links.length === 0"
          class="text-xs text-surface-400 dark:text-surface-500"
        >
          {{ $t('IdeaBoards.noLinks') }}
        </p>

        <div
          v-for="link in links"
          :key="link.id"
          class="flex items-center gap-2 rounded-md border border-surface-200 px-2 py-1 text-xs dark:border-surface-700"
        >
          <span
            class="shrink-0 rounded bg-surface-100 px-1 py-0.5 text-[10px] text-surface-600 dark:bg-surface-800 dark:text-surface-300"
          >
            {{ $t(`IdeaBoards.linkType.${link.type}`) }}
          </span>
          <span class="min-w-0 flex-1 truncate text-surface-700 dark:text-surface-200">
            {{ linkLabel(link) }}
          </span>
          <button
            v-if="!readonly"
            type="button"
            :aria-label="$t('Common.remove')"
            class="shrink-0 text-surface-400 hover:text-red-500"
            @click="emit('delete-link', link.id)"
          >
            <IconClose class="h-3.5 w-3.5" />
          </button>
        </div>

        <!-- add link: another card on this board, or a wiki page -->
        <div v-if="!readonly" class="space-y-2 border-t border-surface-200 pt-2 dark:border-surface-700">
          <Select
            v-model="linkType"
            :options="linkTypeOptions"
            option-label="label"
            option-value="value"
            class="w-full"
            size="small"
          />
          <Select
            v-model="linkTargetCardId"
            :options="cardOptions"
            option-label="label"
            option-value="value"
            class="w-full"
            size="small"
            show-clear
            :placeholder="$t('IdeaBoards.linkToCard')"
          />
          <div class="space-y-1">
            <InputText
              v-model="pageQuery"
              class="w-full"
              size="small"
              :placeholder="$t('IdeaBoards.linkToPage')"
              @keydown.enter="searchPages"
            />
            <button
              v-for="result in pageResults"
              :key="result.id"
              type="button"
              class="block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-surface-100 dark:hover:bg-surface-800"
              @click="addPageLink(result)"
            >
              {{ result.title || $t('IdeaBoards.untitledPage') }}
            </button>
          </div>
          <div class="flex justify-end">
            <Button
              size="small"
              :label="$t('IdeaBoards.addLink')"
              :disabled="!linkTargetCardId"
              @click="submitCardLink"
            />
          </div>
        </div>
      </section>
    </div>
  </aside>
</template>

<script setup lang="ts">
import IconClose from '~icons/mdi/close'
import { formatDateTime } from '@/utils/date'
import { cardLabel } from '@/utils/ideaBoards'
import {
  IDEA_CARD_COLORS,
  type IdeaCard,
  type IdeaCardComment,
  type IdeaCardLink,
  type IdeaCardKind,
  type IdeaLinkType,
} from '@/types/ideaBoards'
import type { WikiSearchResult } from '@/types/wiki'

const props = defineProps<{
  card: IdeaCard
  comments: IdeaCardComment[]
  links: IdeaCardLink[]
  /** other cards on the board, for the link picker */
  otherCards: IdeaCard[]
  currentUserId: string | null
  /** true when the current user owns the board (may delete foreign comments) */
  isBoardOwner: boolean
  readonly: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'delete'): void
  (e: 'promote'): void
  (e: 'open-page', pageId: string): void
  (e: 'update-color', color: string): void
  (e: 'update-kind', kind: IdeaCardKind): void
  (e: 'add-comment', text: string): void
  (e: 'update-comment', commentId: string, text: string): void
  (e: 'delete-comment', commentId: string): void
  (e: 'add-link', input: { targetCardId?: string; targetPageId?: string; targetPageTitle?: string; type: IdeaLinkType }): void
  (e: 'delete-link', linkId: string): void
  (e: 'search-pages', query: string): void
}>()

const { t } = useI18n()

const newComment = ref('')
const editingId = ref<string | null>(null)
const editText = ref('')

const submitComment = () => {
  const text = newComment.value.trim()
  if (!text) return
  emit('add-comment', text)
  newComment.value = ''
}

/** Only the author may edit; the board owner may additionally delete. */
const canEdit = (comment: IdeaCardComment) =>
  !props.readonly && comment.createdBy === props.currentUserId

const canDelete = (comment: IdeaCardComment) =>
  !props.readonly &&
  (comment.createdBy === props.currentUserId || props.isBoardOwner)

const startEdit = (comment: IdeaCardComment) => {
  editingId.value = comment.id
  editText.value = comment.text
}

const cancelEdit = () => {
  editingId.value = null
  editText.value = ''
}

const saveEdit = (commentId: string) => {
  const text = editText.value.trim()
  if (!text) return
  emit('update-comment', commentId, text)
  cancelEdit()
}

// ---- links -----------------------------------------------------------------

const linkType = ref<IdeaLinkType>('relates')
const linkTargetCardId = ref<string | null>(null)
const pageQuery = ref('')
const pageResults = ref<WikiSearchResult[]>([])

const linkTypeOptions = computed(() =>
  (['relates', 'duplicate', 'answers', 'blocks'] as IdeaLinkType[]).map(
    (value) => ({ value, label: t(`IdeaBoards.linkType.${value}`) }),
  ),
)

const cardOptions = computed(() =>
  props.otherCards.map((card) => ({
    value: card.id,
    label: cardLabel(card.text) || t('IdeaBoards.untitledCard'),
  })),
)

const submitCardLink = () => {
  if (!linkTargetCardId.value) return
  emit('add-link', {
    targetCardId: linkTargetCardId.value,
    type: linkType.value,
  })
  linkTargetCardId.value = null
}

const searchPages = () => {
  if (!pageQuery.value.trim()) {
    pageResults.value = []
    return
  }
  emit('search-pages', pageQuery.value)
}

/** The parent hands search results back through this. */
const setPageResults = (results: WikiSearchResult[]) => {
  pageResults.value = results
}
defineExpose({ setPageResults })

const addPageLink = (result: WikiSearchResult) => {
  emit('add-link', {
    targetPageId: result.id,
    targetPageTitle: result.title,
    type: linkType.value,
  })
  pageQuery.value = ''
  pageResults.value = []
}

const linkLabel = (link: IdeaCardLink) => {
  if (link.targetCardId) {
    const target = props.otherCards.find((c) => c.id === link.targetCardId)
    if (!target) return t('IdeaBoards.deletedCard')
    return cardLabel(target.text) || t('IdeaBoards.untitledCard')
  }
  return link.targetPageTitle || t('IdeaBoards.untitledPage')
}

const swatchClass = (color: string) => {
  const map: Record<string, string> = {
    yellow: 'border-yellow-400 bg-yellow-200 dark:bg-yellow-500/40',
    green: 'border-green-400 bg-green-200 dark:bg-green-500/40',
    blue: 'border-blue-400 bg-blue-200 dark:bg-blue-500/40',
    purple: 'border-purple-400 bg-purple-200 dark:bg-purple-500/40',
    pink: 'border-pink-400 bg-pink-200 dark:bg-pink-500/40',
    neutral: 'border-surface-400 bg-surface-200 dark:bg-surface-700',
  }
  return map[color] ?? map.yellow
}
</script>
