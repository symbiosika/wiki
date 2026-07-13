/**
 * Client-side "nice" PDF export for a wiki page.
 *
 * Rendered entirely in the browser with pdfmake (vector output, selectable
 * text, full control over header/footer) so we avoid a headless-Chromium
 * dependency on the backend and – crucially – get rid of the browser print
 * dialog's URL/date footer. Everything is dynamically imported so the heavy
 * pdfmake/font payload only loads when a user actually exports.
 *
 * The page content is reused from the same blocks → HTML conversion the editor
 * uses (`blocksToEditorHtml`), then turned into pdfmake content via
 * html-to-pdfmake.
 *
 * The `WikiPdfBranding` object is intentionally the single seam for the
 * planned per-organisation header/footer configuration: today it defaults to
 * "organisation + page title" on page one and a page counter in the footer,
 * but everything a tenant might want to customise flows through here.
 */
import { fetcher } from '@/utils/fetcher'
import { blocksToEditorHtml } from '@/utils/wikiBlocks'
import type { WikiBlock } from '@/types/wiki'

/** A4 content width in pt (595.28 − 2×56 margin), used to cap image widths. */
const CONTENT_WIDTH = 483

/** Per-organisation branding for the exported PDF (header / footer). */
export interface WikiPdfBranding {
  /** Organisation name printed above the title on page one and in the footer. */
  organisationName?: string
  /** Show the "page X of Y" counter in the footer (default: true). */
  showPageNumbers?: boolean
  /** Renders the page-counter label; receives the current page and total. */
  pageLabel?: (current: number, total: number) => string
}

export interface WikiPdfExportOptions extends WikiPdfBranding {
  title: string
  blocks: WikiBlock[]
  /** Formatted date shown in the title block; omit to hide it. */
  dateLabel?: string
  /** File name (without extension); defaults to the page title. */
  filename?: string
}

/** Read a Blob as a data: URL. */
const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

/** Natural pixel width of a data-URL image (0 if it cannot be decoded). */
const imageWidth = (dataUrl: string): Promise<number> =>
  new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img.naturalWidth || 0)
    img.onerror = () => resolve(0)
    img.src = dataUrl
  })

/**
 * pdfmake cannot fetch images itself, so we inline every <img> as a data URL.
 * Same-origin/API images go through the fetcher (sends the auth cookie);
 * absolute URLs are fetched directly. Images that fail to load are dropped so
 * the export still succeeds. Widths are capped to the printable area.
 */
const inlineImages = async (html: string): Promise<string> => {
  const template = document.createElement('template')
  template.innerHTML = html
  const images = Array.from(template.content.querySelectorAll('img'))

  await Promise.all(
    images.map(async (img) => {
      const src = img.getAttribute('src')
      if (!src) {
        img.remove()
        return
      }
      try {
        const dataUrl = src.startsWith('data:')
          ? src
          : await blobToDataUrl(
              src.startsWith('/') || src.startsWith('api/')
                ? await fetcher.getBlob(src)
                : await (await fetch(src)).blob(),
            )
        const natural = await imageWidth(dataUrl)
        const width = natural ? Math.min(natural, CONTENT_WIDTH) : CONTENT_WIDTH
        img.setAttribute('src', dataUrl)
        img.setAttribute('style', `width:${width}px`)
      } catch {
        // image unavailable (deleted, offline, blocked) – skip it
        img.remove()
      }
    }),
  )

  return template.innerHTML
}

/** The "organisation + title (+ date)" block printed at the top of page one. */
const buildTitleBlock = (opts: WikiPdfExportOptions): unknown[] => {
  const block: unknown[] = []
  if (opts.organisationName) {
    block.push({
      text: opts.organisationName.toUpperCase(),
      style: 'orgName',
    })
  }
  block.push({
    text: opts.title || 'Untitled',
    style: 'docTitle',
  })
  if (opts.dateLabel) {
    block.push({ text: opts.dateLabel, style: 'docDate' })
  }
  // thin divider under the title block
  block.push({
    canvas: [
      {
        type: 'line',
        x1: 0,
        y1: 0,
        x2: CONTENT_WIDTH,
        y2: 0,
        lineWidth: 0.75,
        lineColor: '#e5e7eb',
      },
    ],
    margin: [0, 6, 0, 16],
  })
  return block
}

