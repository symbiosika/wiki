<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- header -->
    <div
      class="flex flex-wrap items-center gap-2 border-b border-surface-200 px-3 py-2 dark:border-surface-800"
    >
      <SecondaryButton size="small" :label="$t('Common.back')" @click="goBack" />

      <input
        v-model="title"
        :readonly="locked"
        class="min-w-0 flex-1 truncate bg-transparent text-base font-semibold text-surface-900 outline-none dark:text-surface-0"
        :placeholder="$t('IdeaBoards.untitledBoard')"
        @change="saveTitle"
      />

      <span
        v-if="locked"
        class="rounded bg-surface-100 px-2 py-0.5 text-xs text-surface-500 dark:bg-surface-800 dark:text-surface-400"
      >
        {{ $t('IdeaBoards.lockedBadge') }}
      </span>

      <Button size="small" :label="$t('IdeaBoards.addNote')" :disabled="locked" @click="addCard('note')">
        <template #icon><IconPlus /></template>
      </Button>
      <SecondaryButton
        size="small"
        :label="$t('IdeaBoards.addHeading')"
        :disabled="locked"
        @click="addCard('heading')"
      />
      <SecondaryButton
        size="small"
        :label="locked ? $t('IdeaBoards.unlock') : $t('IdeaBoards.lock')"
        @click="toggleLock"
      />
      <SecondaryButton
        size="small"
        :label="$t('Common.delete')"
        @click="confirmDeleteBoard"
      />
    </div>

    <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
      <!--
        Canvas. Cards are absolutely positioned, so the canvas has to be at
        least as large as the furthest card plus room to keep dragging — that is
        what `canvasSize` computes.
      -->
      <div
        ref="canvasEl"
        class="relative min-h-0 flex-1 overflow-auto"
        :class="
          background === 'grid'
            ? 'bg-[radial-gradient(circle,var(--p-surface-300)_1px,transparent_1px)] bg-[size:16px_16px] dark:bg-[radial-gradient(circle,var(--p-surface-700)_1px,transparent_1px)]'
            : 'bg-surface-50 dark:bg-surface-900'
        "
        @pointerdown="onCanvasPointerDown"
      >
        <div
          class="relative"
          :style="{
            width: `${canvasSize.width}px`,
            height: `${canvasSize.height}px`,
          }"
        >
          <IdeaCardItem
            v-for="card in cards"
            :key="card.id"
            :card="card"
            :selected="card.id === selectedCardId"
            :comment-count="commentsByCard[card.id]?.length ?? 0"
            :link-count="linksByCard[card.id]?.length ?? 0"
            :show-author="showAuthors"
            :readonly="locked"
            @select="selectCard(card)"
            @update:text="onCardText(card, $event)"
            @drag-start="startDrag(card, $event)"
          />

          <p
            v-if="!loading && cards.length === 0"
            class="absolute top-8 left-8 text-sm text-surface-400 dark:text-surface-500"
          >
            {{ $t('IdeaBoards.emptyCanvas') }}
          </p>
        </div>
      </div>

      <IdeaCardPanel
        v-if="selectedCard"
        ref="panel"
        :card="selectedCard"
        :comments="commentsByCard[selectedCard.id] ?? []"
        :links="linksByCard[selectedCard.id] ?? []"
        :other-cards="otherCards"
        :current-user-id="currentUserId"
        :is-board-owner="isBoardOwner"
        :readonly="locked"
        @close="selectedCardId = null"
        @delete="confirmDeleteCard"
        @promote="promote"
        @open-page="openPage"
        @update-color="patchSelected({ color: $event })"
        @update-kind="patchSelected({ kind: $event })"
        @add-comment="addComment"
        @update-comment="editComment"
        @delete-comment="removeComment"
        @add-link="addLink"
        @delete-link="removeLink"
        @search-pages="searchPages"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import IconPlus from '~icons/mdi/plus'
import {
  canvasSizeFor,
  nextCardSpot,
  sortCardsByStack,
} from '@/utils/ideaBoards'
import type {
  IdeaBoard,
  IdeaCard,
  IdeaCardComment,
  IdeaCardKind,
  IdeaCardLink,
  IdeaLinkType,
} from '@/types/ideaBoards'
import type { WikiSearchResult } from '@/types/wiki'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const confirm = useConfirm()
const store = useIdeaBoards()
const wiki = useWiki()
const app = useApp()

