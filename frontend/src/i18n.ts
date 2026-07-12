import { createI18n } from 'vue-i18n'
const SUPPORTED_LANGUAGES = ['en']

type Messages = Record<string, any>

/**
 * Detect the browser language
 */
const getBrowserLanguage = () => {
  return navigator.language.split('-')[0]?.toLowerCase() ?? 'en'
}

const STARTUP_LANGUAGE = SUPPORTED_LANGUAGES.includes(getBrowserLanguage())
  ? getBrowserLanguage()
  : 'en'

/**
 * Read all locales from the locales folder
 */
function loadLocalMessages(): Record<string, Messages> {
  const localeModules = import.meta.glob('./locales/**/*.json', {
    eager: true,
  }) as Record<string, { default: Record<string, any> } | Record<string, any>>
  return localeModules
}

function parsePath(path: string): { locale: string; namespace: string } | null {
  // ./locales/en/HomeView.json  ->  locale: "en", ns: "HomeView"
  const match = path.match(/\.\/locales\/([^/]+)\/(.+)\.json$/)
  if (!match) return null
  const [, locale, name] = match
  if (!locale || !name) return null
  return { locale, namespace: name }
}

function buildMessages(
  localeModules: Record<
    string,
    { default: Record<string, any> } | Record<string, any>
  >,
): Record<string, Messages> {
  const messages: Record<string, Messages> = {}
  for (const [path, mod] of Object.entries(localeModules)) {
    const parsed = parsePath(path)
    if (!parsed) continue
    const { locale, namespace } = parsed
    const value: any = (mod as any).default ?? mod
    messages[locale] ??= {}
    messages[locale][namespace] = value
  }
  return messages
}

const messages = buildMessages(loadLocalMessages())

// Optional: Type für MessageSchema (z.B. auf Basis einer Sprache, z.B. "en")
type MessageSchema = (typeof messages)['en']

/**
 * Create the i18n instance
 */
export const i18n = createI18n({
  legacy: false,
  locale: STARTUP_LANGUAGE,
  fallbackLocale: 'en',
  messages,
})

export const setLocale = (locale: string) => {
  if (SUPPORTED_LANGUAGES.includes(locale)) {
    // @ts-ignore
    // i18n.global.locale = locale as 'de' | 'en'
    // console.log('Locale set to: ', locale)
  }
}

export const getLocale = () => {
  return i18n.global.locale
}
