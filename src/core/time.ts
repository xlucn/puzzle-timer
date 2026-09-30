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
