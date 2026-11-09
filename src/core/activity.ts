/*
 * activity.ts — solves grouped by local calendar day.
 *
 * Architecture rule (see AGENTS.md): pure TypeScript, no `gi:*`, no Node APIs.
 * Day boundaries come from `Date`'s local-time getters, so a solve at 23:59
 * and one at 00:01 fall into different days in the user's own time zone —
 * which is what "I practised yesterday" means — without any time-zone
 * database or a UTC convention the UI would have to explain.
 *
 * Imported solves can have no date (`createdAtMs` 0); they are counted in
 * `undated` and kept out of the buckets rather than landing on 1 January
 * 1970, which would invent a 56-year streak.
 *
 * A streak is calendar days, not 24-hour spans: DST days are 23 or 25 hours
 * long, so consecutive-day tests step with `new Date(y, m, d + 1)`, never
 * with a constant.
 */

import type { Solve } from './session.js'

export interface DayBucket {
  /** `YYYY-MM-DD` in local time; also the sort key. */
  key: string
  /** Local midnight of the day, epoch ms. */
  startMs: number
  count: number
  /** Sum of the measured times, DNF solves included. */
  totalMs: number
}

export interface Activity {
  /** Every day with at least one dated solve, oldest first. */
  days: DayBucket[]
  /** Today's bucket, zero-filled when nothing was recorded today. */
  today: DayBucket
  last7: { solves: number; activeDays: number }
  last30: { solves: number; activeDays: number }
  /** Dated solves only; this is `days.length`. */
  activeDays: number
  /** Dated solves ÷ active days; 0 when there are none. */
  perActiveDay: number
  /** Consecutive active days ending today or yesterday; 0 otherwise. */
  currentStreak: number
  longestStreak: number
  /** The day with the most solves (the oldest one on a tie), or null. */
  bestDay: DayBucket | null
  /** Solves with no usable date; they are in no bucket. */
  undated: number
  totalSolves: number
}

const pad2 = (value: number): string => String(value).padStart(2, '0')

