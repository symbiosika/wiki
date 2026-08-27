import { describe, expect, it } from 'vitest'
import {
  PAGE_TYPE_COLORS,
  pageTypeIconClasses,
  pageTypeSwatchClasses,
  resolvePageTypeStyle,
} from './pageTypeStyle'
import {
  WIKI_ICONS,
  WIKI_ICON_NAMES,
  isEmojiIcon,
  resolveWikiIcon,
} from './wikiIcons'

describe('isEmojiIcon', () => {
  it('accepts single emoji and joined sequences', () => {
    expect(isEmojiIcon('📘')).toBe(true)
    expect(isEmojiIcon('🔥')).toBe(true)
    // skin-tone modifier
    expect(isEmojiIcon('👍🏽')).toBe(true)
    // ZWJ sequence
    expect(isEmojiIcon('👩‍💻')).toBe(true)
    // surrounding whitespace is tolerated
    expect(isEmojiIcon('  ✅  ')).toBe(true)
  })

  it('rejects icon names, plain text, digits and empty values', () => {
    expect(isEmojiIcon('file-document-outline')).toBe(false)
    expect(isEmojiIcon('Handbuch')).toBe(false)
    expect(isEmojiIcon('42')).toBe(false)
    expect(isEmojiIcon('')).toBe(false)
    expect(isEmojiIcon('   ')).toBe(false)
    // an emoji mixed with text is not an icon value
    expect(isEmojiIcon('📘 Handbuch')).toBe(false)
  })

  it('rejects a long run of pictographs', () => {
    expect(isEmojiIcon('📘📘📘📘📘📘📘📘📘📘')).toBe(false)
  })
})

describe('resolveWikiIcon', () => {
  it('resolves a known allowlist name to its component', () => {
    const resolved = resolveWikiIcon('file-document-outline')
    expect(resolved.kind).toBe('component')
    if (resolved.kind === 'component') {
      expect(resolved.component).toBe(WIKI_ICONS['file-document-outline'])
    }
  })

  it('resolves an emoji to the emoji itself, trimmed', () => {
    expect(resolveWikiIcon(' 📘 ')).toEqual({ kind: 'emoji', value: '📘' })
  })

  it('falls back to none for unknown names and empty values', () => {
    // an unknown name must not throw — a config from a newer frontend or a
    // typo has to degrade to "no icon", never to a broken row
    expect(resolveWikiIcon('definitely-not-an-icon')).toEqual({ kind: 'none' })
    expect(resolveWikiIcon(null)).toEqual({ kind: 'none' })
    expect(resolveWikiIcon(undefined)).toEqual({ kind: 'none' })
    expect(resolveWikiIcon('  ')).toEqual({ kind: 'none' })
  })

  it('every allowlisted name resolves to a component', () => {
    expect(WIKI_ICON_NAMES.length).toBeGreaterThan(0)
    for (const name of WIKI_ICON_NAMES) {
      expect(resolveWikiIcon(name).kind).toBe('component')
    }
  })
})

describe('pageTypeIconClasses', () => {
  it('returns palette classes for every known colour', () => {
    for (const color of PAGE_TYPE_COLORS) {
      expect(pageTypeIconClasses(color)).toContain(`text-${color}-`)
      expect(pageTypeSwatchClasses(color)).toContain(`bg-${color}-`)
    }
  })

  it('falls back to the muted surface tone for unset or unknown colours', () => {
    const fallback = 'text-surface-400 dark:text-surface-500'
    expect(pageTypeIconClasses(undefined)).toBe(fallback)
    expect(pageTypeIconClasses(null)).toBe(fallback)
    expect(pageTypeIconClasses('chartreuse')).toBe(fallback)
  })
})

describe('resolvePageTypeStyle', () => {
  const styles = {
    FAQ: {
      icon: 'help-circle-outline',
      color: 'blue',
      label: 'Häufige Fragen',
    },
    policy: { icon: '📘' },
  }

  it('returns null when the page has no type', () => {
    expect(resolvePageTypeStyle(null, styles)).toBeNull()
    expect(resolvePageTypeStyle(undefined, styles)).toBeNull()
    expect(resolvePageTypeStyle('', styles)).toBeNull()
  })

  it('resolves icon, colour and label', () => {
    const resolved = resolvePageTypeStyle('FAQ', styles)
    expect(resolved).not.toBeNull()
    expect(resolved!.label).toBe('Häufige Fragen')
    expect(resolved!.icon.kind).toBe('component')
    expect(resolved!.iconClasses).toContain('text-blue-')
  })

  it('falls back to the page type key as label', () => {
    expect(resolvePageTypeStyle('policy', styles)!.label).toBe('policy')
  })

  it('still resolves a type that has no style configured', () => {
    // the type is valid, it just has no presentation yet — callers render the
    // label and skip the icon
    const resolved = resolvePageTypeStyle('manual', styles)
    expect(resolved).toEqual({
      pageType: 'manual',
      label: 'manual',
      icon: { kind: 'none' },
      iconClasses: 'text-surface-400 dark:text-surface-500',
    })
  })

  it('tolerates a missing style map', () => {
    expect(resolvePageTypeStyle('manual', undefined)!.icon).toEqual({
      kind: 'none',
    })
    expect(resolvePageTypeStyle('manual', null)!.label).toBe('manual')
  })

  it('ignores a whitespace-only label', () => {
    expect(resolvePageTypeStyle('x', { x: { label: '   ' } })!.label).toBe('x')
  })
})
