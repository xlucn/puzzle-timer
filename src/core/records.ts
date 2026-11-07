/*
 * records.ts — the improvement history behind each personal best.
 *
 * Architecture rule (see AGENTS.md): pure TypeScript, no `gi:*`, no Node APIs.
 *
 * `pbHistory(solves, kind)` walks the session once and keeps the solves that
 * *strictly* improved the record. Both halves matter in practice: a window
 * can improve without a new fastest single (a steady run of 12s beats an
 * 11.5s single-adjacent ao5), so Single and ao5 have different histories from
 * the same list of solves.
 *
 * A DNF is ∞ (src/core/time.ts): it can never improve a finite record and it
 * can never *be* one, so an all-DNF session has an empty history rather than
 * a meaningless first entry. Ties do not count — "equal to my PB" is not a
 * new PB.
 *
 * The date is the moment the solve *completed* the record: for a window that
 * is the last solve of the window, because that is when the average became
 * real. Imported solves may have no date (`createdAtMs` 0); the UI then falls
 * back to solve numbers, which are always present.
 */

import type { Solve } from './session.js'
import { effectiveTimes, type StatKind, windowAtEach } from './stats.js'

export interface PbRecord {
  /** The effective time or average that was the new best, in ms. */
  value: number
  /** When the solve that completed it finished; 0 when the date is unknown. */
  setAtMs: number
  /**
   * When the next improvement finished, or null while this record still
   * stands. May be 0 when that solve has no date.
   */
  heldUntilMs: number | null
  /** The solve that completed the record (the window's last solve). */
  solveId: number
  /** Chronological index of that solve, 0-based. */
  index: number
}

/**
 * Every strict improvement of `kind`, oldest first. `single` records use the
 * solve's own time; every other kind uses the completed window ending at that
 * solve.
 */
export function pbHistory(solves: readonly Solve[], kind: StatKind): PbRecord[] {
  const values = windowAtEach(effectiveTimes(solves), kind)
  const records: PbRecord[] = []

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    // NaN is an incomplete window; ∞ is a DNF — neither can set a record.
    if (Number.isNaN(value) || !Number.isFinite(value)) continue

    const previous = records[records.length - 1]
    if (previous !== undefined && value >= previous.value) continue
    if (previous !== undefined) previous.heldUntilMs = solves[index].createdAtMs

    records.push({
      value,
      setAtMs: solves[index].createdAtMs,
      heldUntilMs: null,
      solveId: solves[index].id,
      index,
    })
  }

  return records
}

/**
 * Number of solves that elapsed before the record was broken, or between the
 * record and the newest solve while it still stands. A useful "held for"
 * figure when dates are unavailable; 0 means the record was set on the
 * latest solve.
 */
export function heldSolves(record: PbRecord, total: number, next: PbRecord | undefined): number {
  return (next?.index ?? total - 1) - record.index
}

/**
 * Whole local calendar days between setting and breaking a record, or null
 * when either date is unknown. A same-day improvement reads as 0, which the
 * UI presents as "same day" rather than "0 days".
 */
export function heldDays(record: PbRecord): number | null {
  if (record.setAtMs <= 0 || record.heldUntilMs === null || record.heldUntilMs <= 0) return null
  const start = startOfDay(record.setAtMs)
  const end = startOfDay(record.heldUntilMs)
  return Math.max(0, Math.round((end - start) / 86_400_000))
}

function startOfDay(epochMs: number): number {
  const date = new Date(epochMs)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}