/** Local midnight of the day `epochMs` falls in. */
export function dayStart(epochMs: number): number {
  const date = new Date(epochMs)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** `YYYY-MM-DD` for the local day of `epochMs`. */
export function dayKey(epochMs: number): string {
  const date = new Date(epochMs)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** Local midnight `delta` days from `startMs` (DST-safe). */
export function shiftDays(startMs: number, delta: number): number {
  const date = new Date(startMs)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta).getTime()
}

function emptyDay(startMs: number): DayBucket {
  return { key: dayKey(startMs), startMs, count: 0, totalMs: 0 }
}

/** The window `[today - (days - 1), today]`, solved counts and active days. */
function rolling(days: readonly DayBucket[], todayStart: number, span: number) {
  const from = shiftDays(todayStart, -(span - 1))
  let solves = 0
  let activeDays = 0
  for (const day of days) {
    if (day.startMs < from) continue
    solves += day.count
    activeDays += 1
  }
  return { solves, activeDays }
}

/**
 * Bucket `solves` into local days and derive the figures the Summary tab
 * shows. `now` is injectable so "today", the streaks and the rolling windows
 * are testable without depending on the machine's clock.
 */
export function activity(solves: readonly Solve[], now: number = Date.now()): Activity {
  const buckets = new Map<number, DayBucket>()
  let undated = 0

  for (const solve of solves) {
    if (!Number.isFinite(solve.createdAtMs) || solve.createdAtMs <= 0) {
      undated += 1
      continue
    }
    const startMs = dayStart(solve.createdAtMs)
    let bucket = buckets.get(startMs)
    if (bucket === undefined) {
      bucket = emptyDay(startMs)
      buckets.set(startMs, bucket)
    }
    bucket.count += 1
    if (Number.isFinite(solve.timeMs)) bucket.totalMs += solve.timeMs
  }

  const days = [...buckets.values()].sort((a, b) => a.startMs - b.startMs)
  const todayStart = dayStart(now)
  const today = buckets.get(todayStart) ?? emptyDay(todayStart)

  let longestStreak = 0
  let run = 0
  let bestDay: DayBucket | null = null
  for (let i = 0; i < days.length; i += 1) {
    const day = days[i]
    if (i > 0 && shiftDays(days[i - 1].startMs, 1) === day.startMs) run += 1
    else run = 1
    if (run > longestStreak) longestStreak = run
    // Strict `>` keeps the oldest day on a tie: the first time the record
    // was reached is the more interesting one.
    if (bestDay === null || day.count > bestDay.count) bestDay = day
  }

  // A streak is still "current" when yesterday was active and today has not
  // been recorded yet; it breaks only once a whole day has passed.
  let cursor = buckets.has(todayStart) ? todayStart : shiftDays(todayStart, -1)
  let currentStreak = 0
  while (buckets.has(cursor)) {
    currentStreak += 1
    cursor = shiftDays(cursor, -1)
  }

  const datedSolves = days.reduce((sum, day) => sum + day.count, 0)
  return {
    days,
    today,
    last7: rolling(days, todayStart, 7),
    last30: rolling(days, todayStart, 30),
    activeDays: days.length,
    perActiveDay: days.length > 0 ? datedSolves / days.length : 0,
    currentStreak,
    longestStreak,
    bestDay,
    undated,
    totalSolves: solves.length,
  }
}

export interface HeatmapCell {
  /** Local midnight of the day. */
  startMs: number
  key: string
  count: number
  /** 0 (empty) to 4 (the busiest day in this map). */
  level: number
  /** False for days after today in the current week. */
  inRange: boolean
}

export interface Heatmap {
  /** Oldest week first; each week is Monday..Sunday. */
  weeks: HeatmapCell[][]
  /** The largest daily count inside the map; 0 when there is no data. */
  maxCount: number
  /** Local midnight of the first cell, always a Monday. */
  startMs: number
}

/**
 * A calendar heatmap for the last `weeks` weeks, aligned to Monday and ending
 * with the current week. Days after today are `inRange: false` so the UI can
 * leave them blank instead of drawing a misleading zero. `now` must be the
 * same instant passed to `activity()`.
 *
 * The levels are scaled against the busiest day **inside** the map, so an
 * ancient 500-solve day cannot flatten the recent colours.
 */
export function heatmap(stats: Activity, now: number, weeks: number): Heatmap {
  const columns = Math.max(1, Math.floor(weeks))
  const counts = new Map(stats.days.map((day) => [day.startMs, day.count]))

  const todayStart = dayStart(now)
  // Date#getDay is Sunday-first; the grid is Monday-first.
  const weekday = (new Date(todayStart).getDay() + 6) % 7
  const firstMonday = shiftDays(todayStart, -(columns - 1) * 7 - weekday)

  let maxCount = 0
  for (let column = 0; column < columns; column += 1) {
    for (let day = 0; day < 7; day += 1) {
      const startMs = shiftDays(firstMonday, column * 7 + day)
      if (startMs > todayStart) continue
      maxCount = Math.max(maxCount, counts.get(startMs) ?? 0)
    }
  }

  const result: HeatmapCell[][] = []
  for (let column = 0; column < columns; column += 1) {
    const week: HeatmapCell[] = []
    for (let day = 0; day < 7; day += 1) {
      const startMs = shiftDays(firstMonday, column * 7 + day)
      const inRange = startMs <= todayStart
      const count = counts.get(startMs) ?? 0
      const level =
        !inRange || count === 0 || maxCount === 0
          ? 0
          : Math.min(4, Math.max(1, Math.ceil((count / maxCount) * 4)))
      week.push({ startMs, key: dayKey(startMs), count, level, inRange })
    }
    result.push(week)
  }
  return { weeks: result, maxCount, startMs: firstMonday }
}
