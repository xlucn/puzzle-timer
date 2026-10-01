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
