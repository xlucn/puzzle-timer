/*
 * activity.test.ts — local-day buckets and streaks.
 *
 * The dates are built with `new Date(y, m, d, h, …)`, i.e. local time on
 * purpose: the module promises local days, so a test written in UTC would
 * only pass west of Greenwich.
 */
import { describe, expect, it } from 'vitest'

import { activity, dayKey, dayStart, heatmap, shiftDays } from './activity.js'
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
    const map = heatmap(stats, NOW, 1)
    expect(map.weeks[0].map((cell) => [cell.key, cell.count])).toEqual([
      ['2026-11-02', 0],
      ['2026-11-03', 0],
      ['2026-11-04', 0],
      ['2026-11-05', 0],
      ['2026-11-06', 1],
      ['2026-11-07', 0],
      ['2026-11-08', 0],
    ])
  })
})

describe('heatmap', () => {
  it('aligns the last weeks to Monday and ends with the current week', () => {
    const map = heatmap(activity([], NOW), NOW, 3)
    expect(map.weeks).toHaveLength(3)
    expect(map.weeks.every((week) => week.length === 7)).toBe(true)
    // 8 November 2026 is a Sunday: the current week starts on 2 November.
    expect(map.startMs).toBe(local(2026, 9, 19, 0))
    expect(map.weeks[0][0].key).toBe('2026-10-19')
    expect(map.weeks[2][6].key).toBe('2026-11-08')
    expect(map.weeks[2][6].inRange).toBe(true)
    expect(map.weeks[2].every((cell) => cell.inRange)).toBe(true)
  })

  it('leaves the days after today out of range', () => {
    const wednesday = local(2026, 10, 4, 12)
    const map = heatmap(activity([], wednesday), wednesday, 2)
    const week = map.weeks[1]
    expect(week[2].key).toBe('2026-11-04')
    expect(week[2].inRange).toBe(true)
    expect(week[3].inRange).toBe(false)
    expect(week[6].inRange).toBe(false)
    expect(week.slice(3).every((cell) => cell.level === 0)).toBe(true)
  })

  it('scales levels against the busiest day inside the map only', () => {
    let nextId = 1
    const day = (count: number, m: number, d: number) =>
      Array.from({ length: count }, (_, i) => solve(nextId++, local(2026, m, d)))
    const stats = activity(
      [
        ...day(1, 10, 3),
        ...day(2, 10, 4),
        ...day(4, 10, 5),
        ...day(100, 8, 1), // outside the two-week map
      ],
      NOW,
    )
    const map = heatmap(stats, NOW, 2)
    const cell = (key: string) =>
      map.weeks.flat().find((entry) => entry.key === key)!
    expect(map.maxCount).toBe(4)
    expect(cell('2026-11-03').level).toBe(1)
    expect(cell('2026-11-04').level).toBe(2)
    expect(cell('2026-11-05').level).toBe(4)
    expect(cell('2026-11-06').level).toBe(0)
  })

  it('is empty when there are no dated solves', () => {
    const map = heatmap(activity([solve(1, 0)], NOW), NOW, 2)
    expect(map.maxCount).toBe(0)
    expect(map.weeks.flat().every((cell) => cell.level === 0)).toBe(true)
  })
})
