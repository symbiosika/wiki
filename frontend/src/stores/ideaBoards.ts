import { defineStore } from 'pinia'
import { fetcher } from '@/utils/fetcher'
import type {
  IdeaBoard,
  IdeaBoardDetail,
  IdeaBoardInput,
  IdeaCard,
  IdeaCardComment,
  IdeaCardInput,
  IdeaCardLink,
  IdeaCardLinkInput,
} from '@/types/ideaBoards'

const api = (tenantId: string) => `/api/v1/tenant/${tenantId}/idea-boards`

/**
 * Idea boards.
 *
 * The list of boards is kept in the store; a single board's content lives in
 * the view that renders it, because every card mutation returns the updated
 * card and the view patches it in place — re-fetching the whole board after
 * each keystroke or drag would fight the user's own edits.
 */
export const useIdeaBoards = defineStore('ideaBoards', () => {
  const boards = ref<IdeaBoard[]>([])
  const loading = ref(false)

  const loadBoards = async (tenantId: string) => {
    loading.value = true
    try {
      boards.value = await fetcher.get<IdeaBoard[]>(api(tenantId))
    } finally {
      loading.value = false
    }
  }

  const createBoard = async (tenantId: string, input: IdeaBoardInput) => {
    const board = await fetcher.post<IdeaBoard>(api(tenantId), input)
    await loadBoards(tenantId)
    return board
  }

  const getBoard = (tenantId: string, boardId: string) =>
    fetcher.get<IdeaBoardDetail>(`${api(tenantId)}/${boardId}`)

  const updateBoard = (
    tenantId: string,
    boardId: string,
    input: Partial<IdeaBoardInput>,
  ) => fetcher.put<IdeaBoard>(`${api(tenantId)}/${boardId}`, input)

  const deleteBoard = async (tenantId: string, boardId: string) => {
    await fetcher.delete(`${api(tenantId)}/${boardId}`)
    await loadBoards(tenantId)
  }

  // ---- cards ---------------------------------------------------------------

  const createCard = (
    tenantId: string,
    boardId: string,
    input: IdeaCardInput,
  ) => fetcher.post<IdeaCard>(`${api(tenantId)}/${boardId}/cards`, input)

  const updateCard = (
    tenantId: string,
    boardId: string,
    cardId: string,
    input: IdeaCardInput & { pageId?: string | null },
  ) =>
    fetcher.put<IdeaCard>(
      `${api(tenantId)}/${boardId}/cards/${cardId}`,
      input,
    )

  const bringToFront = (tenantId: string, boardId: string, cardId: string) =>
    fetcher.post<IdeaCard>(
      `${api(tenantId)}/${boardId}/cards/${cardId}/front`,
      {},
    )

  const deleteCard = (tenantId: string, boardId: string, cardId: string) =>
    fetcher.delete(`${api(tenantId)}/${boardId}/cards/${cardId}`)

  // ---- comments ------------------------------------------------------------

  const listComments = (tenantId: string, boardId: string, cardId: string) =>
    fetcher.get<IdeaCardComment[]>(
      `${api(tenantId)}/${boardId}/cards/${cardId}/comments`,
    )

  const addComment = (
    tenantId: string,
    boardId: string,
    cardId: string,
    text: string,
  ) =>
    fetcher.post<IdeaCardComment>(
      `${api(tenantId)}/${boardId}/cards/${cardId}/comments`,
      { text },
    )

  const updateComment = (
    tenantId: string,
    boardId: string,
    commentId: string,
    text: string,
  ) =>
    fetcher.put<IdeaCardComment>(
      `${api(tenantId)}/${boardId}/comments/${commentId}`,
      { text },
    )

  const deleteComment = (
    tenantId: string,
    boardId: string,
    commentId: string,
  ) => fetcher.delete(`${api(tenantId)}/${boardId}/comments/${commentId}`)

  // ---- links ---------------------------------------------------------------

  const createLink = (
    tenantId: string,
    boardId: string,
    cardId: string,
    input: IdeaCardLinkInput,
  ) =>
    fetcher.post<IdeaCardLink>(
      `${api(tenantId)}/${boardId}/cards/${cardId}/links`,
      input,
    )

  const deleteLink = (tenantId: string, boardId: string, linkId: string) =>
    fetcher.delete(`${api(tenantId)}/${boardId}/links/${linkId}`)

  // ---- wiki bridge ---------------------------------------------------------

  const promoteCard = (
    tenantId: string,
    boardId: string,
    cardId: string,
    input: { title?: string; parentId?: string | null } = {},
  ) =>
    fetcher.post<{ card: IdeaCard; pageId: string }>(
      `${api(tenantId)}/${boardId}/cards/${cardId}/promote`,
      input,
    )

  return {
    boards,
    loading,
    loadBoards,
    createBoard,
    getBoard,
    updateBoard,
    deleteBoard,
    createCard,
    updateCard,
    bringToFront,
    deleteCard,
    listComments,
    addComment,
    updateComment,
    deleteComment,
    createLink,
    deleteLink,
    promoteCard,
  }
})
