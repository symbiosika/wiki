/**
 * Bundled icon allowlist for wiki page types.
 *
 * `unplugin-icons` resolves `~icons/mdi/*` at build time and inlines the single
 * SVG it finds, so an icon name that only exists in the database cannot be
 * rendered dynamically. The allowlist below is therefore the contract: every
 * icon an administrator can pick is imported here statically, which keeps the
 * display path synchronous (no fetch, no flash of missing icons in the tree)
 * and costs roughly 400 bytes of inlined SVG per entry.
 *
 * The escape hatch for anything not in this list is an emoji: `resolveWikiIcon`
 * recognises one and renders it as text, which needs no import at all.
 *
 * Growing the list means adding an import plus a map entry — nothing else. If
 * free choice over all ~7600 Material icons is ever needed, the collection
 * would have to be served as a lazily fetched static asset instead; see
 * docs/ui-ux-backlog-tolaria.md.
 */
import type { Component } from 'vue'

import IconAlert from '~icons/mdi/alert-outline'
import IconApi from '~icons/mdi/api'
import IconBookOpen from '~icons/mdi/book-open-page-variant-outline'
import IconBookmark from '~icons/mdi/bookmark-outline'
import IconBriefcase from '~icons/mdi/briefcase-outline'
import IconCalendarCheck from '~icons/mdi/calendar-check-outline'
import IconCart from '~icons/mdi/cart-outline'
import IconCash from '~icons/mdi/cash-multiple'
import IconCertificate from '~icons/mdi/certificate-outline'
import IconChartBox from '~icons/mdi/chart-box-outline'
import IconChartLine from '~icons/mdi/chart-line'
import IconCheckDecagram from '~icons/mdi/check-decagram-outline'
import IconClipboardText from '~icons/mdi/clipboard-text-outline'
import IconClock from '~icons/mdi/clock-outline'
import IconCloud from '~icons/mdi/cloud-outline'
import IconCodeBraces from '~icons/mdi/code-braces'
import IconCog from '~icons/mdi/cog-outline'
import IconCube from '~icons/mdi/cube-outline'
import IconCurrencyEur from '~icons/mdi/currency-eur'
import IconDatabase from '~icons/mdi/database-outline'
import IconDomain from '~icons/mdi/domain'
import IconEarth from '~icons/mdi/earth'
import IconEmail from '~icons/mdi/email-outline'
import IconFactory from '~icons/mdi/factory'
import IconFaq from '~icons/mdi/frequently-asked-questions'
import IconFileCertificate from '~icons/mdi/file-certificate-outline'
import IconFileDocument from '~icons/mdi/file-document-outline'
import IconFire from '~icons/mdi/fire'
import IconFlask from '~icons/mdi/flask-outline'
import IconFolder from '~icons/mdi/folder-outline'
import IconGavel from '~icons/mdi/gavel'
import IconHandshake from '~icons/mdi/handshake-outline'
import IconHeartPulse from '~icons/mdi/heart-pulse'
import IconHelpCircle from '~icons/mdi/help-circle-outline'
import IconImage from '~icons/mdi/image-outline'
import IconKey from '~icons/mdi/key-outline'
import IconLeaf from '~icons/mdi/leaf'
import IconLightbulb from '~icons/mdi/lightbulb-on-outline'
import IconLink from '~icons/mdi/link-variant'
import IconLock from '~icons/mdi/lock-outline'
import IconMapMarker from '~icons/mdi/map-marker-outline'
import IconMicrophone from '~icons/mdi/microphone-outline'
import IconNoteText from '~icons/mdi/note-text-outline'
import IconOfficeBuilding from '~icons/mdi/office-building-outline'
import IconPalette from '~icons/mdi/palette-outline'
import IconPencilRuler from '~icons/mdi/pencil-ruler'
import IconPerson from '~icons/mdi/account-outline'
import IconPersonGroup from '~icons/mdi/account-group-outline'
import IconPersonTie from '~icons/mdi/account-tie-outline'
import IconPhone from '~icons/mdi/phone-outline'
import IconPrinter from '~icons/mdi/printer-outline'
import IconPuzzle from '~icons/mdi/puzzle-outline'
import IconReceipt from '~icons/mdi/receipt-text-outline'
import IconRoad from '~icons/mdi/road-variant'
import IconRocket from '~icons/mdi/rocket-launch-outline'
import IconScaleBalance from '~icons/mdi/scale-balance'
import IconSchool from '~icons/mdi/school-outline'
import IconServer from '~icons/mdi/server-network-outline'
import IconShieldCheck from '~icons/mdi/shield-check-outline'
import IconSignDirection from '~icons/mdi/sign-direction'
import IconSitemap from '~icons/mdi/sitemap-outline'
import IconStar from '~icons/mdi/star-outline'
import IconTag from '~icons/mdi/tag-outline'
import IconTextBox from '~icons/mdi/text-box-outline'
import IconTimelineCheck from '~icons/mdi/timeline-check-outline'
import IconTools from '~icons/mdi/tools'
import IconTranslate from '~icons/mdi/translate'
import IconTruck from '~icons/mdi/truck-outline'
import IconVideo from '~icons/mdi/video-outline'
import IconWrench from '~icons/mdi/wrench-outline'

