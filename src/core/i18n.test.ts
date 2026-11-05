/*
 * i18n.test.ts — the catalog runtime contract.
 *
 * The compiler already enforces that zh-CN covers every English key (it is a
 * Record of MessageKey). These tests cover the parts a type cannot: tag
 * normalization, plural selection, interpolation, and the catalogue-name
 * passthrough the picker relies on.
 */
import { describe, expect, it } from 'vitest'

import {
  formatCount,
  formatDate,
  getLocale,
  normalizeLocale,
  resolveLanguage,
  setLocale,
  t,
  tGroup,
  tSection,
} from './i18n.js'
import { SCRAMBLE_GROUPS, SCRAMBLE_SECTIONS } from './scrambleTypes.js'
import { en, enGroupNames, enSectionNames } from '../locales/en.js'
import {
  zhCN,
  zhCNGroupNames,
  zhCNSectionNames,
} from '../locales/zh-CN.js'

describe('i18n', () => {
  it('normalizes a tag to a catalog we carry', () => {
    expect(normalizeLocale('en')).toBe('en')
    expect(normalizeLocale('en-GB')).toBe('en')
    expect(normalizeLocale('zh')).toBe('zh-CN')
    expect(normalizeLocale('zh-Hans-CN')).toBe('zh-CN')
    expect(normalizeLocale('zh-TW')).toBe('zh-CN')
    expect(normalizeLocale('fr-FR')).toBe('en')
  })

  it('resolves the system preference to a supported locale', () => {
    expect(resolveLanguage('en')).toBe('en')
    expect(resolveLanguage('zh-CN')).toBe('zh-CN')
    expect(['en', 'zh-CN']).toContain(resolveLanguage('system'))
  })

  it('switches catalogs and falls back to English', () => {
    setLocale('en')
    expect(getLocale()).toBe('en')
    expect(t('common.cancel')).toBe('Cancel')

    setLocale('zh-CN')
    expect(getLocale()).toBe('zh-CN')
    expect(t('common.cancel')).toBe('取消')

    setLocale('en')
  })

  it('interpolates named params and formats counts', () => {
    expect(t('session.delete.title', { name: 'Weekly' })).toBe('Delete “Weekly”?')
    expect(t('stats.counted', { count: 4, total: 7 })).toBe('4 of 7 counted')
  })

  it('selects plural forms from the count', () => {
    setLocale('en')
    expect(t('toast.solvesDeleted', { count: 1 })).toBe('Solve deleted')
    expect(t('toast.solvesDeleted', { count: 3 })).toBe('3 solves deleted')
    expect(t('stats.solves', { count: 1 })).toBe('1 solve')
    expect(t('stats.solves', { count: 3 })).toBe('3 solves')

    setLocale('zh-CN')
    expect(t('toast.solvesDeleted', { count: 1 })).toBe('已删除 1 条成绩')
    expect(t('toast.solvesDeleted', { count: 3 })).toBe('已删除 3 条成绩')
    setLocale('en')
  })

  it('translates catalogue names but passes unknown ones through', () => {
    setLocale('zh-CN')
    expect(tGroup('Megaminx')).toBe('五魔方')
    expect(tGroup('Not a category')).toBe('Not a category')
    expect(tSection('Other')).toBe('其他')
    expect(tSection('Unknown')).toBe('Unknown')
    setLocale('en')
    expect(tGroup('Megaminx')).toBe('Megaminx')
    expect(tSection('Other')).toBe('Other')
  })

  it('formats counts and dates with the active locale', () => {
    expect(formatCount(1234)).toMatch(/1.?234/)
    const date = formatDate(new Date(2026, 0, 2), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    expect(date).toContain('2026')
  })

  it('covers every catalogue group and section in both catalogs', () => {
    const groups = SCRAMBLE_GROUPS.map((group) => group.name)
    expect(Object.keys(enGroupNames)).toEqual(groups)
    expect(Object.keys(zhCNGroupNames)).toEqual(groups)

    const sections = SCRAMBLE_SECTIONS.map((section) => section.name)
    expect(Object.keys(enSectionNames)).toEqual(sections)
    expect(Object.keys(zhCNSectionNames)).toEqual(sections)
  })

  it('keeps both catalogs on the same key set', () => {
    expect(Object.keys(zhCN)).toEqual(Object.keys(en))
  })
})
