/**
 * Minimal ambient types for html-to-pdfmake, which ships no type definitions.
 * We only use the default export: `htmlToPdfmake(html, options) -> content`.
 */
declare module 'html-to-pdfmake' {
  interface HtmlToPdfmakeOptions {
    window?: Window
    tableAutoSize?: boolean
    imagesByReference?: boolean
    defaultStyles?: Record<string, Record<string, unknown>>
    [key: string]: unknown
  }
  const htmlToPdfmake: (html: string, options?: HtmlToPdfmakeOptions) => unknown
  export default htmlToPdfmake
}
