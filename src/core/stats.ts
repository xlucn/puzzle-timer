/*
 * stats.ts — session statistics: window averages, bests, mean, PB target.
 *
 * Architecture rule (see AGENTS.md): pure TypeScript, no `gi:*`, no Node APIs.
 *
 * The rules are ported from csTimer's GPL `timestat.js` (TimeStat) — the
 * *math*, not the DOM: DNF as ∞ so it sorts last and poisons an average only
 * when it survives trimming (WCA 9f8–9f9), trim [1,1] for ao5/ao12, no trim
 * for mo3 (any DNF → DNF, WCA 9f10), session mean over non-DNF solves only.
 * What csTimer does with a red-black tree over a sorted list, this module
 * does with plain array math: sessions hold thousands of solves, not
 * millions, and every call here is O(n) over the window or O(n) per window
 * scan — still microseconds.
 *
 * Units: everything in milliseconds, *effective* milliseconds — the caller
 * maps solves through `effectiveMs(timeMs, penalty)` first (src/core/time.ts),
 * so +2 and DNF are already folded in and DNF is `Infinity`.
 */

import type { Solve } from './session.js'
import { effectiveMs } from './time.js'

/** The averages we show. `single` is a "window" of size 1 for the dialog. */
export type StatKind = 'single' | 'mo3' | 'ao5' | 'ao12'

export interface WindowSpec {
  /** Solves in the window. */
  size: number
  /** Best and worst dropped from each end (WCA 9f8: [1,1] for ao5/ao12). */
  trimL: number
  trimR: number
}

const SPECS: Record<StatKind, WindowSpec> = {
  single: { size: 1, trimL: 0, trimR: 0 },
  // mo3 is the plain mean of three: no trimming, so any DNF poisons it.
  mo3: { size: 3, trimL: 0, trimR: 0 },
  ao5: { size: 5, trimL: 1, trimR: 1 },
  ao12: { size: 12, trimL: 1, trimR: 1 },
}

export function windowSpec(kind: StatKind): WindowSpec {
  return SPECS[kind]
}

/** The scored times of a session, in order — the input to everything below. */
export function effectiveTimes(solves: readonly Solve[]): number[] {
  return solves.map((solve) => effectiveMs(solve.timeMs, solve.penalty))
}

/**
 * Mean of `values` after dropping `trimL` smallest and `trimR` largest.
 *
 *   meanWindow([10, 11, 12, 13, 100], 1, 1) → 12   (the WCA ao5 shape)
 *   meanWindow([10, 11, Infinity, 13, 100], 1, 1) → 12   (one DNF, trimmed)
 *   meanWindow([10, 11, Infinity, Infinity, 100], 1, 1) → Infinity   (two)
 *
 * Sorted ascending, ∞ lands at the right end, so "did a DNF survive
 * trimming" is exactly "is an ∞ inside the kept span" — no sentinel values,
 * no special cases. Returns NaN only when the kept span is empty (a window
 * trimmed down to nothing, which our specs never do).
 */
export function meanWindow(
  values: readonly number[],
  trimL: number,
  trimR: number,
): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const kept = sorted.slice(trimL, sorted.length - trimR)
  if (kept.length === 0) return Number.NaN
  let sum = 0
  for (const value of kept) {
    if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY
    sum += value
  }
  return sum / kept.length
}

/**
 * The current value of a window — the last `size` solves (what the strip
 * under the timer shows). NaN while the session is too short: the UI shows
 * an em dash, not a misleading partial average.
 */
export function currentWindow(times: readonly number[], kind: StatKind): number {
  const { size, trimL, trimR } = SPECS[kind]
  if (kind === 'single') return times.length > 0 ? times[times.length - 1] : Number.NaN
  if (times.length < size) return Number.NaN
  return meanWindow(times.slice(times.length - size), trimL, trimR)
}

