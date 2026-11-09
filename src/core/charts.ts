/*
 * charts.ts — data for the Statistics charts: a time histogram and a trend.
 *
 * Architecture rule (AGENTS.md): pure TypeScript, no `gi:*`, no Node APIs.
 *
 * The rules are ported from csTimer's GPL `distribution.js` and `trend.js` —
 * the math, not the DOM. The bin width is one tenth of the finite time range,
 * rounded up to csTimer's own step ladder (100 ms … 100 s); the trend axis
 * snaps outward to whole steps. DNFs are gaps, never points at infinity:
 * they stay out of the bins and out of every line.
 *
 * Times are effective milliseconds (`core/stats.ts`), so +2 and DNF already
 * happened before this module sees them.
 */

import { windowAtEach } from './stats.js'

/** csTimer's automatic precision ladder, in milliseconds. */
const STEPS = [100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000] as const

/**
 * Roughly ten bins across the range, snapped to the ladder — csTimer's
 * `getBestDiff()` with automatic precision. A range of one solve still gets
 * the 100 ms floor rather than a zero-width bin.
 */
function chooseStep(rangeMs: number): number {
  const target = rangeMs / 10
  for (const step of STEPS) {
    if (target < step) return step
  }
  return STEPS[STEPS.length - 1]
}

export interface HistogramBin {
  /** Inclusive lower bound, ms. */
  startMs: number
  /** Exclusive upper bound (except conceptually the final bin), ms. */
  endMs: number
  count: number
  /** Finite solves in this bin and every earlier one. */
  cumulative: number
}

export interface Histogram {
  bins: HistogramBin[]
  stepMs: number
  /** Finite solves represented by the bins. */
  total: number
  dnfCount: number
}

/**
 * Count finite times into equal bins. The bins run from the bin containing
 * the best time to the bin containing the worst, including empty bins in
 * between so a gap in the distribution is visible. `null` when the session
 * has no finite solve at all.
 */
export function histogram(times: readonly number[]): Histogram | null {
  let best = Number.POSITIVE_INFINITY
  let worst = Number.NEGATIVE_INFINITY
  let total = 0
  let dnfCount = 0

  for (const time of times) {
    if (!Number.isFinite(time)) {
      dnfCount += 1
      continue
    }
    total += 1
    if (time < best) best = time
    if (time > worst) worst = time
  }
  if (total === 0) return null

  const stepMs = chooseStep(worst - best)
  const first = Math.floor(best / stepMs)
  const last = Math.floor(worst / stepMs)
  const counts = new Map<number, number>()
  for (const time of times) {
    if (!Number.isFinite(time)) continue
    const bin = Math.floor(time / stepMs)
    counts.set(bin, (counts.get(bin) ?? 0) + 1)
  }

  const bins: HistogramBin[] = []
  let cumulative = 0
  for (let index = first; index <= last; index += 1) {
    const count = counts.get(index) ?? 0
    cumulative += count
    bins.push({
      startMs: index * stepMs,
      endMs: (index + 1) * stepMs,
      count,
      cumulative,
    })
  }
  return { bins, stepMs, total, dnfCount }
}

export type TrendKind = 'single' | 'ao5' | 'ao12'

/** A point in chart space: `x` and `y` are both 0 (left/bottom) to 1. */
export interface TrendPoint {
  x: number
  y: number
}

export interface TrendSeries {
  kind: TrendKind
  points: TrendPoint[]
}

export interface TrendTick {
  valueMs: number
  /** Vertical position, 0 at the bottom of the plot and 1 at the top. */
  y: number
}

export interface Trend {
  /** Single, ao5, ao12 — in that draw order. */
  series: TrendSeries[]
  ticks: TrendTick[]
  plotMinMs: number
  plotMaxMs: number
  stepMs: number
  /** All solves, DNFs included (the x axis counts them). */
  count: number
  dnfCount: number
}

/**
 * The trend chart's series and value axis. X is solve order: 0 is the oldest
 * solve and 1 the newest, so a DNF leaves a horizontal gap rather than a
 * spike. The ao5/ao12 points sit at the *last* solve of their window, the
 * same x the solve list gives that average.
 */
export function trend(times: readonly number[]): Trend | null {
  let best = Number.POSITIVE_INFINITY
  let worst = Number.NEGATIVE_INFINITY
  let count = 0
  let dnfCount = 0

  for (const time of times) {
    if (!Number.isFinite(time)) {
      dnfCount += 1
      continue
    }
    count += 1
    if (time < best) best = time
    if (time > worst) worst = time
  }
  if (count === 0) return null

  const stepMs = chooseStep(worst - best)
  const plotMinMs = Math.floor(best / stepMs) * stepMs
  let plotMaxMs = Math.ceil(worst / stepMs) * stepMs
  if (plotMaxMs === plotMinMs) plotMaxMs = plotMinMs + stepMs
  const heightMs = plotMaxMs - plotMinMs

  const total = times.length
  const xAt = (index: number): number => (total <= 1 ? 0.5 : index / (total - 1))
  const yAt = (value: number): number =>
    Math.max(0, Math.min(1, (value - plotMinMs) / heightMs))

  const raw: TrendPoint[] = []
  times.forEach((time, index) => {
    if (Number.isFinite(time)) raw.push({ x: xAt(index), y: yAt(time) })
  })

  const series: TrendSeries[] = [{ kind: 'single', points: raw }]
  for (const kind of ['ao5', 'ao12'] as const) {
    const values = windowAtEach(times, kind)
    const points: TrendPoint[] = []
    values.forEach((value, index) => {
      if (Number.isFinite(value)) points.push({ x: xAt(index), y: yAt(value) })
    })
    series.push({ kind, points })
  }

  const ticks: TrendTick[] = []
  for (let valueMs = plotMinMs; valueMs <= plotMaxMs; valueMs += stepMs) {
    ticks.push({ valueMs, y: (valueMs - plotMinMs) / heightMs })
  }
  return { series, ticks, plotMinMs, plotMaxMs, stepMs, count, dnfCount }
}
