import { defineStore } from 'pinia'

/**
 * State for the "Chat with AI" wiki assistant.
 *
 * The chat is a slide-over panel mounted once in the layout and opened from the
 * button above the sidebar search. It has two modes that toggle which tools the
 * backend agent may use:
 *   - "read": look knowledge up only (safe default)
 *   - "edit": additionally create / edit / delete wiki pages
 *
 * Like the global read-only switch, the mode always starts on the safe side
 * ("read") on every app load and is not persisted — enabling edits is a
 * conscious, per-session choice.
 */
export type AiChatMode = 'read' | 'edit'

export const useAiChat = defineStore('ai-chat', () => {
  const isOpen = ref(false)
  const mode = ref<AiChatMode>('read')

  const open = () => {
    isOpen.value = true
  }
  const close = () => {
    isOpen.value = false
  }
  const toggle = () => {
    isOpen.value = !isOpen.value
  }

  const setMode = (value: AiChatMode) => {
    mode.value = value
  }
  const toggleMode = () => {
    mode.value = mode.value === 'read' ? 'edit' : 'read'
  }

  return { isOpen, mode, open, close, toggle, setMode, toggleMode }
})