/**
 * The value of `kind` **as of each solve**: `out[i]` is the window *ending*
 * at `times[i]`, in session order (oldest → newest) — the number the solve
 * list shows in its ao5/ao12 columns for that row, so every row reads the
 * average it belonged to rather than today's.
 *
 * NaN until the window has filled, the same contract as `currentWindow`: the
 * caller decides what an incomplete window looks like (the list and the strip
 * both show an em dash), never a misleading partial average.
 *
 * `currentWindow(times, kind)` is the last element of this — kept separate
 * because the strip asks for that one number and should not pay for a session
 * scan to get it. This is O(n) windows of at most 12 numbers each, so a
 * rebuild of a few thousand solves stays in microseconds.
 */
export function windowAtEach(times: readonly number[], kind: StatKind): number[] {
  const { size, trimL, trimR } = SPECS[kind]
  const out: number[] = new Array(times.length)
  for (let end = 0; end < times.length; end += 1) {
    out[end] =
      end + 1 < size ? Number.NaN : meanWindow(times.slice(end + 1 - size, end + 1), trimL, trimR)
  }
  return out
}

/**
 * The best (smallest) completed window over the whole session, with the
 * index of its last solve (the list uses it to highlight the solves behind
 * a best average). DNF windows are ∞, so a finite window always wins; when
 * *every* window is a DNF the value is ∞ and the UI shows "DNF". Returns
 * null when no window has completed yet.
 */
export function bestWindow(
  times: readonly number[],
  kind: StatKind,
): { value: number; endIndex: number } | null {
  const { size, trimL, trimR } = SPECS[kind]
  if (kind === 'single') {
    let best = Number.POSITIVE_INFINITY
    let endIndex = -1
    times.forEach((value, index) => {
      // The first solve is always "the best so far", even when it is a DNF
      // (Infinity < Infinity is false, so the plain comparison needs the
      // endIndex guard to admit an all-DNF session at all).
      if (endIndex < 0 || value < best) {
        best = value
        endIndex = index
      }
    })
    return endIndex < 0 ? null : { value: best, endIndex }
  }
  if (times.length < size) return null

  let best = Number.POSITIVE_INFINITY
  let endIndex = -1
  for (let start = 0; start <= times.length - size; start++) {
    const value = meanWindow(times.slice(start, start + size), trimL, trimR)
    if (endIndex < 0 || value < best) {
      best = value
      endIndex = start + size - 1
    }
  }
  return { value: best, endIndex }
}

/** Best single (finite) time, or null when there is no finite solve. */
export function bestSingle(times: readonly number[]): number | null {
  let best = Number.POSITIVE_INFINITY
  for (const value of times) if (value < best) best = value
  return Number.isFinite(best) ? best : null
}

export interface SessionMean {
  /** Mean of the non-DNF solves; NaN when every solve is a DNF (or none). */
  mean: number
  dnfCount: number
  /** Solves that count towards the mean (total minus DNFs). */
  count: number
}

/**
 * The session mean: sum of the non-DNF effective times ÷ their count, plus
 * how many DNFs there are (csTimer's `getAllStats` — the mean excludes DNFs,
 * the count reports them).
 */
export function sessionMean(times: readonly number[]): SessionMean {
  let sum = 0
  let count = 0
  let dnfCount = 0
  for (const value of times) {
    if (Number.isFinite(value)) {
      sum += value
      count += 1
    } else {
      dnfCount += 1
    }
  }
  return { mean: count > 0 ? sum / count : Number.NaN, dnfCount, count }
}

/**
 * What the next solve must score to break a record:
 *
 *   { kind: 'value', ms } — this time or better (a multiple of 10 ms)
 *   { kind: 'always' }    — no possible next result fails to break it (or
 *                           the record itself is a DNF and any finite
 *                           result beats it)
 *   { kind: 'never' }     — no possible result breaks it
 *   { kind: 'none' }      — not enough solves for the record to exist yet
 *
 * For a window average the target is the *minimum* x with
 * meanWindow(kept ∪ {x}) < best, searched over multiples of 10 — monotone
 * in x, so a plain binary search applies (this is csTimer's `getThres`
 * computed by arithmetic instead of by walking its tree).
 */
