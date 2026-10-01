/*
 * stats.test.ts — the statistics rules, checked against hand-worked examples.
 *
 * The WCA-shaped cases (ao5 trimming, DNF-as-∞, mo3 poisoning) are the ones
 * csTimer's timestat.js gets called about; each expectation below is worked
 * out in the test itself so the rule stays visible next to the number.
 */
import { describe, expect, it } from 'vitest'

import type { Solve } from './session.js'
import {
  bestSingle,
  bestWindow,
  currentWindow,
  effectiveTimes,
  meanWindow,
  pbTarget,
  sessionMean,
  sessionStats,
  windowSpec,
} from './stats.js'

const INF = Number.POSITIVE_INFINITY

describe('meanWindow — trimming', () => {
  it('drops the best and the worst of an ao5 (WCA 9f8)', () => {
    // sorted: 9.80, 10.00, 10.20, 10.40, 12.00 → drop 9.80 and 12.00
    expect(meanWindow([10_400, 12_000, 10_000, 9_800, 10_200], 1, 1)).toBe(
      (10_000 + 10_200 + 10_400) / 3,
    )
  })

  it('keeps every solve when nothing is trimmed (mo3)', () => {
    expect(meanWindow([10_000, 11_000, 13_000], 0, 0)).toBe(34_000 / 3)
  })

  it('trims a single DNF away — one DNF still yields an ao5', () => {
    // sorted: 10.00, 10.20, 10.40, 12.00, DNF → drop 10.00 and the DNF
    expect(meanWindow([10_000, 10_200, 10_400, 12_000, INF], 1, 1)).toBe(
      (10_200 + 10_400 + 12_000) / 3,
    )
  })

  it('two DNFs poison the ao5 — the second one survives trimming', () => {
    expect(meanWindow([10_000, 10_400, INF, INF, 12_000], 1, 1)).toBe(INF)
  })

  it('one DNF poisons an untrimmed mean (WCA 9f10)', () => {
    expect(meanWindow([10_000, 11_000, INF], 0, 0)).toBe(INF)
  })

  it('returns NaN only for an empty window', () => {
    expect(meanWindow([], 1, 1)).toBeNaN()
  })
})

describe('effectiveTimes', () => {
  const solve = (timeMs: number, penalty?: Solve['penalty']): Solve => ({
    id: 1,
    timeMs,
    scramble: '',
    scrambleType: '333',
    createdAtMs: 0,
    penalty,
  })

  it('folds penalties in: +2 added, DNF as ∞, both truncated to cs', () => {
    expect(effectiveTimes([solve(12_345), solve(12_345, 'plus2'), solve(12_345, 'dnf')])).toEqual([
      12_340,
      14_340,
      INF,
    ])
  })
})

describe('currentWindow', () => {
  it('is NaN until the window fills, then the last `size` solves', () => {
    const five = [10_000, 10_200, 10_400, 10_600, 10_800]
    expect(currentWindow(five.slice(0, 4), 'ao5')).toBeNaN()
    expect(currentWindow(five, 'ao5')).toBe((10_200 + 10_400 + 10_600) / 3)
  })

  it('reads the last twelve solves for ao12', () => {
    const times = Array.from({ length: 13 }, (_, i) => 10_000 + i * 100)
    // last 12: 10.10 … 11.30 → sorted 10.10…11.30, drop 10.10 and 11.30
    const kept = Array.from({ length: 10 }, (_, i) => 10_200 + i * 100)
    expect(currentWindow(times, 'ao12')).toBe(kept.reduce((a, b) => a + b, 0) / 10)
  })

  it('is the plain last time for a single', () => {
    expect(currentWindow([9_000, 11_000], 'single')).toBe(11_000)
    expect(currentWindow([], 'single')).toBeNaN()
  })
})

