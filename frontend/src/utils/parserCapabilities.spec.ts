import { describe, it, expect } from 'vitest'
import type { WikiParserModality } from '@/types/wiki'
import {
  acceptedExtensions,
  fileAcceptAttribute,
  findModality,
  hasFeature,
  isAcceptedFile,
  isAdvertisedAnywhere,
  isInHouseFile,
  toWireName,
} from './parserCapabilities'

/**
 * What the generic parsing service actually advertises, in the shape the
 * backend hands on: wire names in `features`, extensions with a leading dot.
 * `.doc` is deliberately absent — the service rejects the old Word format.
 */
const MODALITIES: WikiParserModality[] = [
  {
    modality: 'pdf',
    mimeTypes: ['application/pdf'],
    extensions: ['.pdf'],
    features: {
      extract_images: true,
      ocr: true,
      parse_images_in_doc: true,
      detect_tables: true,
    },
  },
  {
    modality: 'image',
    mimeTypes: ['image/png', 'image/jpeg', 'image/tiff'],
    extensions: ['.png', '.jpg', '.jpeg', '.tiff'],
    features: {
      extract_images: true,
      ocr: true,
      parse_images_in_doc: true,
      detect_tables: true,
    },
  },
  {
    modality: 'document',
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'message/rfc822',
    ],
    extensions: ['.docx', '.xlsx', '.pptx', '.csv', '.tsv', '.eml'],
    features: {
      extract_images: true,
      parse_images_in_doc: true,
      detect_tables: true,
      ocr: false,
    },
  },
  {
    modality: 'audio',
    mimeTypes: ['audio/mpeg', 'audio/opus'],
    extensions: ['.mp3', '.opus'],
    features: { async: true },
  },
  {
    modality: 'video',
    mimeTypes: ['video/mp4'],
    extensions: ['.mp4'],
    features: { async: true },
  },
]

const file = (name: string, type = ''): { name: string; type: string } => ({
  name,
  type,
})

describe('accepted formats', () => {
  it('offers every advertised extension plus the in-house formats', () => {
    const exts = acceptedExtensions(MODALITIES)
    for (const ext of [
      '.md',
      '.markdown',
      '.txt',
      '.html',
      '.htm',
      '.pdf',
      '.docx',
      '.xlsx',
      '.pptx',
      '.csv',
      '.tsv',
      '.eml',
      '.mp3',
      '.opus',
      '.mp4',
      '.tiff',
    ]) {
      expect(exts, ext).toContain(ext)
    }
  })

  it('does not offer .doc — the parser rejects the old Word format', () => {
    expect(acceptedExtensions(MODALITIES)).not.toContain('.doc')
    expect(isAcceptedFile(file('Altvertrag.doc'), MODALITIES)).toBe(false)
    expect(fileAcceptAttribute(MODALITIES)).not.toMatch(/(^|,)\.doc(,|$)/)
  })

  it('falls back to the in-house formats plus PDF while nothing is advertised', () => {
    expect(acceptedExtensions([])).toEqual([
      '.md',
      '.markdown',
      '.txt',
      '.text',
      '.html',
      '.htm',
      '.xhtml',
      '.pdf',
    ])
    expect(isAcceptedFile(file('report.pdf'), [])).toBe(true)
    expect(isAcceptedFile(file('notes.md'), [])).toBe(true)
    // not a false promise: without capabilities we cannot claim office support
    expect(isAcceptedFile(file('sheet.xlsx'), [])).toBe(false)
  })

  it('accepts a file the browser hands over without a usable MIME type', () => {
    expect(
      isAcceptedFile(
        file('Kalkulation.xlsx', 'application/octet-stream'),
        MODALITIES,
      ),
    ).toBe(true)
    expect(isAcceptedFile(file('Mail.eml', ''), MODALITIES)).toBe(true)
    expect(isAcceptedFile(file('Aufnahme.opus', ''), MODALITIES)).toBe(true)
  })

  it('keeps every supported file of a mixed folder drop', () => {
    const dropped = [
      'Handbuch.pdf',
      'Angebot.docx',
      'Kalkulation.xlsx',
      'Folien.pptx',
      'Kontakte.csv',
      'Mail.eml',
      'Diktat.mp3',
      'Schulung.mp4',
      'Scan.tiff',
      'Notiz.md',
      'index.html',
      // and two the service does not take
      'Altvertrag.doc',
      'Archiv.zip',
    ].map((name) => file(name))
    const kept = dropped
      .filter((f) => isAcceptedFile(f, MODALITIES))
      .map((f) => f.name)
    expect(kept).toEqual([
      'Handbuch.pdf',
      'Angebot.docx',
      'Kalkulation.xlsx',
      'Folien.pptx',
      'Kontakte.csv',
      'Mail.eml',
      'Diktat.mp3',
      'Schulung.mp4',
      'Scan.tiff',
      'Notiz.md',
      'index.html',
    ])
  })

  it('puts extensions before MIME types in the accept attribute', () => {
    const accept = fileAcceptAttribute(MODALITIES).split(',')
    expect(accept[0]).toBe('.md')
    expect(accept).toContain('application/pdf')
    expect(accept.indexOf('.pdf')).toBeLessThan(
      accept.indexOf('application/pdf'),
    )
  })
})

