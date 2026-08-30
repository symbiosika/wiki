/**
 * Collection types and the pure helpers the table UI is built on.
 *
 * Everything here is free of Vue and of the network so it can be unit-tested:
 * how a value is displayed, how a column is sorted, and which filter a column
 * type gets. The components stay thin wrappers around these.
 */

export const COLLECTION_FIELD_TYPES = [
  'text',
  'longText',
  'number',
  'checkbox',
  'date',
  'select',
  'multiSelect',
  'url',
  'email',
] as const

export type CollectionFieldType = (typeof COLLECTION_FIELD_TYPES)[number]

export interface CollectionFieldChoice {
  value: string
  color?: string
}

export interface CollectionFieldOptions {
  choices?: CollectionFieldChoice[]
  precision?: number
  suffix?: string
}

export interface CollectionField {
  id: string
  collectionId: string
  key: string
  label: string
  type: CollectionFieldType
  options: CollectionFieldOptions
  required: boolean
  position: number
  hidden: boolean
}

export interface CollectionSettings {
  titleFieldKey?: string
  defaultSort?: { key: string; direction: 'asc' | 'desc' }
  materialize?: boolean
}

export interface Collection {
  id: string
  tenantId: string
  knowledgeTextId: string
  name: string
  description: string | null
  settings: CollectionSettings
  fields: CollectionField[]
}

export interface CollectionRecord {
  id: string
  collectionId: string
  data: Record<string, unknown>
  position: number
  createdAt: string
  updatedAt: string
}

/** Which filter UI a column type gets in the table header. */
export type FilterKind = 'text' | 'number' | 'boolean' | 'date' | 'choice'

export function filterKindFor(type: CollectionFieldType): FilterKind {
  switch (type) {
    case 'number':
      return 'number'
    case 'checkbox':
      return 'boolean'
    case 'date':
      return 'date'
    case 'select':
    case 'multiSelect':
      return 'choice'
    default:
      return 'text'
  }
}

/** True for types that never deserve a wide column. */
export function isNarrowType(type: CollectionFieldType): boolean {
  return type === 'checkbox' || type === 'number' || type === 'date'
}

/**
 * The value a column sorts by.
 *
 * Returns a type-appropriate primitive so that numbers sort numerically and
 * dates chronologically rather than as strings — and so that empty cells sort
 * consistently instead of landing wherever `undefined` happens to fall.
 */
export function sortValue(
  field: CollectionField,
  record: CollectionRecord,
): string | number {
  const value = record.data[field.key]
  if (value === null || value === undefined || value === '') {
    // empties last under ascending sort, whatever the type
    return field.type === 'number' ? Number.POSITIVE_INFINITY : '￿'
  }
  switch (field.type) {
    case 'number':
      return typeof value === 'number' ? value : Number(value)
    case 'checkbox':
      return value ? 0 : 1
    case 'date':
      return String(value)
    case 'multiSelect':
      return Array.isArray(value) ? value.join(', ').toLowerCase() : ''
    default:
      return String(value).toLowerCase()
  }
}

/**
 * Display string for a cell — also what the global search matches against, so
 * searching for "aktiv" finds the row whose select shows "aktiv" even though a
 * checkbox stores a boolean.
 */
export function displayValue(
  field: CollectionField,
  value: unknown,
  locale = 'de',
): string {
  if (value === null || value === undefined || value === '') return ''
  switch (field.type) {
    case 'checkbox':
      return value ? '✓' : ''
    case 'multiSelect':
      return Array.isArray(value) ? value.join(', ') : String(value)
    case 'number': {
      const num = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(num)) return String(value)
      const precision = field.options?.precision
      const text =
        typeof precision === 'number'
          ? num.toLocaleString(locale, {
              minimumFractionDigits: precision,
              maximumFractionDigits: precision,
            })
          : num.toLocaleString(locale)
      return field.options?.suffix ? `${text} ${field.options.suffix}` : text
    }
    case 'date': {
      const date = new Date(`${String(value)}T00:00:00`)
      return Number.isNaN(date.getTime())
        ? String(value)
        : date.toLocaleDateString(locale)
    }
    default:
      return String(value)
  }
}

/**
 * Match a record against the free-text search box.
 *
 * Searches the *rendered* text of every visible column, so what the user sees
 * is what they can search for. Case-insensitive, substring, no tokenisation —
 * anything cleverer would surprise people more than it would help them.
 */
export function matchesSearch(
  fields: CollectionField[],
  record: CollectionRecord,
  term: string,
  locale = 'de',
): boolean {
  const needle = term.trim().toLowerCase()
  if (!needle) return true
  return fields.some((field) =>
    displayValue(field, record.data[field.key], locale)
      .toLowerCase()
      .includes(needle),
  )
}

/** A blank record shaped by the collection's schema. */
export function emptyRecordData(
  fields: CollectionField[],
): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const field of fields) {
    if (field.type === 'checkbox') data[field.key] = false
    else if (field.type === 'multiSelect') data[field.key] = []
    else data[field.key] = null
  }
  return data
}

/**
 * A short label for a record, used in dialog titles and delete confirmations.
 * Falls back through the configured title field, the first text-ish column,
 * and finally any non-empty value.
 */
export function recordLabel(
  collection: Pick<Collection, 'fields' | 'settings'>,
  record: CollectionRecord,
  fallback = '—',
): string {
  const byKey = (key?: string) =>
    key ? collection.fields.find((f) => f.key === key) : undefined

  const candidates = [
    byKey(collection.settings?.titleFieldKey),
    collection.fields.find((f) => f.type === 'text'),
    ...collection.fields,
  ].filter(Boolean) as CollectionField[]

  for (const field of candidates) {
    const text = displayValue(field, record.data[field.key])
    if (text) return text
  }
  return fallback
}

/** Chip colour classes for a select choice. Unknown colours fall back to grey. */
export function choiceClasses(color?: string): string {
  switch (color) {
    case 'emerald':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
    case 'blue':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'
    case 'amber':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
    case 'rose':
      return 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200'
    case 'violet':
      return 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200'
    default:
      return 'bg-surface-100 text-surface-700 dark:bg-surface-700 dark:text-surface-200'
  }
}

/** Colours offered in the column editor. */
export const CHOICE_COLORS = [
  'slate',
  'emerald',
  'blue',
  'amber',
  'rose',
  'violet',
] as const
