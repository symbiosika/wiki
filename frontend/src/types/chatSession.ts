/**
 * Types for the persisted chat sessions used by the "Fragen" view.
 *
 * Mirrors `backend/src/lib/chat-sessions/store.ts`.
 */

export interface ChatSession {
  id: string
  /** derived from the first question, or renamed by the user */
  title: string | null
  createdAt: string
  updatedAt: string
  /** first words of the opening question — shown until a title exists */
  preview: string | null
}

/** A stored message in the AI-SDK `UIMessage` shape. */
export interface ChatSessionMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  parts: unknown[]
}

export interface ChatSessionDetail {
  session: ChatSession
  messages: ChatSessionMessage[]
}

/** Best label for a session: its title, else its preview, else a fallback. */
export const sessionLabel = (
  session: ChatSession,
  fallback: string,
): string => session.title?.trim() || session.preview?.trim() || fallback
