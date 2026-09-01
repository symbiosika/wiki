import { defineStore } from 'pinia'
import {
  applyTheme,
  getStoredTheme,
  resolveDark,
  storeTheme,
  type ThemePreference,
} from '@/utils/theme'

/**
 * Reactive wrapper around the theme helpers in `utils/theme`. The initial
 * class is set by a tiny inline script in index.html to avoid a flash of the
 * wrong theme before the app mounts; this store keeps it in sync afterwards
 * and reacts to the "system" appearance changing while the app is open.
 */
export const useTheme = defineStore('theme', () => {
  const preference = ref<ThemePreference>(getStoredTheme())
  const isDark = ref(resolveDark(preference.value))

  let media: MediaQueryList | null = null

  const apply = () => {
    applyTheme(preference.value)
    isDark.value = resolveDark(preference.value)
  }

  const onSystemChange = () => {
    if (preference.value === 'system') apply()
  }

  /**
   * Change the user's preference, persisting it by default.
   *
   * `persist: false` is for a preference that is not the user's choice but the
   * host application's — a Microsoft Teams tab reports its own light/dark
   * setting, and writing that into localStorage would silently overwrite what
   * the same person picked in their browser.
   */
  const setPreference = (
    pref: ThemePreference,
    options: { persist?: boolean } = {},
  ) => {
    preference.value = pref
    if (options.persist !== false) storeTheme(pref)
    apply()
  }

  /** Apply the stored preference and start listening for system changes. */
  const init = () => {
    apply()
    if (typeof window !== 'undefined' && !media) {
      media = window.matchMedia('(prefers-color-scheme: dark)')
      media.addEventListener('change', onSystemChange)
    }
  }

  return { preference, isDark, setPreference, init }
})
