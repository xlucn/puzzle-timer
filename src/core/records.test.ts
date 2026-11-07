/*
 * records.test.ts — the PB histories, checked against worked examples.
 *
 * The two rules worth pinning down: only strict improvements count (a tie is
 * not a new PB), and a window record is dated by the solve that *completed*
 * the average, not by its first solve.
 */
import { describe, expect, it } from 'vitest'

import { heldDays, heldSolves, pbHistory } from './records.js'
import type { Solve } from './session.js'

const INF = Number.POSITIVE_INFINITY

const solve = (id: number, timeMs: number, createdAtMs = id * 1_000): Solve => ({
  id,
  timeMs,
  scramble: '',
  scrambleType: '333',
  createdAtMs,
})

describe('pbHistory', () => {
  it('keeps only strict single improvements, with the moment each was set', () => {
    const solves = [
      solve(1, 12_000),
      solve(2, 14_000), // slower: no record
      solve(3, 11_000), // record
      solve(4, 11_000), // tie: no record
      solve(5, 10_000), // record
    ]
    const history = pbHistory(solves, 'single')
    expect(history).toEqual([
      { value: 12_000, setAtMs: 1_000, heldUntilMs: 3_000, solveId: 1, index: 0 },
      { value: 11_000, setAtMs: 3_000, heldUntilMs: 5_000, solveId: 3, index: 2 },
      { value: 10_000, setAtMs: 5_000, heldUntilMs: null, solveId: 5, index: 4 },
    ])
  })

  it('lets an average improve without a new fastest single', () => {
    // The single is set on solve 1 and never beaten; the ao5 improves later
    // as the *other* four solves catch up.
    const times = [9_000, 20_000, 20_000, 20_000, 20_000, 10_000, 10_000, 10_000, 10_000]
    const solves = times.map((timeMs, i) => solve(i + 1, timeMs))

    expect(pbHistory(solves, 'single')).toHaveLength(1)
    const ao5 = pbHistory(solves, 'ao5')
    expect(ao5.length).toBeGreaterThan(1)
    // The first record is the first completed window (index 4)…
    expect(ao5[0].index).toBe(4)
    // …and the last one is the latest completed window, still standing.
    expect(ao5.at(-1)!.index).toBe(8)
    expect(ao5.at(-1)!.heldUntilMs).toBeNull()
    // Each old record's `heldUntil` is the next record's `setAt`.
    for (let i = 0; i < ao5.length - 1; i += 1) {
      expect(ao5[i].heldUntilMs).toBe(ao5[i + 1].setAtMs)
      expect(ao5[i].value).toBeGreaterThan(ao5[i + 1].value)
    }
  })

  it('never lets a DNF be a record, and has no history for an all-DNF run', () => {
    const solves = [solve(1, 12_000, 0), solve(2, 10_000, 0)]
    solves[0].penalty = 'dnf'
    solves[1].penalty = 'dnf'
    expect(pbHistory(solves, 'single')).toEqual([])
    expect(pbHistory(solves, 'ao5')).toEqual([])
  })

  it('skips DNFs in a window history and keeps the finite improvements', () => {
    // ao5 windows: [12,12,12,12,DNF] = 12.00 (DNF trimmed), then
    // [12,12,12,DNF,11] = 12.00 (tie), then [12,12,DNF,11,11] = 11.67,
    // then [12,DNF,11,11,11] = 11.33.
    const solves = [
      solve(1, 12_000),
      solve(2, 12_000),
      solve(3, 12_000),
      solve(4, 12_000),
      { ...solve(5, 12_000), penalty: 'dnf' as const },
      solve(6, 11_000),
      solve(7, 11_000),
      solve(8, 11_000),
    ]
    const history = pbHistory(solves, 'ao5')
    expect(history.map((record) => record.index)).toEqual([4, 6, 7])
    expect(history[0].value).toBe(12_000)
    expect(history[1].value).toBeCloseTo(35_000 / 3, 5)
    expect(history[2].value).toBeCloseTo(34_000 / 3, 5)
  })

  it('keeps zero dates as unknown rather than inventing 1970', () => {
    const solves = [solve(1, 12_000, 0), solve(2, 11_000, 0)]
    const history = pbHistory(solves, 'single')
    expect(history[0].setAtMs).toBe(0)
    expect(history[0].heldUntilMs).toBe(0)
    expect(history[1].setAtMs).toBe(0)
    expect(heldDays(history[0])).toBeNull()
  })
})

describe('held figures', () => {
  it('counts the solves between a record and the one that broke it', () => {
    const solves = [solve(1, 12_000), solve(2, 11_000), solve(3, 10_000)]
    const history = pbHistory(solves, 'single')
    expect(heldSolves(history[0], 3, history[1])).toBe(1)
    expect(heldSolves(history[1], 3, history[2])).toBe(1)
    expect(heldSolves(history[2], 3, undefined)).toBe(0)
  })

  it('measures whole calendar days when both dates are known', () => {
    const start = new Date(2026, 2, 14, 18, 0).getTime()
    const end = new Date(2026, 2, 16, 9, 0).getTime()
    const record = {
      value: 10_000,
      setAtMs: start,
      heldUntilMs: end,
      solveId: 1,
      index: 0,
    }
    expect(heldDays(record)).toBe(2)
    // Same day: 0, which the UI words as "same day".
    expect(heldDays({ ...record, heldUntilMs: new Date(2026, 2, 14, 23, 0).getTime() })).toBe(0)
    // Still standing / unknown: no day figure.
    expect(heldDays({ ...record, heldUntilMs: null })).toBeNull()
  })
})
