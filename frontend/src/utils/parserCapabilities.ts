/**
 * Everything the import dialog needs to know about *which files it may offer*
 * and *which parser options apply to them* — derived at runtime from the
 * capabilities the configured parsing service advertises
 * (`GET /knowledge/parser/capabilities` → `modalities[]`).
 *
 * There is deliberately no format list in here beyond the in-house ones: what
 * the service accepts is asked of the service, so a format it gains needs no
 * change in the frontend.
 */
import type { WikiParserFeatures, WikiParserModality } from '@/types/wiki'

/** A file as far as any of this cares — `File` satisfies it. */
export interface FileLike {
  name: string
  type?: string
}

/**
 * Formats the backend reads itself instead of handing them to the parsing
 * service: plain text and markdown are read locally, HTML is converted
 * locally (the service rejects HTML on purpose — it would hand back the page's
 * own markup). Mirrors `IN_HOUSE_*` in the framework's `parsing/index.ts`.
 * They stay selectable no matter what the service advertises.
 */
export const IN_HOUSE_EXTENSIONS = [
  '.md',
  '.markdown',
  '.txt',
  '.text',
  '.html',
  '.htm',
  '.xhtml',
]
export const IN_HOUSE_MIME_TYPES = [
  'text/markdown',
  'text/plain',
  'text/html',
  'application/xhtml+xml',
]

/**
 * The exception to the in-house text path: browsers hand `.csv` / `.tsv` over
 * as `text/plain`, but the framework sends them to the service anyway — read
 * locally, the whole table layer would be lost. So they are service files
 * despite their MIME type.
 */
const TABLE_EXTENSIONS = ['.csv', '.tsv']

/**
 * What stays selectable when the capabilities are not (yet) known: the
 * in-house formats plus PDF. The framework's `configuredParserSupports()`
 * always accepts PDF, even with discovery down, so offering it is not a false
 * promise — offering anything else would be.
 */
const FALLBACK_EXTENSIONS = ['.pdf']
const FALLBACK_MIME_TYPES = ['application/pdf']

