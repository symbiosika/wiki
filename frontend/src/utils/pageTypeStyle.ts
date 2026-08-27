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
 * Selectable colours. Mirrors `KNOWLEDGE_PAGE_TYPE_COLORS` in the backend
 * config, which validates the value on write — keep both lists in step.
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
  /** Display label — the configured label, else the key itself. */
  label: string
  icon: ResolvedWikiIcon
  iconClasses: string
}

/**
 * Resolve how a page type should be presented. Returns null when the page
 * carries no type, or when the type has neither an icon nor a label configured
 * — there is nothing to show then, and callers can skip rendering entirely.
 */
export const resolvePageTypeStyle = (
  pageType: string | null | undefined,
  styles: Record<string, WikiPageTypeStyle> | null | undefined,
): ResolvedPageTypeStyle | null => {
  if (!pageType) return null
  const style = styles?.[pageType]
  const icon = resolveWikiIcon(style?.icon)
  return {
    pageType,
    label: style?.label?.trim() || pageType,
    icon,
    iconClasses: pageTypeIconClasses(style?.color),
  }
}