const tenantId = computed(() => String(route.params.tenantId))
const boardId = computed(() => String(route.params.boardId))

const board = ref<IdeaBoard | null>(null)
const cards = ref<IdeaCard[]>([])
const comments = ref<IdeaCardComment[]>([])
const links = ref<IdeaCardLink[]>([])
const loading = ref(false)
const title = ref('')
const selectedCardId = ref<string | null>(null)
const canvasEl = ref<HTMLElement | null>(null)
const panel = ref<{ setPageResults: (r: WikiSearchResult[]) => void } | null>(
  null,
)

const currentUserId = computed(() => app.state.user?.id ?? null)
const locked = computed(() => board.value?.settings?.locked === true)
const showAuthors = computed(() => board.value?.settings?.showAuthors !== false)
const background = computed(() => board.value?.settings?.background ?? 'grid')
const isBoardOwner = computed(
  () => !!board.value && board.value.createdBy === currentUserId.value,
)

const selectedCard = computed(
  () => cards.value.find((c) => c.id === selectedCardId.value) ?? null,
)

const otherCards = computed(() =>
  cards.value.filter((c) => c.id !== selectedCardId.value),
)

/** Comments and links grouped by card — both arrive with the board in one load. */
const commentsByCard = computed(() => {
  const map: Record<string, IdeaCardComment[]> = {}
  for (const comment of comments.value) {
    ;(map[comment.cardId] ??= []).push(comment)
  }
  return map
})

const linksByCard = computed(() => {
  const map: Record<string, IdeaCardLink[]> = {}
  for (const link of links.value) {
    ;(map[link.sourceCardId] ??= []).push(link)
  }
  return map
})

const canvasSize = computed(() => canvasSizeFor(cards.value))

const load = async () => {
  loading.value = true
  try {
    const detail = await store.getBoard(tenantId.value, boardId.value)
    board.value = detail.board
    cards.value = detail.cards
    comments.value = detail.comments
    links.value = detail.links
    title.value = detail.board.title
  } catch {
    toast.add({
      severity: 'error',
      summary: t('IdeaBoards.loadError'),
      life: 4000,
    })
    goBack()
  } finally {
    loading.value = false
  }
}

onMounted(load)

const goBack = () =>
  router.push({ name: 'IdeaBoards', params: { tenantId: tenantId.value } })

const openPage = (pageId: string) =>
  router.push({
    name: 'WikiPage',
    params: { tenantId: tenantId.value, pageId },
  })

// ---- board -----------------------------------------------------------------

const saveTitle = async () => {
  const next = title.value.trim()
  if (!board.value || !next || next === board.value.title) {
    title.value = board.value?.title ?? ''
    return
  }
  try {
    board.value = await store.updateBoard(tenantId.value, boardId.value, {
      title: next,
    })
  } catch {
    toast.add({ severity: 'error', summary: t('Common.update.error'), life: 4000 })
  }
}

const toggleLock = async () => {
  if (!board.value) return
  try {
    board.value = await store.updateBoard(tenantId.value, boardId.value, {
      settings: { ...board.value.settings, locked: !locked.value },
    })
  } catch {
    toast.add({ severity: 'error', summary: t('Common.update.error'), life: 4000 })
  }
}

const confirmDeleteBoard = () => {
  confirm.require({
    message: t('IdeaBoards.confirmDeleteBoard'),
    header: t('Common.confirm'),
    rejectProps: { label: t('Common.cancel'), severity: 'secondary', outlined: true },
    acceptProps: { label: t('Common.delete') },
    accept: async () => {
      try {
        await store.deleteBoard(tenantId.value, boardId.value)
        goBack()
      } catch {
        toast.add({
          severity: 'error',
          summary: t('Common.messages.error'),
          life: 4000,
        })
      }
    },
  })
}

// ---- cards -----------------------------------------------------------------

