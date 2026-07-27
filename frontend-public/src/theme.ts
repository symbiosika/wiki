/**
 * Light / dark appearance.
 *
 * Mirrors `frontend/src/utils/theme.ts` — same `.app-dark` class on <html> and
 * the same localStorage key on purpose: both apps are served from one origin,
 * so a visitor who picked dark in the wiki finds the documentation dark too.
 *
 * "system" is the default and follows the OS, including live changes while the
 * page is open.
 */
import { ref, readonly } from 'vue'

export type ThemePreference = 'system' | 'light' | 'dark'

export const THEME_KEY = 'wiki:theme'
export const DARK_CLASS = 'app-dark'

const isThemePreference = (value: unknown): value is ThemePreference =>
  value === 'system' || value === 'light' || value === 'dark'

const readStored = (): ThemePreference => {
  try {
    const value = localStorage.getItem(THEME_KEY)
    return isThemePreference(value) ? value : 'system'
  } catch {
    // Safari in private mode throws on localStorage access — the theme is not
    // worth failing over, so fall back to following the system.
    return 'system'
  }
}

const prefersDark = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches

const resolveDark = (pref: ThemePreference): boolean =>
  pref === 'dark' || (pref === 'system' && prefersDark())

const preference = ref<ThemePreference>('system')

const apply = () => {
  document.documentElement.classList.toggle(
    DARK_CLASS,
    resolveDark(preference.value),
  )
}

/** Current preference (not the resolved light/dark result). */
export const themePreference = readonly(preference)

/** True when the page is currently rendered dark, whatever the preference. */
export const isDark = () => resolveDark(preference.value)

export const setTheme = (pref: ThemePreference) => {
  preference.value = pref
  try {
    localStorage.setItem(THEME_KEY, pref)
  } catch {
    // non-persistent is still better than not switching at all
  }
  apply()
}

/**
 * Cycle light → dark → system. Three states rather than a boolean, so a
 * visitor can hand control back to the OS after overriding it once.
 */
export const cycleTheme = () => {
  const next: Record<ThemePreference, ThemePreference> = {
    system: 'light',
    light: 'dark',
    dark: 'system',
  }
  setTheme(next[preference.value])
}

/** Read the stored choice and start following the OS while "system". */
export const initTheme = () => {
  preference.value = readStored()
  apply()

  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      if (preference.value === 'system') apply()
    })
}
