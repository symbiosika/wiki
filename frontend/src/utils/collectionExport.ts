/**
 * Exporting a collection: CSV for a spreadsheet, markdown for a chat.
 *
 * Both are pure functions over the rows the table is *currently showing*, so
 * what a filter narrowed down is what leaves the app. Neither touches the
 * network — the export is built from data already in the browser.
 */
import { displayValue, type CollectionField, type CollectionRecord } from './collections'

/**
 * Semicolon, not comma.
 *
 * The audience for this file is somebody opening it in Excel or LibreOffice in
 * a German locale, where the comma is the decimal separator and a
 * comma-delimited file lands in a single column. Semicolon is what those
 * programs expect, and it also keeps multi-select values ("a, b") from needing
 * quotes on every row.
 */
const DELIMITER = ';'

/**
 * Excel only recognises a UTF-8 CSV when it starts with a byte-order mark.
 * Without it "Müller" arrives as "MÃ¼ller" — which is exactly the kind of
 * detail that makes people give up on an export.
 */
export const CSV_BOM = '﻿'

/** Quote a CSV field per RFC 4180 when it contains anything structural. */
export function escapeCsvCell(value: string): string {
  if (value === '') return ''
  const needsQuotes =
    value.includes(DELIMITER) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
  if (!needsQuotes) return value
  return `"${value.replace(/"/g, '""')}"`
}

/**
 * Render the given records as CSV, one header row of column labels followed by
 * one row per record. Values are the *displayed* text, so the file matches what
 * the user is looking at (formatted numbers, localised dates) rather than the
 * raw jsonb.
 */
export function toCsv(
  fields: CollectionField[],
  records: CollectionRecord[],
  locale = 'de',
): string {
  const header = fields.map((f) => escapeCsvCell(f.label)).join(DELIMITER)
  const rows = records.map((record) =>
    fields
      .map((field) =>
        escapeCsvCell(displayValue(field, record.data[field.key], locale)),
      )
      .join(DELIMITER),
  )
  // CRLF: the line ending every spreadsheet agrees on
  return `${CSV_BOM}${[header, ...rows].join('\r\n')}\r\n`
}

/**
 * Render the records as markdown blocks — one block per record, each line a
 * `Feldname: Wert` pair, blocks separated by a blank line, under a heading with
 * the table's name.
 *
 * This shape is for pasting into a chat with an assistant: a wide markdown
 * table gets unreadable past a handful of columns and forces a model to count
 * pipes to line a value up with its header, whereas a labelled block carries
 * its own schema on every row.
 *
 * Empty values are omitted rather than printed as blank pairs — they are noise,
 * and their absence already says "not set".
 */
export function toMarkdownBlocks(
  tableName: string,
  fields: CollectionField[],
  records: CollectionRecord[],
  locale = 'de',
): string {
  const heading = tableName.trim() ? `## ${tableName.trim()}\n` : ''

  if (records.length === 0) {
    return `${heading}\n_(keine Einträge)_\n`
  }

  const blocks = records.map((record) => {
    const lines = fields
      .map((field) => {
        const value = displayValue(field, record.data[field.key], locale)
        return value ? `${field.label}: ${value}` : null
      })
      .filter((line): line is string => line !== null)
    return lines.join('\n')
  })

  return `${heading}\n${blocks.join('\n\n')}\n`
}

/** Filename for a CSV download: the table's name, made filesystem-safe. */
export function csvFileName(tableName: string, date = new Date()): string {
  const base =
    tableName
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'tabelle'
  const day = date.toISOString().slice(0, 10)
  return `${base}-${day}.csv`
}