const addCard = async (kind: IdeaCardKind) => {
  const { x, y } = nextCardSpot(
    {
      left: canvasEl.value?.scrollLeft ?? 0,
      top: canvasEl.value?.scrollTop ?? 0,
    },
    cards.value.length,
  )
  try {
    const card = await store.createCard(tenantId.value, boardId.value, {
      kind,
      x,
      y,
      color: kind === 'heading' ? 'neutral' : 'yellow',
      width: kind === 'heading' ? 320 : 220,
    })
    cards.value.push(card)
    selectedCardId.value = card.id
  } catch {
    toast.add({
      severity: 'error',
      summary: t('IdeaBoards.cardError'),
      life: 4000,
    })
  }
}

const selectCard = (card: IdeaCard) => {
  selectedCardId.value = card.id
}

/**
 * Clicking the empty canvas clears the selection. Cards stop propagation on
 * pointerdown, so this only ever fires for the background itself.
 */
const onCanvasPointerDown = () => {
  selectedCardId.value = null
}

/** Text edits are debounced per card so typing isn't one request per keystroke. */
const textTimers = new Map<string, ReturnType<typeof setTimeout>>()

const onCardText = (card: IdeaCard, text: string) => {
  card.text = text
  const existing = textTimers.get(card.id)
  if (existing) clearTimeout(existing)
  textTimers.set(
    card.id,
    setTimeout(() => {
      textTimers.delete(card.id)
      void persistCard(card.id, { text })
    }, 600),
  )
}

const persistCard = async (
  cardId: string,
  patch: Partial<IdeaCard>,
): Promise<void> => {
  try {
    const updated = await store.updateCard(
      tenantId.value,
      boardId.value,
      cardId,
      patch as never,
    )
    const index = cards.value.findIndex((c) => c.id === cardId)
    if (index >= 0) {
      // keep the text the user may have typed since this request went out
      const local = cards.value[index]!
      cards.value[index] = {
        ...updated,
        text: textTimers.has(cardId) ? local.text : updated.text,
      }
    }
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.update.error'),
      life: 4000,
    })
    await load()
  }
}

const patchSelected = (patch: { color?: string; kind?: IdeaCardKind }) => {
  if (!selectedCard.value) return
  void persistCard(selectedCard.value.id, patch as Partial<IdeaCard>)
}

const confirmDeleteCard = () => {
  const card = selectedCard.value
  if (!card) return
  confirm.require({
    message: t('IdeaBoards.confirmDeleteCard'),
    header: t('Common.confirm'),
    rejectProps: { label: t('Common.cancel'), severity: 'secondary', outlined: true },
    acceptProps: { label: t('Common.delete') },
    accept: async () => {
      try {
        await store.deleteCard(tenantId.value, boardId.value, card.id)
        cards.value = cards.value.filter((c) => c.id !== card.id)
        comments.value = comments.value.filter((c) => c.cardId !== card.id)
        links.value = links.value.filter(
          (l) => l.sourceCardId !== card.id && l.targetCardId !== card.id,
        )
        selectedCardId.value = null
      } catch {
        toast.add({
          severity: 'error',
          summary: t('Common.messages.error'),
          life: 4000,
        })
      }
    },
  })
}

// ---- dragging --------------------------------------------------------------

interface DragState {
  cardId: string
  pointerId: number
  /** pointer position where the drag started */
  startX: number
  startY: number
  /** card position where the drag started */
  originX: number
  originY: number
  moved: boolean
}

let drag: DragState | null = null

/**
 * Dragging only starts on a card's grip strip (see IdeaCardItem), so clicking
 * into the text never moves a card. The card position is updated locally while
 * the pointer moves and written once on release — a PUT per pointermove would
 * be hundreds of requests for a single drag.
 */
const startDrag = (card: IdeaCard, event: PointerEvent) => {
  if (locked.value) return
  drag = {
    cardId: card.id,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: card.x,
    originY: card.y,
    moved: false,
  }
  selectedCardId.value = card.id
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
  window.addEventListener('pointercancel', onDragEnd)
}

