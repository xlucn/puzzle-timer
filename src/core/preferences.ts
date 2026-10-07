/*
 * preferences.ts — the user's settings (M5).
 *
 * Architecture rule (AGENTS.md): pure TypeScript — no `gi:*`, no Node APIs.
 * This module owns the *shape*, the defaults and the validation of what comes
 * off disk; where it is stored is src/platform/store.ts and how it is shown is
 * src/ui/preferences.ts. Everything that reads a setting reads it from the
 * Preferences handed back at startup or by the dialog's change callback, so
 * the values can never drift apart between the UI and the timer.
 *
 * The file on disk is hand-editable (like the session index), so every field
 * is validated individually: a bad value falls back to its default rather
 * than taking the whole file down — one wrong number must not cost the user
 * their settings.
 */

/** Light/dark theming: `system` follows the desktop (Adw.ColorScheme). */
export type ColorScheme = 'system' | 'light' | 'dark'

export interface Preferences {
  /**
   * How long the start key must be held before the timer arms — csTimer's
   * "time of keeping space down", in milliseconds so the timer can use it
   * directly (the dialog shows seconds).
   */
  holdThresholdMs: number
  /** WCA inspection: the 15 s countdown before the solve starts. */
  inspection: boolean
  /** The inspection's 8 s / 12 s acoustic cues. */
  inspectionSound: boolean
  /** Show a picture of the scramble when its type has one (SVG, via Gtk.Svg). */
  scrambleImage: boolean
  /** Light/dark theming; `system` follows the desktop. */
  colorScheme: ColorScheme
}

/** Bumped only when the preferences file's shape changes incompatibly. */
export const PREFERENCES_FILE_VERSION = 1

export const MIN_HOLD_THRESHOLD_MS = 0
export const MAX_HOLD_THRESHOLD_MS = 2_000
/** Spin-row step in the dialog, in milliseconds (0.05 s). */
export const HOLD_THRESHOLD_STEP_MS = 50

export const DEFAULT_PREFERENCES: Preferences = {
  holdThresholdMs: 300,
  inspection: true,
  inspectionSound: true,
  scrambleImage: true,
  colorScheme: 'system',
}

const COLOR_SCHEMES: readonly ColorScheme[] = ['system', 'light', 'dark']

/**
 * Coerce whatever came off disk (or out of the dialog) into a usable
 * Preferences. Unknown shapes and individually bad fields fall back to their
 * defaults — the file is hand-editable and losing everything over one bad
 * value would be worse than ignoring it.
 */
export function normalizePreferences(value: unknown): Preferences {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_PREFERENCES }
  const raw = value as Record<string, unknown>

  const hold = raw.holdThresholdMs
  const holdThresholdMs =
    typeof hold === 'number' && Number.isFinite(hold)
      ? Math.min(MAX_HOLD_THRESHOLD_MS, Math.max(MIN_HOLD_THRESHOLD_MS, Math.round(hold)))
      : DEFAULT_PREFERENCES.holdThresholdMs

  const scheme = raw.colorScheme
  const colorScheme: ColorScheme =
    typeof scheme === 'string' && (COLOR_SCHEMES as readonly string[]).includes(scheme)
      ? (scheme as ColorScheme)
      : DEFAULT_PREFERENCES.colorScheme

  const flag = (key: keyof Preferences): boolean =>
    typeof raw[key] === 'boolean'
      ? (raw[key] as boolean)
      : DEFAULT_PREFERENCES[key] as boolean

  return {
    holdThresholdMs,
    inspection: flag('inspection'),
    inspectionSound: flag('inspectionSound'),
    scrambleImage: flag('scrambleImage'),
    colorScheme,
  }
}
