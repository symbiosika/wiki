/**
 * Parse a timestamp coming from the API into a `Date`.
 *
 * Backend timestamps live in `timestamp without time zone` columns and are
 * stored in UTC, but the driver serialises them as *naive* strings with no
 * timezone designator, e.g. `"2026-07-22 17:20:07.123456"`. Passing such a
 * string straight to `new Date(...)` makes the engine interpret it as **local**
 * time, so the UTC→local conversion never happens and the value is shown off by
 * the local offset (e.g. 17:20 instead of 19:20 in UTC+2).
 *
 * This normalises the input so a naive timestamp is treated as UTC, while a
 * value that already carries timezone info (trailing `Z` or a `±HH:MM` offset)
 * is left untouched. Returns `null` for empty or unparseable input.
 */
export const parseServerDate = (
  value: string | number | Date | null | undefined,
): Date | null => {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }

  let s = value.trim()
  // Does the string already state a timezone? Trailing `Z`, or a `±HH:MM` /
  // `±HHMM` offset on the time portion.
  const hasTimezone = /[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)
  if (!hasTimezone) {
    // Normalise "YYYY-MM-DD HH:MM:SS" → ISO and mark it as UTC.
    s = s.replace(' ', 'T') + 'Z'
  }

  const date = new Date(s)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Full date + time in the viewer's local timezone (and locale). Naive UTC
 * timestamps from the API are converted correctly — see {@link parseServerDate}.
 */
export const formatDateTime = (
  value: string | number | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  locale?: string,
): string => {
  const date = parseServerDate(value)
  if (!date) return '-'
  return date.toLocaleString(locale, options)
}

export const formatDateAsMMYYYY = (date: string | null | undefined) => {
  const parsed = parseServerDate(date)
  if (!parsed) return '-'
  return parsed.toLocaleDateString('en-US', {
    month: '2-digit',
    year: 'numeric',
  })
}

/**
 * Format a date as relative time (e.g., "2 hours ago", "3 days ago")
 */
export const formatRelativeTime = (
  date: string | Date | null | undefined,
): string => {
  const then = parseServerDate(date)
  if (!then) return '-'

  const now = new Date()
  const diffMs = now.getTime() - then.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)
  const diffWeeks = Math.floor(diffDays / 7)
  const diffMonths = Math.floor(diffDays / 30)
  const diffYears = Math.floor(diffDays / 365)

  if (diffSeconds < 60) {
    return 'just now'
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
  } else if (diffWeeks < 4) {
    return `${diffWeeks} week${diffWeeks > 1 ? 's' : ''} ago`
  } else if (diffMonths < 12) {
    return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`
  } else {
    return `${diffYears} year${diffYears > 1 ? 's' : ''} ago`
  }
}
