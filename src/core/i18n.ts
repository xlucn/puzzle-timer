/*
 * i18n.ts — the runtime catalog lookup.
 *
 * Pure TypeScript (AGENTS.md invariant 1): the locale is module state, not a
 * translator object threaded through every widget factory (PLAN.md decision
 * 11). UI code imports `t` and calls it while building a widget, so a locale
 * chosen before the window is assembled reaches every label.
 *
 * `src/locales/en.ts` is the source of truth; every other catalog is typed
 * `Record<MessageKey, Message>`, so a missing key is a compile error rather
 * than a raw key on screen. Keys do not exist for the two numeric formats —
 * times stay in src/core/time.ts, and the compact list timestamps stay
 * deliberately numeric (PLAN.md §6, M9).
 */
import {
  en,
  enGroupNames,
  enSectionNames,
  type GroupNameKey,
  type Message,
  type MessageKey,
  type SectionNameKey,
} from '../locales/en.js'
import {
  zhCN,
  zhCNGroupNames,
  zhCNSectionNames,
} from '../locales/zh-CN.js'

/** The preference's value: `system` resolves once, at startup. */
export type Language = 'system' | 'en' | 'zh-CN'

/** Every value is selectable in Preferences / hand-editable in prefs.json. */
export const LANGUAGES: readonly Language[] = ['system', 'en', 'zh-CN']

/** A catalog we actually carry. */
export type SupportedLocale = 'en' | 'zh-CN'

const CATALOGS: Record<SupportedLocale, Record<MessageKey, Message>> = {
  en,
  'zh-CN': zhCN,
}

const GROUP_CATALOGS: Record<SupportedLocale, Record<GroupNameKey, string>> = {
  en: enGroupNames,
  'zh-CN': zhCNGroupNames,
}

const SECTION_CATALOGS: Record<SupportedLocale, Record<SectionNameKey, string>> = {
  en: enSectionNames,
  'zh-CN': zhCNSectionNames,
}

let locale: SupportedLocale = 'en'

/** Intl objects are expensive to construct, so one per locale is enough. */
const pluralRules = new Map<SupportedLocale, Intl.PluralRules>()
const countFormats = new Map<SupportedLocale, Intl.NumberFormat>()
const dateFormats = new Map<string, Intl.DateTimeFormat>()

/**
 * Map an arbitrary BCP 47 tag onto a catalog. Only Chinese is distinguished:
 * `zh`, `zh-CN`, `zh-Hans-CN` and `zh-TW` all read the same (simplified)
 * catalog; everything else falls back to English rather than showing raw
 * keys.
 */
export function normalizeLocale(tag: string): SupportedLocale {
  return tag.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

/** Pick the catalog for the run. Returns what was selected, for logging. */
export function setLocale(tag: string): SupportedLocale {
  locale = normalizeLocale(tag)
  return locale
}

/** The catalog in force. */
export function getLocale(): SupportedLocale {
  return locale
}

/**
 * Resolve the stored `language` preference. `system` asks ICU for the
 * process locale (`LANG` / the desktop session), so no `gi:` or Node API is
 * needed here.
 */
export function resolveLanguage(language: Language): SupportedLocale {
  if (language !== 'system') return language
  const system = Intl.DateTimeFormat().resolvedOptions().locale
  return normalizeLocale(system)
}

/** Format a count with the catalog's digit grouping. */
export function formatCount(value: number): string {
  let format = countFormats.get(locale)
  if (format === undefined) {
    format = new Intl.NumberFormat(locale)
    countFormats.set(locale, format)
  }
  return format.format(value)
}

/** Format a date for the places that have room (the Records tab, heat-map tooltips). */
export function formatDate(
  value: Date | number,
  options?: Intl.DateTimeFormatOptions,
): string {
  const key = `${locale}|${JSON.stringify(options ?? {})}`
  let format = dateFormats.get(key)
  if (format === undefined) {
    format = new Intl.DateTimeFormat(locale, options)
    dateFormats.set(key, format)
  }
  return format.format(value)
}

function interpolate(text: string, params?: Record<string, string | number>): string {
  if (params === undefined) return text
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name]
    if (value === undefined) return whole
    return typeof value === 'number' ? formatCount(value) : value
  })
}

function choosePlural(message: Message, count: number | undefined): string {
  if (typeof message === 'string') return message
  if (count === undefined) return message.other
  let rules = pluralRules.get(locale)
  if (rules === undefined) {
    rules = new Intl.PluralRules(locale)
    pluralRules.set(locale, rules)
  }
  return message[rules.select(count)] ?? message.other
}

/**
 * Translate one key. A plural value picks its form from `params.count`; a
 * missing catalog key falls back to English, then to the key itself, so a
 * stale catalog can never blank a control.
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const message = CATALOGS[locale][key] ?? en[key] ?? key
  const count = typeof params?.count === 'number' ? params.count : undefined
  return interpolate(choosePlural(message, count), params)
}

/**
 * A scramble category by the catalogue's own name. The catalogue keeps its
 * English keys (they are stable identifiers, not display text), and the
 * picker/header show this translated form; an unknown name passes through.
 */
export function tGroup(name: string): string {
  const groups = GROUP_CATALOGS[locale]
  return Object.hasOwn(groups, name) ? groups[name as GroupNameKey] : name
}

/** A picker section title (`WCA`, `Other`, …); unknown names pass through. */
export function tSection(name: string): string {
  const sections = SECTION_CATALOGS[locale]
  return Object.hasOwn(sections, name) ? sections[name as SectionNameKey] : name
}
