/**
 * Icon and colour for a wiki page type.
 *
 * Colours are expressed as literal Tailwind utility classes rather than CSS
 * variables on purpose: Tailwind's scanner reads the class strings out of this
 * file at build time, so the palette is guaranteed to end up in the generated
 * CSS. A computed `var(--color-<key>-500)` would depend on Tailwind emitting
 * theme variables it never sees used.
 *
 * The lookup is a pure function of (pageType, config) so the sidebar tree, the
 * page header and the admin picker all resolve a type the same way — the single
 * source of truth for "what does this type look like".
 */
import type { WikiPageTypeStyle } from '@/types/wiki'
import { resolveWikiIcon, type ResolvedWikiIcon } from '@/utils/wikiIcons'

/**
 * Selectable colours — the single source of truth for this app's page-type
 * palette.
 *
 * The framework stores `color` as an opaque token and does not know which
 * values exist: which colours a page type may carry is a property of this
 * design system, not of the knowledge backend. Growing or renaming the palette
 * therefore needs no framework release, and `pageTypeIconClasses` falls back to
 * a neutral tone for any value it does not recognise, so a config written by a
 * future palette never breaks a row.
 */
export const PAGE_TYPE_COLORS = [
  'slate',
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'blue',
  'violet',
  'pink',
] as const

export type PageTypeColor = (typeof PAGE_TYPE_COLORS)[number]

/**
 * Icon colour per palette key. The dark variant is one step lighter because a
 * 500 shade on the dark surface reads muddy.
 */
const ICON_CLASSES: Record<PageTypeColor, string> = {
  slate: 'text-slate-500 dark:text-slate-400',
  red: 'text-red-500 dark:text-red-400',
  orange: 'text-orange-500 dark:text-orange-400',
  amber: 'text-amber-500 dark:text-amber-400',
  green: 'text-green-600 dark:text-green-400',
  teal: 'text-teal-500 dark:text-teal-400',
  blue: 'text-blue-500 dark:text-blue-400',
  violet: 'text-violet-500 dark:text-violet-400',
  pink: 'text-pink-500 dark:text-pink-400',
}

/** Solid fill, used for the swatches in the admin colour picker. */
const SWATCH_CLASSES: Record<PageTypeColor, string> = {
  slate: 'bg-slate-500',
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  amber: 'bg-amber-500',
  green: 'bg-green-600',
  teal: 'bg-teal-500',
  blue: 'bg-blue-500',
  violet: 'bg-violet-500',
  pink: 'bg-pink-500',
}

const isPageTypeColor = (value: unknown): value is PageTypeColor =>
  typeof value === 'string' &&
  (PAGE_TYPE_COLORS as readonly string[]).includes(value)

/**
 * Icon colour classes for a stored colour key. Falls back to the muted surface
 * tone, so an unset or unknown colour still renders a visible icon.
 */
export const pageTypeIconClasses = (color?: string | null): string =>
  isPageTypeColor(color)
    ? ICON_CLASSES[color]
    : 'text-surface-400 dark:text-surface-500'

/** Swatch classes for the admin colour picker. */
export const pageTypeSwatchClasses = (color: PageTypeColor): string =>
  SWATCH_CLASSES[color]

export interface ResolvedPageTypeStyle {
  /** The page type key, as stored on the page. */
  pageType: string
  /**
   * The label an administrator configured, or undefined when none is set.
   *
   * Deliberately NOT pre-resolved to the key: callers own the fallback chain,
   * because the next step down is the shipped translation of the default
   * vocabulary and this module has no i18n. Resolving it here would create a
   * second label source that disagrees with the one in the view.
   */
  configuredLabel?: string
  icon: ResolvedWikiIcon
  iconClasses: string
}

/**
 * Resolve how a page type should be presented. Returns null only when there is
 * no page type at all — a type without configured presentation still resolves,
 * so callers get a consistent shape and can decide what to render.
 */
export const resolvePageTypeStyle = (
  pageType: string | null | undefined,
  styles: Record<string, WikiPageTypeStyle> | null | undefined,
): ResolvedPageTypeStyle | null => {
  if (!pageType) return null
  const style = styles?.[pageType]
  const configuredLabel = style?.label?.trim()
  return {
    pageType,
    ...(configuredLabel ? { configuredLabel } : {}),
    icon: resolveWikiIcon(style?.icon),
    iconClasses: pageTypeIconClasses(style?.color),
  }
}