export type PbTarget =
  | { kind: 'value'; ms: number }
  | { kind: 'always' }
  | { kind: 'never' }
  | { kind: 'none' }

/** Smallest multiple of 10 that is ≥ `value` (clamped at 0). */
const ceil10 = (value: number): number => Math.max(0, Math.ceil(value / 10) * 10)

export function pbTarget(times: readonly number[], kind: StatKind): PbTarget {
  const { size, trimL, trimR } = SPECS[kind]
  const best = bestWindow(times, kind)
  if (best === null) return { kind: 'none' }

  if (kind === 'single') {
    // Best single is a whole centisecond; one tick faster beats it.
    if (!Number.isFinite(best.value)) return { kind: 'always' } // every solve so far is a DNF
    if (best.value <= 0) return { kind: 'never' }
    return { kind: 'value', ms: best.value - 10 }
  }

  // The window the next solve will complete: the current last `size - 1`
  // solves (the oldest of today's last window drops out).
  const kept = times.slice(times.length - (size - 1))
  const meanWith = (x: number): number => meanWindow([...kept, x], trimL, trimR)

  // Every completed window is a DNF: any finite result sets a real best.
  if (!Number.isFinite(best.value)) {
    return Number.isFinite(meanWith(0)) ? { kind: 'always' } : { kind: 'never' }
  }

  if (meanWith(Number.POSITIVE_INFINITY) < best.value) return { kind: 'always' }
  if (!(meanWith(0) < best.value)) return { kind: 'never' }

  // The target is the *largest* time that still beats the best — meanWith is
  // monotone non-decreasing, so P(x) = meanWith(x) < best holds on [0, b] and
  // fails after: binary-search the boundary over multiples of 10. The upper
  // bound must have P false: `keptMax + 10` covers the case where a large
  // enough x sits where ∞ would (and meanWith(∞) ≥ best was checked above),
  // and `neff·best + 10` covers every case where x stays inside the kept span
  // (mean ≥ x/neff > best there).
  let keptMax = 0
  for (const value of kept) {
    if (Number.isFinite(value)) keptMax = Math.max(keptMax, value)
  }
  const neff = size - trimL - trimR
  const hi = Math.max(ceil10(keptMax + 10), ceil10(neff * best.value + 10))

  let lowTicks = 0 // P(lowTicks * 10) is known true
  let highTicks = Math.round(hi / 10) // P(highTicks * 10) is known false or boundary-beyond
  while (lowTicks + 1 < highTicks) {
    const midTicks = lowTicks + Math.floor((highTicks - lowTicks) / 2)
    if (meanWith(midTicks * 10) < best.value) lowTicks = midTicks
    else highTicks = midTicks
  }
  // lowTicks is the largest tick verified true (or 0, still true by the
  // check above); highTicks is the first false — or lowTicks + 1 when the
  // whole range holds, in which case hi itself is a valid target.
  const answer = meanWith(highTicks * 10) < best.value ? highTicks : lowTicks
  return { kind: 'value', ms: answer * 10 }
}

/** Everything the Statistics dialog and the strip need, in one pass. */
export interface SessionStats {
  times: number[]
  /** Current / best value per kind; `current` is NaN while incomplete. */
  current: Record<StatKind, number>
  best: Record<StatKind, { value: number; endIndex: number } | null>
  /** Per-kind PB target (same for every kind via `pbTarget`). */
  target: Record<StatKind, PbTarget>
  mean: SessionMean
  bestSingleMs: number | null
}

const KINDS: StatKind[] = ['single', 'mo3', 'ao5', 'ao12']

export function sessionStats(solves: readonly Solve[]): SessionStats {
  const times = effectiveTimes(solves)
  const current = {} as SessionStats['current']
  const best = {} as SessionStats['best']
  const target = {} as SessionStats['target']
  for (const kind of KINDS) {
    current[kind] = currentWindow(times, kind)
    best[kind] = bestWindow(times, kind)
    target[kind] = pbTarget(times, kind)
  }
  return {
    times,
    current,
    best,
    target,
    mean: sessionMean(times),
    bestSingleMs: bestSingle(times),
  }
}