/** `"PDF"` / `"pdf"` / `".PDF"` → `".pdf"`; `""` stays `""`. */
export const normalizeExtension = (value: string): string => {
  const trimmed = value.trim().toLowerCase()
  if (trimmed === '') return ''
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`
}

/** The lower-cased extension of a filename, including the dot ("" if none). */
export const fileExtension = (name: string): string => {
  const match = /\.[^./\\]+$/.exec(name ?? '')
  return match ? match[0]!.toLowerCase() : ''
}

/**
 * MIME types that carry no information: browsers and Windows send these for
 * plenty of files they simply don't know — `.xlsx`, `.eml`, `.opus`, and PDFs
 * as well. Whenever one shows up, the extension is the only routing key left.
 * Mirrors `UNINFORMATIVE_MIME_TYPES` in the framework.
 */
const UNINFORMATIVE_MIME_TYPES = [
  '',
  'application/octet-stream',
  'application/x-download',
  'binary/octet-stream',
]

/** A MIME type without its `; charset=…` parameter, lower-cased. */
const bareMime = (mime?: string): string =>
  (mime ?? '').split(';')[0]?.trim().toLowerCase() ?? ''

/** Whether `mime` tells us nothing about the file (see above). */
export const isUninformativeMime = (mime?: string): boolean =>
  UNINFORMATIVE_MIME_TYPES.includes(bareMime(mime))

/** The MIME to route on, or `undefined` when it carries no information. */
const routingMime = (file: FileLike): string | undefined => {
  const mime = bareMime(file.type)
  return isUninformativeMime(mime) ? undefined : mime
}

/** Unique values, order preserved. */
const unique = (values: string[]): string[] => [...new Set(values)]

/**
 * Every extension that may be offered for selection: the in-house ones plus
 * whatever the service advertises — or plus PDF alone while nothing is
 * advertised (discovery not finished, or failed).
 */
export const acceptedExtensions = (
  modalities: WikiParserModality[],
): string[] => {
  const advertised = modalities.flatMap((m) =>
    (m.extensions ?? []).map(normalizeExtension),
  )
  return unique([
    ...IN_HOUSE_EXTENSIONS,
    ...(advertised.length > 0 ? advertised : FALLBACK_EXTENSIONS),
  ]).filter((ext) => ext !== '')
}

/** The MIME counterpart of {@link acceptedExtensions}. */
export const acceptedMimeTypes = (
  modalities: WikiParserModality[],
): string[] => {
  const advertised = modalities.flatMap((m) =>
    (m.mimeTypes ?? []).map((mime) => mime.trim().toLowerCase()),
  )
  return unique([
    ...IN_HOUSE_MIME_TYPES,
    ...(advertised.length > 0 ? advertised : FALLBACK_MIME_TYPES),
  ]).filter((mime) => mime !== '')
}

/**
 * The value for a file input's `accept` attribute: extensions first (the only
 * key that works for the many formats browsers have no MIME for), then the
 * advertised MIME types.
 */
export const fileAcceptAttribute = (modalities: WikiParserModality[]): string =>
  [...acceptedExtensions(modalities), ...acceptedMimeTypes(modalities)].join(
    ',',
  )

/** Whether the framework reads this file itself instead of asking the service. */
export const isInHouseFile = (file: FileLike): boolean => {
  const extension = fileExtension(file.name)
  if (TABLE_EXTENSIONS.includes(extension)) return false
  if (IN_HOUSE_EXTENSIONS.includes(extension)) return true
  const mime = routingMime(file)
  return mime !== undefined && IN_HOUSE_MIME_TYPES.includes(mime)
}

/**
 * The advertised modality that accepts this file, or `undefined` when none
 * does. An uninformative MIME lets the extension decide; matching either key
 * is enough, exactly as the framework's `findServiceModality` does.
 */
export const findModality = (
  modalities: WikiParserModality[],
  file: FileLike,
): WikiParserModality | undefined => {
  const mime = routingMime(file)
  const extension = fileExtension(file.name)
  return modalities.find(
    (m) =>
      (mime !== undefined && (m.mimeTypes ?? []).includes(mime)) ||
      (extension !== '' &&
        (m.extensions ?? []).map(normalizeExtension).includes(extension)),
  )
}

/**
 * Whether this file may be imported at all: in-house formats always, anything
 * else only when the service advertises it (or it is a PDF and nothing is
 * advertised yet — see {@link acceptedExtensions}).
 *
 * This is the filter for a folder drop, so being wrong here means silently
 * discarding a file the backend would have accepted.
 */
export const isAcceptedFile = (
  file: FileLike,
  modalities: WikiParserModality[],
): boolean => {
  if (isInHouseFile(file)) return true
  if (findModality(modalities, file)) return true
  if (modalities.length > 0) return false
  // No capabilities known — the PDF-only fallback still applies.
  const mime = routingMime(file)
  return (
    FALLBACK_EXTENSIONS.includes(fileExtension(file.name)) ||
    (mime !== undefined && FALLBACK_MIME_TYPES.includes(mime))
  )
}

/**
 * The wire name of an option: `detectTables` → `detect_tables`. A name already
 * in wire form passes through unchanged, so either spelling can be fed in.
 * Mirrors `toServiceOptionWireName` in the framework.
 */
export const toWireName = (key: string): string =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase()

/**
 * Whether a modality advertises the option `wireName` (`"ocr"`,
 * `"detect_tables"`, …). An absent key means "not offered".
 *
 * The service names its flags in wire form (`snake_case`) and the framework
 * passes the map through untouched, so that is the spelling to ask for. The
 * camelCase variant is accepted too: an older framework build normalized the
 * keys, and a service is free to answer in either spelling.
 */
export const hasFeature = (
  features: WikiParserFeatures | undefined,
  wireName: string,
): boolean => {
  if (!features) return false
  if (features[wireName] === true) return true
  const camel = wireName.replace(/_([a-z0-9])/g, (_, c: string) =>
    c.toUpperCase(),
  )
  return features[camel] === true
}

/** Whether at least one advertised modality offers the option `wireName`. */
export const isAdvertisedAnywhere = (
  modalities: WikiParserModality[],
  wireName: string,
): boolean => modalities.some((m) => hasFeature(m.features, wireName))
