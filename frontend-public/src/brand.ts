/**
 * Per-organisation brand colour.
 *
 * The authenticated app stores a primary colour per organisation and themes
 * itself with it; the documentation site picks up the same value so a
 * published site looks like the wiki it came from.
 *
 * The catch is contrast. A colour chosen against a white app background can be
 * unreadable on the dark theme (a deep navy on near-black), and a light brand
 * colour is unreadable on white. So the raw colour is not used directly:
 * it is mixed towards white or black to produce one variant per appearance,
 * the same "mix towards a target" idea the authenticated app uses to build its
 * 50–950 scale — just the two steps needed here.
 */

const HEX = /^#?([0-9a-fA-F]{6})$/

type Rgb = { r: number; g: number; b: number }

const parseHex = (value: string): Rgb | null => {
  const match = HEX.exec(value.trim())
  if (!match) return null
  const int = parseInt(match[1]!, 16)
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 }
}

const toHex = ({ r, g, b }: Rgb): string =>
  `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`

/** Mix a colour towards white (`amount` > 0) or black (`amount` < 0). */
const mix = (color: Rgb, amount: number): Rgb => {
  const target = amount > 0 ? 255 : 0
  const t = Math.abs(amount)
  return {
    r: color.r + (target - color.r) * t,
    g: color.g + (target - color.g) * t,
    b: color.b + (target - color.b) * t,
  }
}

/**
 * Relative luminance (WCAG), used to decide how far a colour has to move to
 * be legible against the page.
 */
const luminance = ({ r, g, b }: Rgb): number => {
  const channel = (value: number) => {
    const v = value / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export interface BrandAccents {
  /** Accent for the light appearance — darkened if the colour is too pale. */
  light: string
  /** Accent for the dark appearance — lightened if the colour is too deep. */
  dark: string
}

/**
 * Derive one legible accent per appearance from a single brand colour.
 *
 * Returns null for anything that is not a six-digit hex, so a malformed
 * setting falls back to the default palette instead of producing an
 * unreadable page.
 */
export const deriveAccents = (hex: string | null | undefined): BrandAccents | null => {
  if (!hex) return null
  const rgb = parseHex(hex)
  if (!rgb) return null

  const l = luminance(rgb)

  // On white, anything above ~0.45 luminance stops being readable as text;
  // darken progressively the paler it is. Below that, use it as-is.
  const light = l > 0.45 ? mix(rgb, -Math.min(0.55, (l - 0.45) * 1.6 + 0.2)) : rgb

  // On the dark page the reverse: lift very dark colours towards white.
  const dark = l < 0.25 ? mix(rgb, Math.min(0.7, (0.25 - l) * 2 + 0.25)) : rgb

  return { light: toHex(light), dark: toHex(dark) }
}

/**
 * Apply (or clear) the organisation accent.
 *
 * Both variants are written as custom properties; the stylesheet picks the
 * right one per appearance, so switching light/dark needs no recomputation.
 * Clearing removes the overrides and the defaults from main.css take over.
 */
export const applyBrandColor = (hex: string | null | undefined): void => {
  const root = document.documentElement
  const accents = deriveAccents(hex)

  if (!accents) {
    root.style.removeProperty('--brand-accent-light')
    root.style.removeProperty('--brand-accent-dark')
    return
  }

  root.style.setProperty('--brand-accent-light', accents.light)
  root.style.setProperty('--brand-accent-dark', accents.dark)
}