/**
 * Icon name → component. Keys are the Material Design Icons names, so a name
 * stored in the tenant config stays readable and can be looked up upstream.
 */
export const WIKI_ICONS: Record<string, Component> = {
  // documents & knowledge
  'file-document-outline': IconFileDocument,
  'book-open-page-variant-outline': IconBookOpen,
  'text-box-outline': IconTextBox,
  'note-text-outline': IconNoteText,
  'clipboard-text-outline': IconClipboardText,
  'help-circle-outline': IconHelpCircle,
  'frequently-asked-questions': IconFaq,
  'school-outline': IconSchool,
  // governance & compliance
  'shield-check-outline': IconShieldCheck,
  gavel: IconGavel,
  'scale-balance': IconScaleBalance,
  'certificate-outline': IconCertificate,
  'file-certificate-outline': IconFileCertificate,
  'check-decagram-outline': IconCheckDecagram,
  'lock-outline': IconLock,
  'key-outline': IconKey,
  // product & engineering
  'cog-outline': IconCog,
  tools: IconTools,
  'wrench-outline': IconWrench,
  'cube-outline': IconCube,
  'puzzle-outline': IconPuzzle,
  api: IconApi,
  'code-braces': IconCodeBraces,
  'database-outline': IconDatabase,
  'server-network-outline': IconServer,
  'cloud-outline': IconCloud,
  // people & organisation
  'account-outline': IconPerson,
  'account-group-outline': IconPersonGroup,
  'account-tie-outline': IconPersonTie,
  'handshake-outline': IconHandshake,
  'briefcase-outline': IconBriefcase,
  'office-building-outline': IconOfficeBuilding,
  domain: IconDomain,
  'sitemap-outline': IconSitemap,
  // work & process
  'rocket-launch-outline': IconRocket,
  'lightbulb-on-outline': IconLightbulb,
  'flask-outline': IconFlask,
  'calendar-check-outline': IconCalendarCheck,
  'clock-outline': IconClock,
  'timeline-check-outline': IconTimelineCheck,
  'road-variant': IconRoad,
  'sign-direction': IconSignDirection,
  // commercial
  'chart-line': IconChartLine,
  'chart-box-outline': IconChartBox,
  'currency-eur': IconCurrencyEur,
  'cash-multiple': IconCash,
  'receipt-text-outline': IconReceipt,
  'cart-outline': IconCart,
  'truck-outline': IconTruck,
  factory: IconFactory,
  // markers
  'alert-outline': IconAlert,
  fire: IconFire,
  'star-outline': IconStar,
  'bookmark-outline': IconBookmark,
  'tag-outline': IconTag,
  'folder-outline': IconFolder,
  'link-variant': IconLink,
  // contact & media
  'email-outline': IconEmail,
  'phone-outline': IconPhone,
  'map-marker-outline': IconMapMarker,
  earth: IconEarth,
  translate: IconTranslate,
  'image-outline': IconImage,
  'video-outline': IconVideo,
  'microphone-outline': IconMicrophone,
  'printer-outline': IconPrinter,
  'pencil-ruler': IconPencilRuler,
  'palette-outline': IconPalette,
  'heart-pulse': IconHeartPulse,
  leaf: IconLeaf,
}

/** Pickable icon names, in the curated order above. */
export const WIKI_ICON_NAMES = Object.keys(WIKI_ICONS)

/**
 * An emoji-only string: at least one pictographic character and nothing but
 * pictographs, skin-tone modifiers, joiners and variation selectors. Keycap
 * sequences ("1️⃣") are deliberately not recognised — they start
 * with a digit, and treating digits as emoji would misread ordinary text.
 */
const EMOJI_ONLY =
  /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Emoji_Modifier_Base}\u200D\uFE0F]+$/u
const HAS_PICTOGRAPHIC = /\p{Extended_Pictographic}/u

/** True when the value should be rendered as an emoji rather than looked up. */
export const isEmojiIcon = (value: string): boolean => {
  const trimmed = value.trim()
  // 16 code units is room for a joined family sequence without letting a whole
  // sentence of pictographs through.
  if (trimmed.length === 0 || trimmed.length > 16) return false
  return EMOJI_ONLY.test(trimmed) && HAS_PICTOGRAPHIC.test(trimmed)
}

export type ResolvedWikiIcon =
  | { kind: 'none' }
  | { kind: 'emoji'; value: string }
  | { kind: 'component'; component: Component }

/**
 * Resolve a stored icon value. An unknown name yields `none` instead of
 * throwing, so a config written by a newer frontend (or a typo) never breaks
 * a row — it just renders without an icon.
 */
export const resolveWikiIcon = (
  icon: string | null | undefined,
): ResolvedWikiIcon => {
  const trimmed = icon?.trim()
  if (!trimmed) return { kind: 'none' }
  if (isEmojiIcon(trimmed)) return { kind: 'emoji', value: trimmed }
  const component = WIKI_ICONS[trimmed]
  return component ? { kind: 'component', component } : { kind: 'none' }
}