describe('in-house formats', () => {
  it('reads markdown, text and HTML without the service', () => {
    expect(isInHouseFile(file('Notiz.md'))).toBe(true)
    expect(isInHouseFile(file('liste.txt', 'text/plain'))).toBe(true)
    expect(isInHouseFile(file('seite.html', 'text/html'))).toBe(true)
    expect(isInHouseFile(file('unbenannt', 'text/markdown'))).toBe(true)
  })

  it('sends tables to the service even though browsers call them text/plain', () => {
    expect(isInHouseFile(file('Kontakte.csv', 'text/plain'))).toBe(false)
    expect(isInHouseFile(file('Werte.tsv', 'text/plain'))).toBe(false)
  })

  it('sends everything else to the service', () => {
    expect(isInHouseFile(file('Handbuch.pdf', 'application/pdf'))).toBe(false)
    expect(isInHouseFile(file('Angebot.docx'))).toBe(false)
  })
})

describe('per-modality options', () => {
  const modalityOf = (name: string, type = '') =>
    findModality(MODALITIES, file(name, type))?.modality

  it('routes a file to the modality that accepts it', () => {
    expect(modalityOf('Handbuch.pdf', 'application/pdf')).toBe('pdf')
    expect(modalityOf('Angebot.docx')).toBe('document')
    expect(modalityOf('Kalkulation.xlsx', 'application/octet-stream')).toBe(
      'document',
    )
    expect(modalityOf('Diktat.mp3')).toBe('audio')
    expect(modalityOf('Schulung.mp4')).toBe('video')
    expect(modalityOf('Scan.tiff')).toBe('image')
    expect(modalityOf('Altvertrag.doc')).toBeUndefined()
  })

  it('offers all four options for a PDF', () => {
    const pdf = findModality(MODALITIES, file('Handbuch.pdf'))
    for (const flag of [
      'extract_images',
      'ocr',
      'parse_images_in_doc',
      'detect_tables',
    ]) {
      expect(hasFeature(pdf?.features, flag), flag).toBe(true)
    }
  })

  it('offers no OCR for a Word file — the structure is read directly', () => {
    const docx = findModality(MODALITIES, file('Angebot.docx'))
    expect(hasFeature(docx?.features, 'ocr')).toBe(false)
    expect(hasFeature(docx?.features, 'detect_tables')).toBe(true)
    expect(hasFeature(docx?.features, 'extract_images')).toBe(true)
  })

  it('offers nothing at all for audio and video', () => {
    for (const name of ['Diktat.mp3', 'Schulung.mp4']) {
      const modality = findModality(MODALITIES, file(name))
      for (const flag of [
        'extract_images',
        'ocr',
        'parse_images_in_doc',
        'detect_tables',
      ]) {
        expect(hasFeature(modality?.features, flag), `${name} ${flag}`).toBe(
          false,
        )
      }
    }
  })

  it('reads an option a service spells in camelCase', () => {
    expect(hasFeature({ extractImages: true }, 'extract_images')).toBe(true)
    expect(hasFeature({ detectTables: true }, 'detect_tables')).toBe(true)
    expect(hasFeature({ ocr: false }, 'ocr')).toBe(false)
    expect(hasFeature(undefined, 'ocr')).toBe(false)
  })

  it('knows which options are worth rendering at all', () => {
    expect(isAdvertisedAnywhere(MODALITIES, 'ocr')).toBe(true)
    expect(isAdvertisedAnywhere(MODALITIES, 'polish_markdown')).toBe(false)
    expect(isAdvertisedAnywhere([], 'ocr')).toBe(false)
  })

  it('normalizes an option name to its wire form', () => {
    expect(toWireName('detectTables')).toBe('detect_tables')
    expect(toWireName('parseImagesInDoc')).toBe('parse_images_in_doc')
    expect(toWireName('ocr')).toBe('ocr')
    expect(toWireName('extract_images')).toBe('extract_images')
  })
})
