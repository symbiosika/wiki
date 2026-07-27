import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEFAULT_WIDTH,
  MAX_WIDTH,
  MIN_WIDTH,
  loadSidebarWidth,
  nudgeSidebarWidth,
  resetSidebarWidth,
  setSidebarWidth,
  sidebarWidth,
} from './sidebarWidth'

const STORAGE_KEY = 'wiki:docs:sidebarWidth'

describe('sidebar width', () => {
  beforeEach(() => {
    localStorage.clear()
    resetSidebarWidth()
  })

  it('clamps to the allowed range', () => {
    setSidebarWidth(10)
    expect(sidebarWidth.value).toBe(MIN_WIDTH)

    setSidebarWidth(10_000)
    expect(sidebarWidth.value).toBe(MAX_WIDTH)
  })

  it('keeps a width inside the range', () => {
    setSidebarWidth(300)
    expect(sidebarWidth.value).toBe(300)
  })

  it('rounds fractional drag positions', () => {
    setSidebarWidth(300.6)
    expect(sidebarWidth.value).toBe(301)
  })

  it('persists on reset and restores on load', () => {
    resetSidebarWidth()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(String(DEFAULT_WIDTH))

    localStorage.setItem(STORAGE_KEY, '320')
    loadSidebarWidth()
    expect(sidebarWidth.value).toBe(320)
  })

  it('ignores a junk or out-of-range stored value', () => {
    localStorage.setItem(STORAGE_KEY, 'wide please')
    loadSidebarWidth()
    expect(sidebarWidth.value).toBe(DEFAULT_WIDTH)

    localStorage.setItem(STORAGE_KEY, '99999')
    loadSidebarWidth()
    expect(sidebarWidth.value).toBe(MAX_WIDTH)
  })

  it('nudges by a step and persists', () => {
    setSidebarWidth(300)
    nudgeSidebarWidth(16)
    expect(sidebarWidth.value).toBe(316)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('316')

    nudgeSidebarWidth(-16)
    expect(sidebarWidth.value).toBe(300)
  })

  it('nudging cannot escape the range', () => {
    setSidebarWidth(MIN_WIDTH)
    nudgeSidebarWidth(-100)
    expect(sidebarWidth.value).toBe(MIN_WIDTH)
  })
})