const onDragMove = (event: PointerEvent) => {
  if (!drag || event.pointerId !== drag.pointerId) return
  const card = cards.value.find((c) => c.id === drag!.cardId)
  if (!card) return
  const dx = event.clientX - drag.startX
  const dy = event.clientY - drag.startY
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return
  drag.moved = true
  card.x = Math.max(0, Math.round(drag.originX + dx))
  card.y = Math.max(0, Math.round(drag.originY + dy))
}

const onDragEnd = async (event: PointerEvent) => {
  if (!drag || event.pointerId !== drag.pointerId) return
  const finished = drag
  drag = null
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  window.removeEventListener('pointercancel', onDragEnd)
  if (!finished.moved) return

  const card = cards.value.find((c) => c.id === finished.cardId)
  if (!card) return
  // a dragged card also comes to the front, which is a separate endpoint
  try {
    await store.updateCard(tenantId.value, boardId.value, card.id, {
      x: card.x,
      y: card.y,
    })
    const fronted = await store.bringToFront(
      tenantId.value,
      boardId.value,
      card.id,
    )
    const index = cards.value.findIndex((c) => c.id === card.id)
    if (index >= 0) cards.value[index] = { ...cards.value[index]!, z: fronted.z }
    sortCards()
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.update.error'),
      life: 4000,
    })
    await load()
  }
}

/** Render order is the stacking order; the backend sorts the same way. */
const sortCards = () => {
  cards.value = sortCardsByStack(cards.value)
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  window.removeEventListener('pointercancel', onDragEnd)
  for (const timer of textTimers.values()) clearTimeout(timer)
})

// ---- comments --------------------------------------------------------------

const addComment = async (text: string) => {
  if (!selectedCard.value) return
  try {
    const comment = await store.addComment(
      tenantId.value,
      boardId.value,
      selectedCard.value.id,
      text,
    )
    comments.value.push(comment)
  } catch {
    toast.add({
      severity: 'error',
      summary: t('IdeaBoards.commentError'),
      life: 4000,
    })
  }
}

const editComment = async (commentId: string, text: string) => {
  try {
    const updated = await store.updateComment(
      tenantId.value,
      boardId.value,
      commentId,
      text,
    )
    const index = comments.value.findIndex((c) => c.id === commentId)
    if (index >= 0) comments.value[index] = updated
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.update.error'),
      life: 4000,
    })
  }
}

const removeComment = async (commentId: string) => {
  try {
    await store.deleteComment(tenantId.value, boardId.value, commentId)
    comments.value = comments.value.filter((c) => c.id !== commentId)
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.messages.error'),
      life: 4000,
    })
  }
}

// ---- links -----------------------------------------------------------------

const addLink = async (input: {
  targetCardId?: string
  targetPageId?: string
  targetPageTitle?: string
  type: IdeaLinkType
}) => {
  if (!selectedCard.value) return
  try {
    const link = await store.createLink(
      tenantId.value,
      boardId.value,
      selectedCard.value.id,
      input,
    )
    links.value.push(link)
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: t('IdeaBoards.linkError'),
      detail: error instanceof Error ? error.message : undefined,
      life: 4000,
    })
  }
}

const removeLink = async (linkId: string) => {
  try {
    await store.deleteLink(tenantId.value, boardId.value, linkId)
    links.value = links.value.filter((l) => l.id !== linkId)
  } catch {
    toast.add({
      severity: 'error',
      summary: t('Common.messages.error'),
      life: 4000,
    })
  }
}

const searchPages = async (query: string) => {
  try {
    const results = await wiki.search(tenantId.value, query)
    panel.value?.setPageResults(results.slice(0, 8))
  } catch {
    panel.value?.setPageResults([])
  }
}

// ---- wiki bridge -----------------------------------------------------------

const promote = async () => {
  const card = selectedCard.value
  if (!card) return
  try {
    const result = await store.promoteCard(
      tenantId.value,
      boardId.value,
      card.id,
    )
    const index = cards.value.findIndex((c) => c.id === card.id)
    if (index >= 0) cards.value[index] = result.card
    toast.add({
      severity: 'success',
      summary: t('IdeaBoards.promoted'),
      life: 3000,
    })
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: t('IdeaBoards.promoteError'),
      detail: error instanceof Error ? error.message : undefined,
      life: 4000,
    })
  }
}
</script>
