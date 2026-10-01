/*
 * time.ts — time formatting for the timer display.
 *
 * Architecture rule (see AGENTS.md): this module is pure TypeScript. It
 * imports neither `gi:*` nor Node APIs, so it can be unit-tested with Vitest
 * without a display server.
 */

export interface FormatOptions {
  /**
   * Show milliseconds (3 decimals) instead of the default centiseconds (2).
   * csTimer's "use milliseconds" option.
   */
  useMs?: boolean
}

/**
 * A WCA penalty on a solve. Absent everywhere it is optional (`Solve.penalty`)
 * means the solve is OK — session files from M2 stay valid, and a file that
 * never had a penalty carries no new bytes.
 *
 *   'plus2' — 2 seconds added (measured time + 2000 ms)
 *   'dnf'   — the attempt does not count; in statistics it behaves as ∞
 *             (ported from csTimer's rule: DNF sorts last, counts as the
 *             worst solve, and poisons an average only if it survives
 *             trimming)
 */
export type Penalty = 'plus2' | 'dnf'

/** WCA +2 penalty, in milliseconds. */
export const PLUS2_MS = 2000

/**
 * The time a solve is *scored* at, in milliseconds:
 *
 *   effectiveMs(12_345)           → 12_340
 *   effectiveMs(12_345, 'plus2')  → 14_340
 *   effectiveMs(12_345, 'dnf')    → Infinity      (DNF-as-∞)
 *
 * The value is truncated to centiseconds first, which is what WCA Regulation
 * 9f1 measures results to and what csTimer's statistics do (`roundMilli` of
 * 10 by default): stats are computed on the times as they are read, not on
 * the sub-centisecond residue the timer happened to catch. Truncating the
 * *sum* for +2 is equivalent to truncating first (2000 is a multiple of 10).
 *
 * Returning ∞ rather than a sentinel like -1 is what lets the averaging math
 * in stats.ts stay plain arithmetic: ∞ sorts last on its own, so one DNF in
 * an ao5 falls out as the worst solve and is trimmed, while two DNFs leave an
 * ∞ in the mean — exactly the WCA rules (9f8–9f9, 9f10).
 */
export function effectiveMs(timeMs: number, penalty?: Penalty): number {
  if (penalty === 'dnf') return Number.POSITIVE_INFINITY
  const scored = penalty === 'plus2' ? timeMs + PLUS2_MS : timeMs
  return Math.floor(scored / 10) * 10
}

/**
 * How one solve is written down (the list, the footer, the timer's result):
 *
 *   formatSolve(12_345)           → "12.34"
 *   formatSolve(12_345, 'plus2')  → "14.34+"
 *   formatSolve(12_345, 'dnf')    → "DNF"
 *
 * The trailing '+' on a +2 is csTimer's own notation (`pretty()` appends it
 * after the penalised time): the number shown is the number that scores.
 */
export function formatSolve(timeMs: number, penalty?: Penalty): string {
  if (penalty === 'dnf') return 'DNF'
  const scored = formatTime(effectiveMs(timeMs, penalty))
  return penalty === 'plus2' ? `${scored}+` : scored
}

/**
 * An average or mean, which WCA Regulation 9f1 *rounds* to the nearest
 * hundredth (singles are truncated — that is `formatTime` itself):
 *
 *   formatAverage(10_866) → "10.87"
 *   formatAverage(10_833) → "10.83"
 *   formatAverage(Infinity) → "DNF"
 *
 * Averages do not always land on a whole centisecond (a mean of three is a
 * sum divided by three), so this is a genuine rounding step, unlike every
 * other display path in this file.
 */
export function formatAverage(ms: number): string {
  if (Number.isNaN(ms)) return 'DNF'
  if (!Number.isFinite(ms)) return ms > 0 ? 'DNF' : '0.00'
  return formatTime(Math.round(ms / 10) * 10)
}

/**
 * Format an elapsed time the way a speedcubing timer displays it:
 *
 *   formatTime(0)        → "0.00"
 *   formatTime(999.9)    → "0.99"      (truncated, never rounded up)
 *   formatTime(12345)    → "12.34"
 *   formatTime(62345)    → "1:02.34"
 *   formatTime(62345, { useMs: true }) → "1:02.345"
 *
 * Truncation (not rounding) matters: a timer must never display a time that
 * is faster than the measured one.
 */
/**
 * Wall-clock stamp for the solve list:
 *
 *   formatTimestamp(sameDay,   now) → "14:32"
 *   formatTimestamp(earlier,   now) → "09-30 14:32"
 *   formatTimestamp(otherYear, now) → "2025-12-31 14:32"
 *
 * Local time, and the day is only spelled out when it is not today — that
 * keeps the sidebar column narrow while still telling yesterday's solves
 * apart. `now` is injectable so the day/year branches are testable without
 * depending on the machine's clock or time zone (the tests build their dates
 * with `new Date(y, m, d, h, min)`, i.e. local time on purpose).
 */
export function formatTimestamp(epochMs: number, now: number = Date.now()): string {
  if (!Number.isFinite(epochMs)) return ''

  const then = new Date(epochMs)
  const today = new Date(now)
  const clock = `${pad2(then.getHours())}:${pad2(then.getMinutes())}`

  const sameDay =
    then.getFullYear() === today.getFullYear() &&
    then.getMonth() === today.getMonth() &&
    then.getDate() === today.getDate()
  if (sameDay) return clock

  const date = `${pad2(then.getMonth() + 1)}-${pad2(then.getDate())}`
  return then.getFullYear() === today.getFullYear()
    ? `${date} ${clock}`
    : `${then.getFullYear()}-${date} ${clock}`
}

const pad2 = (value: number): string => String(value).padStart(2, '0')

/**
 * The complete wall-clock stamp for the edit dialog: year to second, always
 * spelled out —
 *
 *   formatFullTimestamp(...) → "2026-10-01 22:49:58"
 *
 * Local time, no "today" elision: this is the record's exact moment, read
 * as data (formatTimestamp's day-only form serves the narrow list column,
 * not a dialog whose whole point is the details — user call, 2026-10-01).
 */
export function formatFullTimestamp(epochMs: number): string {
  if (!Number.isFinite(epochMs)) return ''
  const then = new Date(epochMs)
  const date = `${then.getFullYear()}-${pad2(then.getMonth() + 1)}-${pad2(then.getDate())}`
  const clock = `${pad2(then.getHours())}:${pad2(then.getMinutes())}:${pad2(then.getSeconds())}`
  return `${date} ${clock}`
}

export function formatTime(ms: number, options: FormatOptions = {}): string {
  const useMs = options.useMs ?? false

  if (!Number.isFinite(ms) || ms < 0) ms = 0

  const unitsPerSecond = useMs ? 1000 : 100
  const msPerUnit = 1000 / unitsPerSecond

  const totalUnits = Math.floor(ms / msPerUnit)
  const fraction = totalUnits % unitsPerSecond
  const totalSeconds = Math.floor(totalUnits / unitsPerSecond)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60)

  const fractionStr = String(fraction).padStart(useMs ? 3 : 2, '0')
  const secondsStr = String(seconds).padStart(2, '0')

  return minutes > 0
    ? `${minutes}:${secondsStr}.${fractionStr}`
    : `${seconds}.${fractionStr}`
}
