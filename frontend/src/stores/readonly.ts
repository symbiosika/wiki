import { defineStore } from 'pinia'

/**
 * Global read-only mode.
 *
 * When active, the whole app is view-only: the block editor and page title are
 * locked and no edit lock is taken on the pages you open. It is a deliberate
 * safety switch so casual browsing never accidentally changes a document, and
 * it underpins the "only one person edits a document at a time" guarantee.
 *
 * It always starts ON when the app is opened (a fresh app load resets it) and
 * is toggled centrally from the sidebar menu. The choice is intentionally not
 * persisted across reloads: opening the app should always be read-only by
 * default, so the user has to consciously enable editing each session.
 */
export const useReadOnly = defineStore('readonly', () => {
  // active by default on every app open
  const readOnly = ref(true)

  const setReadOnly = (value: boolean) => {
    readOnly.value = value
  }

  const toggle = () => setReadOnly(!readOnly.value)

  return { readOnly, setReadOnly, toggle }
})