describe('bestWindow', () => {
  it('finds the smallest completed window and where it ends', () => {
    const times = [12_000, 12_000, 12_000, 12_000, 10_000, 10_000, 10_000, 10_000, 10_000]
    // w0 = [12,12,12,12,10] → trim → 12000; each window gains a 10.00 until
    // w3 = [12,10,10,10,10] → (10+10+10)/3 = 10000 (ends at index 7);
    // w4 ties it, and only a strictly smaller value would replace the best.
    expect(bestWindow(times, 'ao5')).toEqual({ value: 10_000, endIndex: 7 })
  })

  it('ignores DNF windows while a finite one exists', () => {
    // w0 has two ∞; one survives trimming → the window is a DNF.
    expect(bestWindow([INF, INF, 10_000, 10_200, 10_400], 'ao5')).toEqual({
      value: INF,
      endIndex: 4,
    })
    const withFinite = [INF, 10_000, 10_200, 10_400, 12_000, 12_200, 12_400]
    // w0 = [∞,10.00,10.20,10.40,12.00] → drop 10.00 and ∞ → (10.20+10.40+12.00)/3
    expect(bestWindow(withFinite, 'ao5')).toEqual({
      value: (10_200 + 10_400 + 12_000) / 3,
      endIndex: 4,
    })
  })

  it('is null while no window has completed', () => {
    expect(bestWindow([10_000, 10_200], 'ao5')).toBeNull()
    expect(bestWindow([], 'single')).toBeNull()
  })

  it('finds the best single, DNFs excluded', () => {
    expect(bestWindow([12_000, 9_800, INF], 'single')).toEqual({ value: 9_800, endIndex: 1 })
    // Ties keep the earliest solve — here both are DNF, so index 0 stands.
    expect(bestWindow([INF, INF], 'single')).toEqual({ value: INF, endIndex: 0 })
  })
})

describe('bestSingle / sessionMean', () => {
  it('the best single ignores DNFs', () => {
    expect(bestSingle([12_000, 9_800, INF])).toBe(9_800)
    expect(bestSingle([INF])).toBeNull()
    expect(bestSingle([])).toBeNull()
  })

  it('the session mean covers non-DNF solves only and reports the DNFs', () => {
    // (10.00 + 12.00) / 2, one DNF counted but not averaged
    expect(sessionMean([10_000, 12_000, INF])).toEqual({
      mean: 11_000,
      dnfCount: 1,
      count: 2,
    })
  })

  it('an all-DNF session has no mean', () => {
    expect(sessionMean([INF, INF])).toEqual({ mean: Number.NaN, dnfCount: 2, count: 0 })
  })

  it('an empty session has no mean either', () => {
    expect(sessionMean([])).toEqual({ mean: Number.NaN, dnfCount: 0, count: 0 })
  })
})

describe('pbTarget — records', () => {
  it('is none before the record can exist', () => {
    expect(pbTarget([], 'ao5')).toEqual({ kind: 'none' })
    expect(pbTarget([10_000], 'single')).toEqual({ kind: 'value', ms: 9_990 })
    expect(pbTarget([10_000, 10_000], 'mo3')).toEqual({ kind: 'none' })
    expect(pbTarget([10_000], 'ao5')).toEqual({ kind: 'none' })
  })

  it('for a single: one tick faster than the best', () => {
    expect(pbTarget([12_340, 9_800], 'single')).toEqual({ kind: 'value', ms: 9_790 })
    expect(pbTarget([0], 'single')).toEqual({ kind: 'never' })
    expect(pbTarget([INF, INF], 'single')).toEqual({ kind: 'always' })
  })

  it('for mo3: the slowest time whose mean still beats the best', () => {
    // (10.00 + 10.00 + x) / 3 < 10.00 → x < 10.00 → 9.99 at the tick
    expect(pbTarget([10_000, 10_000, 10_000], 'mo3')).toEqual({ kind: 'value', ms: 9_990 })
  })

  it('for mo3: a DNF already in the window can never be recovered', () => {
    expect(pbTarget([10_000, 10_000, INF], 'mo3')).toEqual({ kind: 'never' })
  })
})

describe('pbTarget — ao5', () => {
  it('is the slowest next solve that still beats the best average', () => {
    // Best window (the only one): [10.40, 10.00, 10.10, 10.20, 10.30]
    //   sorted → drop 10.00 and 10.40 → (10.10+10.20+10.30)/3 = 10.20
    // Next window keeps [10.00, 10.10, 10.20, 10.30]; the middle three of
    // the combined window sum to < 30.60 s exactly while x ≤ 10.29, so the
    // target is the largest tick below the boundary.
    const times = [10_400, 10_000, 10_100, 10_200, 10_300]
    expect(pbTarget(times, 'ao5')).toEqual({ kind: 'value', ms: 10_290 })
  })

  it('is never when the kept solves alone already floor the average', () => {
    // Four 10.00s in the window: any x leaves three 10.00s in the middle.
    expect(pbTarget([10_000, 10_000, 10_000, 10_000, 10_000], 'ao5')).toEqual({
      kind: 'never',
    })
  })

  it('is always when every completed average is a DNF', () => {
    // w0 has two ∞ → DNF; any finite next solve completes a real average.
    expect(pbTarget([INF, INF, 10_000, 10_000, 10_000], 'ao5')).toEqual({
      kind: 'always',
    })
  })
})

