import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DARK_CLASS,
  THEME_KEY,
  cycleTheme,
  initTheme,
  isDark,
  setTheme,
  themePreference,
} from './theme'

/** Pretend the OS prefers dark (or not) for the duration of a test. */
const mockSystemDark = (dark: boolean) => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: dark,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  )
}

const isDarkClassSet = () =>
  document.documentElement.classList.contains(DARK_CLASS)

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove(DARK_CLASS)
    mockSystemDark(false)
    setTheme('system')
  })

  it('follows the system when set to "system"', () => {
    mockSystemDark(true)
    setTheme('system')
    expect(isDark()).toBe(true)
    expect(isDarkClassSet()).toBe(true)

    mockSystemDark(false)
    setTheme('system')
    expect(isDark()).toBe(false)
    expect(isDarkClassSet()).toBe(false)
  })

  it('an explicit choice overrides the system', () => {
    mockSystemDark(true)
    setTheme('light')
    expect(isDark()).toBe(false)
    expect(isDarkClassSet()).toBe(false)

    mockSystemDark(false)
    setTheme('dark')
    expect(isDark()).toBe(true)
    expect(isDarkClassSet()).toBe(true)
  })

  it('persists the choice', () => {
    setTheme('dark')
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
  })

  it('restores the stored choice on init', () => {
    localStorage.setItem(THEME_KEY, 'dark')
    initTheme()
    expect(themePreference.value).toBe('dark')
    expect(isDarkClassSet()).toBe(true)
  })

  it('falls back to "system" for a missing or junk stored value', () => {
    initTheme()
    expect(themePreference.value).toBe('system')

    localStorage.setItem(THEME_KEY, 'chartreuse')
    initTheme()
    expect(themePreference.value).toBe('system')
  })

  it('cycles system -> light -> dark -> system', () => {
    setTheme('system')
    cycleTheme()
    expect(themePreference.value).toBe('light')
    cycleTheme()
    expect(themePreference.value).toBe('dark')
    cycleTheme()
    expect(themePreference.value).toBe('system')
  })

  it('still switches when localStorage is unavailable', () => {
    // Safari in private mode throws on setItem; the appearance must not depend
    // on being able to remember it.
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })

    expect(() => setTheme('dark')).not.toThrow()
    expect(isDarkClassSet()).toBe(true)

    setItem.mockRestore()
  })

  it('uses the same storage key as the authenticated app', () => {
    // Both apps are served from one origin, so the choice carries over.
    expect(THEME_KEY).toBe('wiki:theme')
    expect(DARK_CLASS).toBe('app-dark')
  })
})
