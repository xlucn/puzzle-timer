/*
 * preferences.test.ts — the settings contract.
 *
 * The file is hand-editable, so every field is validated on its own: a bad
 * value must fall back to its default without taking the rest down.
 */
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PREFERENCES,
  MAX_HOLD_THRESHOLD_MS,
  MIN_HOLD_THRESHOLD_MS,
  normalizePreferences,
} from './preferences.js'

describe('normalizePreferences', () => {
  it('returns the defaults for a missing or unusable file', () => {
    expect(normalizePreferences(undefined)).toEqual(DEFAULT_PREFERENCES)
    expect(normalizePreferences(null)).toEqual(DEFAULT_PREFERENCES)
    expect(normalizePreferences('settings')).toEqual(DEFAULT_PREFERENCES)
    expect(normalizePreferences(42)).toEqual(DEFAULT_PREFERENCES)
  })

  it('keeps every good value as it is', () => {
    const stored = {
      holdThresholdMs: 550,
      inspection: false,
      inspectionSound: false,
      scrambleImage: false,
      colorScheme: 'dark',
    }
    expect(normalizePreferences(stored)).toEqual(stored)
  })

  it('clamps a hold threshold into the usable range', () => {
    expect(normalizePreferences({ holdThresholdMs: -100 }).holdThresholdMs).toBe(
      MIN_HOLD_THRESHOLD_MS,
    )
    expect(normalizePreferences({ holdThresholdMs: 99_999 }).holdThresholdMs).toBe(
      MAX_HOLD_THRESHOLD_MS,
    )
    expect(normalizePreferences({ holdThresholdMs: 1234.4 }).holdThresholdMs).toBe(1234)
  })

  it('falls back per field, not per file', () => {
    const prefs = normalizePreferences({
      holdThresholdMs: 'soon', // not a number → default
      inspection: 'yes', // not a boolean → default
      inspectionSound: false, // the one good value in the file
      scrambleImage: 0, // not a boolean → default
      colorScheme: 'neon', // unknown → default
    })
    expect(prefs).toEqual({ ...DEFAULT_PREFERENCES, inspectionSound: false })
  })

  it('rejects an unknown colour scheme but keeps the rest of the file', () => {
    const prefs = normalizePreferences({ colorScheme: 'sepia', inspection: false })
    expect(prefs.colorScheme).toBe('system')
    expect(prefs.inspection).toBe(false)
  })

  it('ignores NaN and Infinity for the hold threshold', () => {
    expect(normalizePreferences({ holdThresholdMs: Number.NaN }).holdThresholdMs).toBe(
      DEFAULT_PREFERENCES.holdThresholdMs,
    )
    expect(normalizePreferences({ holdThresholdMs: Number.POSITIVE_INFINITY }).holdThresholdMs).toBe(
      DEFAULT_PREFERENCES.holdThresholdMs,
    )
  })
})
