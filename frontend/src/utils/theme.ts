/**
 * Theme handling.
 *
 * The user can force a light or dark appearance or follow the operating
 * system ("system"). The choice is stored per-browser in localStorage and
 * applied by toggling the `.app-dark` class on <html>; both the Tailwind
 * `dark:` variant and the PrimeVue design tokens key off that class
 * (see `assets/base.css`).
 */

export type ThemePreference = 'system' | 'light' | 'dark'

export const THEME_KEY = 'wiki:theme'
export const DARK_CLASS = 'app-dark'

const isThemePreference = (value: unknown): value is ThemePreference =>
  value === 'system' || value === 'light' || value === 'dark'

/** Read the stored preference, falling back to "system". */
export const getStoredTheme = (): ThemePreference => {
  if (typeof localStorage === 'undefined') return 'system'
  const value = localStorage.getItem(THEME_KEY)
  return isThemePreference(value) ? value : 'system'
}

/** Persist the preference for future visits. */
export const storeTheme = (pref: ThemePreference) => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(THEME_KEY, pref)
  }
}

/** Whether the operating system currently prefers a dark appearance. */
export const prefersDark = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches

/** Resolve a preference to a concrete light/dark decision. */
export const resolveDark = (pref: ThemePreference): boolean =>
  pref === 'dark' || (pref === 'system' && prefersDark())

/** Apply a preference by toggling the `.app-dark` class on <html>. */
export const applyTheme = (pref: ThemePreference) => {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle(DARK_CLASS, resolveDark(pref))
}