describe('pbTarget — ao12', () => {
  it('holds the same boundary rule at twelve solves', () => {
    // Only one window: [10.40, 10.00, 10.10, 10.20, 10.30] + 7×10.00
    // sorted: 8×10.00, 10.10, 10.20, 10.30, 10.40 → drop 10.00 and 10.40
    // mean of 10 = 100.60/10 = 10.06
    const times = [10_400, 10_000, 10_100, 10_200, 10_300, ...Array(7).fill(10_000)]
    expect(currentWindow(times, 'ao12')).toBe(10_060)
    // With x = 10.29: drop 10.00 and 10.30 → 100.59/10 = 10.059 < 10.06 ✓
    // With x = 10.30: drop 10.00 and 10.30 → 100.60/10 = 10.06 ✗ (tie)
    expect(pbTarget(times, 'ao12')).toEqual({ kind: 'value', ms: 10_290 })
  })
})

describe('pbTarget — cross-checked against brute force', () => {
  // The binary search in pbTarget must land on exactly the boundary a
  // scan over ticks would find. P(x) = "x still beats the best" holds for
  // every tick ≤ target and fails at target + 10 (or holds nowhere/at
  // every tick for never/always).
  const seeds: number[][] = [
    [10_400, 10_000, 10_100, 10_200, 10_300],
    [12_000, 12_000, 12_000, 12_000, 10_000, 10_000, 10_000, 10_000, 10_000],
    [15_000, 9_000, 9_100, 9_200, 9_300, 9_400, 30_000, 10_500],
    [10_000, 10_100, 10_200, 10_300, 10_400, 10_500, 10_600, 10_700, 10_800, 10_900, 11_000, 11_100],
    [20_000, 20_000, 20_000, 8_000, 8_100, 8_200, 8_300],
    [9_990, 10_010, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000],
  ]

  it('every value target satisfies P(target) and not P(target + 10)', () => {
    for (const times of seeds) {
      for (const kind of ['mo3', 'ao5', 'ao12'] as const) {
        const target = pbTarget(times, kind)
        if (target.kind !== 'value') continue
        const best = bestWindow(times, kind)!.value
        const { size, trimL, trimR } = windowSpec(kind)
        const kept = times.slice(times.length - (size - 1))
        const meanWith = (x: number) =>
          meanWindow([...kept, x], trimL, trimR)
        expect(meanWith(target.ms), `${kind} ${times} @ ${target.ms}`).toBeLessThan(best)
        expect(
          meanWith(target.ms + 10),
          `${kind} ${times} @ ${target.ms + 10}`,
        ).toBeGreaterThanOrEqual(best)
        expect(target.ms % 10).toBe(0)
      }
    }
  })
})

describe('sessionStats', () => {
  it('assembles every figure the dialog and the strip need', () => {
    const solves: Solve[] = [10_000, 12_000, 9_000, 11_000, 13_000].map((timeMs, i) => ({
      id: i + 1,
      timeMs,
      scramble: '',
      scrambleType: '333',
      createdAtMs: 0,
      penalty: i === 1 ? ('dnf' as const) : undefined,
    }))

    const stats = sessionStats(solves)

    expect(stats.times).toEqual([10_000, INF, 9_000, 11_000, 13_000])
    expect(stats.bestSingleMs).toBe(9_000)
    // ao5 over all five: drop 9.00 and ∞ → (10.00+11.00+13.00)/3
    expect(stats.current.ao5).toBe((10_000 + 11_000 + 13_000) / 3)
    // mo3 is the last three, which happen to be all finite
    expect(stats.current.mo3).toBe((9_000 + 11_000 + 13_000) / 3)
    expect(stats.mean).toEqual({ mean: (10_000 + 9_000 + 11_000 + 13_000) / 4, dnfCount: 1, count: 4 })
    expect(stats.best.ao5).not.toBeNull()
    expect(stats.target.single).toEqual({ kind: 'value', ms: 8_990 })
  })
})
