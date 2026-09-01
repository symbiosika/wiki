/**
 * Per-organisation brand colours.
 *
 * The whole UI is themed through PrimeVue design tokens exposed as CSS custom
 * properties (`--p-primary-*`, `--p-secondary-*`). Tailwind utilities such as
 * `bg-primary-500` compile to `var(--p-primary-500)` (see
 * `tailwindcss-primeui`'s `@theme inline` block and `assets/base.css`), so a
 * colour can be re-themed entirely at runtime by overriding those variables on
 * the document root — no recompilation of Tailwind required.
 *
 * This module turns a single base colour into a full 50–950 shade scale and
 * applies it. Only the numeric scale is overridden; the semantic tokens
 * (`--p-primary-color`, contrast, hover, highlight, …) keep referencing the
 * scale in `base.css`, so light/dark behaviour is preserved.
 */

export interface BrandColors {
  /** Base colour for the primary palette (button highlights etc.), hex. */
  primary?: string | null
  /** Base colour for the secondary palette (secondary buttons), hex. */
  secondary?: string | null
}

/** The shade steps we generate for each palette. */
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const

/**
 * How far each shade is mixed towards white (tints, < 500) or black (shades,
 * > 500). 500 is the base colour itself.
 */
const MIX: Record<(typeof SHADES)[number], { target: 'white' | 'black'; amount: number }> = {
  50: { target: 'white', amount: 0.95 },
  100: { target: 'white', amount: 0.9 },
  200: { target: 'white', amount: 0.75 },
  300: { target: 'white', amount: 0.6 },
  400: { target: 'white', amount: 0.35 },
  500: { target: 'white', amount: 0 },
  600: { target: 'black', amount: 0.12 },
  700: { target: 'black', amount: 0.28 },
  800: { target: 'black', amount: 0.42 },
  900: { target: 'black', amount: 0.55 },
  950: { target: 'black', amount: 0.7 },
}

const HEX_RE = /^#?([0-9a-fA-F]{6})$/

/** Validate a `#rrggbb` colour string (leading `#` optional). */
export const isValidHexColor = (value: string): boolean => HEX_RE.test(value.trim())

/** Normalise to a lowercase `#rrggbb` string, or null if invalid. */
export const normalizeHex = (value: string): string | null => {
  const hex = value.trim().match(HEX_RE)?.[1]
  return hex ? `#${hex.toLowerCase()}` : null
}

const toRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

const toHex = (rgb: [number, number, number]): string =>
  '#' +
  rgb
    .map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0'))
    .join('')

/** Mix `rgb` towards white or black by `amount` (0..1). */
const mix = (
  rgb: [number, number, number],
  target: 'white' | 'black',
  amount: number,
): [number, number, number] => {
  const t = target === 'white' ? 255 : 0
  return [
    rgb[0] + (t - rgb[0]) * amount,
    rgb[1] + (t - rgb[1]) * amount,
    rgb[2] + (t - rgb[2]) * amount,
  ]
}

/**
 * Build a 50–950 shade scale from a base colour (treated as the 500 shade).
 * Returns a map of shade → `#rrggbb`.
 */
export const generateScale = (
  baseHex: string,
): Record<(typeof SHADES)[number], string> => {
  const base = toRgb(baseHex)
  const scale = {} as Record<(typeof SHADES)[number], string>
  for (const shade of SHADES) {
    const { target, amount } = MIX[shade]
    scale[shade] = amount === 0 ? toHex(base) : toHex(mix(base, target, amount))
  }
  return scale
}

const setScale = (
  root: HTMLElement,
  prefix: 'primary' | 'secondary',
  baseHex: string,
) => {
  const scale = generateScale(baseHex)
  for (const shade of SHADES) {
    root.style.setProperty(`--p-${prefix}-${shade}`, scale[shade])
  }
}

const clearScale = (root: HTMLElement, prefix: 'primary' | 'secondary') => {
  for (const shade of SHADES) {
    root.style.removeProperty(`--p-${prefix}-${shade}`)
  }
}

/**
 * Apply the organisation's brand colours by overriding the palette CSS
 * variables on `<html>`. Passing a null/empty/invalid colour for a palette
 * clears any override for it, falling back to the defaults in `base.css`.
 */
export const applyBrandColors = (colors: BrandColors) => {
  if (typeof document === 'undefined') return
  const root = document.documentElement

  const primary = colors.primary ? normalizeHex(colors.primary) : null
  if (primary) setScale(root, 'primary', primary)
  else clearScale(root, 'primary')

  const secondary = colors.secondary ? normalizeHex(colors.secondary) : null
  if (secondary) setScale(root, 'secondary', secondary)
  else clearScale(root, 'secondary')
}

/** Remove all brand-colour overrides, reverting to the `base.css` defaults. */
export const clearBrandColors = () => {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  clearScale(root, 'primary')
  clearScale(root, 'secondary')
}
