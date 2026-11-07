/*
 * activity.test.ts — local-day buckets and streaks.
 *
 * The dates are built with `new Date(y, m, d, h, …)`, i.e. local time on
 * purpose: the module promises local days, so a test written in UTC would
 * only pass west of Greenwich.
 */
import { describe, expect, it } from 'vitest'

import { activity, dayKey, dayStart, recentDays, shiftDays } from './activity.js'
import type { Solve } from './session.js'

const local = (y: number, m: number, d: number, h = 12): number =>
  new Date(y, m, d, h, 0, 0, 0).getTime()

const solve = (id: number, createdAtMs: number, timeMs = 10_000): Solve => ({
  id,
  timeMs,
  scramble: '',
  scrambleType: '333',
  createdAtMs,
})

/** 8 November 2026, a Sunday, at noon local time. */
const NOW = local(2026, 10, 8)

describe('day helpers', () => {
  it('snaps to local midnight and keys the local date', () => {
    expect(dayStart(local(2026, 10, 8, 23))).toBe(local(2026, 10, 8, 0))
    expect(dayKey(local(2026, 10, 8, 23))).toBe('2026-11-08')
  })

  it('steps calendar days without assuming a 24-hour day', () => {
    expect(shiftDays(local(2026, 10, 8, 0), 1)).toBe(local(2026, 10, 9, 0))
    expect(shiftDays(local(2026, 10, 8, 0), -8)).toBe(local(2026, 9, 31, 0))
  })
})

describe('activity', () => {
  it('buckets by local day and keeps undated solves out of the days', () => {
    const stats = activity(
      [
        solve(1, local(2026, 10, 6, 23)),
        solve(2, local(2026, 10, 7, 0)),
        solve(3, local(2026, 10, 7, 18)),
        solve(4, 0),
        solve(5, Number.NaN),
      ],
      NOW,
    )
    expect(stats.days.map((day) => [day.key, day.count])).toEqual([
      ['2026-11-06', 1],
      ['2026-11-07', 2],
    ])
    expect(stats.undated).toBe(2)
    expect(stats.totalSolves).toBe(5)
    expect(stats.activeDays).toBe(2)
    expect(stats.perActiveDay).toBe(1.5)
  })

  it('counts today, the rolling windows, and the best day', () => {
    const solves = [
      solve(1, local(2026, 9, 10)), // 30 days ago: outside both windows
      solve(2, local(2026, 10, 1)),
      solve(3, local(2026, 10, 2)),
      solve(4, local(2026, 10, 2)),
      solve(5, local(2026, 10, 2)),
      solve(6, local(2026, 10, 7)),
      solve(7, local(2026, 10, 8)),
    ]
    const stats = activity(solves, NOW)
    expect(stats.today).toEqual({
      key: '2026-11-08',
      startMs: local(2026, 10, 8, 0),
      count: 1,
      totalMs: 10_000,
    })
    expect(stats.last7).toEqual({ solves: 5, activeDays: 3 })
    expect(stats.last30).toEqual({ solves: 7, activeDays: 5 })
    expect(stats.bestDay?.key).toBe('2026-11-02')
    expect(stats.bestDay?.count).toBe(3)
  })

  it('keeps a streak current through yesterday, then breaks it', () => {
    const throughToday = activity(
      [
        solve(1, local(2026, 10, 6)),
        solve(2, local(2026, 10, 7)),
        solve(3, local(2026, 10, 8)),
      ],
      NOW,
    )
    expect(throughToday.currentStreak).toBe(3)

    const throughYesterday = activity(
      [solve(1, local(2026, 10, 6)), solve(2, local(2026, 10, 7))],
      NOW,
    )
    expect(throughYesterday.currentStreak).toBe(2)

    const stale = activity(
      [solve(1, local(2026, 10, 5)), solve(2, local(2026, 10, 6))],
      NOW,
    )
    expect(stale.currentStreak).toBe(0)
  })

  it('finds the longest streak across a gap, and ties the best day to the oldest', () => {
    const day = (d: number, count = 1) =>
      Array.from({ length: count }, (_, i) => solve(d * 100 + i, local(2026, 9, d)))
    const stats = activity(
      [...day(1), ...day(2), ...day(3, 4), ...day(10), ...day(11)],
      NOW,
    )
    expect(stats.longestStreak).toBe(3)
    expect(stats.currentStreak).toBe(0)
    expect(stats.bestDay?.key).toBe('2026-10-03')
    expect(stats.bestDay?.count).toBe(4)
  })

  it('is all zeroes for an empty session', () => {
    const stats = activity([], NOW)
    expect(stats.days).toEqual([])
    expect(stats.today.count).toBe(0)
    expect(stats.last7).toEqual({ solves: 0, activeDays: 0 })
    expect(stats.activeDays).toBe(0)
    expect(stats.perActiveDay).toBe(0)
    expect(stats.currentStreak).toBe(0)
    expect(stats.longestStreak).toBe(0)
    expect(stats.bestDay).toBeNull()
  })

  it('fills recent calendar days with zero rows', () => {
    const stats = activity([solve(1, local(2026, 10, 6))], NOW)
    const days = recentDays(stats, NOW, 4)
    expect(days.map((day) => [day.key, day.count])).toEqual([
      ['2026-11-05', 0],
      ['2026-11-06', 1],
      ['2026-11-07', 0],
      ['2026-11-08', 0],
    ])
  })
})