/** Sanitise a page title into a safe file name. */
const toFilename = (title: string): string => {
  const base = (title || 'wiki-page')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 120)
  return `${base || 'wiki-page'}.pdf`
}

/**
 * Build the PDF for a wiki page and trigger a browser download.
 * Runs in the browser only.
 */
export const exportWikiPageToPdf = async (
  opts: WikiPdfExportOptions,
): Promise<void> => {
  const [{ default: htmlToPdfmake }, pdfMakeModule, vfsModule] =
    await Promise.all([
      import('html-to-pdfmake'),
      import('pdfmake/build/pdfmake'),
      import('pdfmake/build/vfs_fonts'),
    ])

  // pdfmake ships a UMD bundle; under the bundler the object may be the module
  // itself or its `default` export. `addVirtualFileSystem`/`createPdf` live on it.
  const pdfMake = ((pdfMakeModule as { default?: unknown }).default ??
    pdfMakeModule) as typeof import('pdfmake/build/pdfmake')
  const vfs = (vfsModule as { default?: unknown }).default ?? vfsModule
  pdfMake.addVirtualFileSystem(vfs as never)

  const html = await inlineImages(blocksToEditorHtml(opts.blocks))

  const body = htmlToPdfmake(html, {
    window,
    tableAutoSize: true,
    defaultStyles: {
      h1: { fontSize: 18, bold: true, marginTop: 14, marginBottom: 4 },
      h2: { fontSize: 15, bold: true, marginTop: 12, marginBottom: 3 },
      h3: { fontSize: 12.5, bold: true, marginTop: 10, marginBottom: 2 },
      h4: { fontSize: 11, bold: true, marginTop: 8, marginBottom: 2 },
      p: { margin: [0, 0, 0, 8], lineHeight: 1.35 },
      ul: { marginBottom: 8 },
      ol: { marginBottom: 8 },
      li: { marginBottom: 2 },
      a: { color: '#2563eb', decoration: 'underline' },
      blockquote: {
        margin: [8, 2, 0, 8],
        italics: true,
        color: '#4b5563',
      },
      pre: {
        fontSize: 9,
        color: '#111827',
        background: '#f3f4f6',
        margin: [0, 2, 0, 10],
      },
      code: { background: '#f3f4f6', color: '#b91c1c' },
      table: { marginBottom: 10 },
    },
  })

  const showPageNumbers = opts.showPageNumbers ?? true
  const pageLabel =
    opts.pageLabel ?? ((current, total) => `${current} / ${total}`)

  const docDefinition = {
    pageSize: 'A4',
    pageMargins: [56, 56, 56, 56] as [number, number, number, number],
    info: {
      title: opts.title || 'Wiki page',
      author: opts.organisationName,
    },
    defaultStyle: {
      font: 'Roboto',
      fontSize: 10.5,
      lineHeight: 1.35,
      color: '#1f2937',
    },
    styles: {
      orgName: {
        fontSize: 8.5,
        bold: true,
        color: '#6b7280',
        characterSpacing: 0.8,
        margin: [0, 0, 0, 2],
      },
      docTitle: {
        fontSize: 22,
        bold: true,
        color: '#111827',
      },
      docDate: {
        fontSize: 9,
        color: '#9ca3af',
        margin: [0, 2, 0, 0],
      },
    },
    content: [...buildTitleBlock(opts), ...(body as unknown[])],
    footer: (currentPage: number, pageCount: number) => ({
      margin: [56, 12, 56, 0] as [number, number, number, number],
      columns: [
        {
          text: opts.organisationName ?? '',
          fontSize: 8,
          color: '#9ca3af',
        },
        {
          text: showPageNumbers ? pageLabel(currentPage, pageCount) : '',
          alignment: 'right',
          fontSize: 8,
          color: '#9ca3af',
        },
      ],
    }),
  }

  pdfMake
    .createPdf(docDefinition as never)
    .download(toFilename(opts.filename ?? opts.title))
}
