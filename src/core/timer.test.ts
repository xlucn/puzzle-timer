import { describe, expect, it, vi } from 'vitest'

import { Timer } from './timer.js'
import {
  effectiveMs,
  formatAverage,
  formatSolve,
  formatTime,
  formatTimestamp,
} from './time.js'

/** Test clock — milliseconds, advanced by hand. */
const T0 = 1_000

describe('formatTime', () => {
  it('formats centiseconds by default', () => {
    expect(formatTime(0)).toBe('0.00')
    expect(formatTime(999.9)).toBe('0.99')
    expect(formatTime(5_000)).toBe('5.00')
    expect(formatTime(12_345)).toBe('12.34')
    expect(formatTime(59_999)).toBe('59.99')
  })

  it('adds minutes above one minute', () => {
    expect(formatTime(60_000)).toBe('1:00.00')
    expect(formatTime(62_345)).toBe('1:02.34')
    expect(formatTime(600_000)).toBe('10:00.00')
    expect(formatTime(3_661_000)).toBe('61:01.00')
  })

  it('truncates instead of rounding — never displays a faster time', () => {
    expect(formatTime(12_399)).toBe('12.39')
    expect(formatTime(12_399.999)).toBe('12.39')
  })

  it('supports millisecond display', () => {
    expect(formatTime(12_345, { useMs: true })).toBe('12.345')
    expect(formatTime(62_345, { useMs: true })).toBe('1:02.345')
    expect(formatTime(0, { useMs: true })).toBe('0.000')
  })

  it('clamps nonsense input', () => {
    expect(formatTime(-5)).toBe('0.00')
    expect(formatTime(Number.NaN)).toBe('0.00')
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe('0.00')
  })
})

describe('effectiveMs / formatSolve — penalties', () => {
  it('truncates an OK time to centiseconds', () => {
    expect(effectiveMs(12_345)).toBe(12_340)
    expect(effectiveMs(12_349)).toBe(12_340)
  })

  it('adds the +2 and keeps the result on a centisecond boundary', () => {
    expect(effectiveMs(12_345, 'plus2')).toBe(14_340)
    expect(effectiveMs(12_349, 'plus2')).toBe(14_340)
  })

  it('scores a DNF as ∞', () => {
    expect(effectiveMs(12_345, 'dnf')).toBe(Number.POSITIVE_INFINITY)
  })

  it('writes a solve the way the list shows it', () => {
    expect(formatSolve(12_345)).toBe('12.34')
    expect(formatSolve(12_345, 'plus2')).toBe('14.34+') // csTimer's trailing '+'
    expect(formatSolve(12_345, 'dnf')).toBe('DNF')
    expect(formatSolve(62_345, 'plus2')).toBe('1:04.34+')
  })
})

describe('formatAverage', () => {
  it('rounds to the nearest hundredth (WCA 9f1) — unlike single times', () => {
    expect(formatAverage(10_866)).toBe('10.87')
    expect(formatAverage(10_833)).toBe('10.83')
    expect(formatAverage(10_850)).toBe('10.85')
  })

  it('shows a non-centisecond mean without losing precision', () => {
    // A mean of three: (10.00 + 10.00 + 10.01) / 3 = 10.0033… → 10.00
    expect(formatAverage(10_003.33)).toBe('10.00')
  })

  it('writes ∞ (a DNF that survived trimming) as DNF', () => {
    expect(formatAverage(Number.POSITIVE_INFINITY)).toBe('DNF')
    expect(formatAverage(Number.NaN)).toBe('DNF')
  })
})

describe('formatTimestamp', () => {
  // Built in local time on purpose: the expected string is then independent
  // of the machine's time zone, which is what makes these assertions honest.
  const local = (y: number, m: number, d: number, h = 0, min = 0) =>
    new Date(y, m - 1, d, h, min).getTime()

  const today = local(2026, 10, 1, 12, 0)

  it('shows only the clock time for today', () => {
    expect(formatTimestamp(local(2026, 10, 1, 14, 32), today)).toBe('14:32')
    expect(formatTimestamp(local(2026, 10, 1, 0, 5), today)).toBe('00:05')
    expect(formatTimestamp(today, today)).toBe('12:00')
  })

  it('adds the date for an earlier day of the same year', () => {
    expect(formatTimestamp(local(2026, 9, 30, 14, 32), today)).toBe('09-30 14:32')
    expect(formatTimestamp(local(2026, 1, 2, 6, 7), today)).toBe('01-02 06:07')
  })

  it('adds the year when the solve is from an older year', () => {
    expect(formatTimestamp(local(2025, 12, 31, 23, 59), today)).toBe('2025-12-31 23:59')
  })

  it('clamps nonsense input to an empty stamp', () => {
    expect(formatTimestamp(Number.NaN)).toBe('')
    expect(formatTimestamp(Number.POSITIVE_INFINITY)).toBe('')
  })
})

describe('Timer — lifecycle of one solve', () => {
  it('starts idle with no result', () => {
    const timer = new Timer()
    expect(timer.state).toBe('idle')
    expect(timer.lastResultMs).toBeNull()
    expect(timer.snapshot(T0)).toEqual({ state: 'idle', elapsedMs: 0, holdProgress: 0 })
  })

  it('runs a full hold → ready → release → stop cycle', () => {
    const timer = new Timer({ holdThresholdMs: 300 })
    const solved = vi.fn()
    timer.onSolved(solved)

    timer.keyDown('space', T0)
    expect(timer.state).toBe('holding')
    expect(timer.snapshot(T0).elapsedMs).toBe(0)

    timer.update(T0 + 150)
    expect(timer.state).toBe('holding')
    expect(timer.snapshot(T0 + 150).holdProgress).toBeCloseTo(0.5)

    timer.update(T0 + 300)
    expect(timer.state).toBe('ready')
    expect(timer.snapshot(T0 + 300).holdProgress).toBe(1)

    timer.keyUp('space', T0 + 320)
    expect(timer.state).toBe('running')

    timer.update(T0 + 1_320)
    expect(timer.snapshot(T0 + 1_320).elapsedMs).toBe(1_000)

    timer.keyDown('x', T0 + 2_320)
    expect(timer.state).toBe('stopped')
    expect(timer.lastResultMs).toBe(2_000)
    expect(solved).toHaveBeenCalledTimes(1)
    expect(solved).toHaveBeenCalledWith(2_000)
    expect(timer.snapshot(T0 + 2_320).elapsedMs).toBe(2_000)
  })

  it('cancels when the start key is released before the threshold', () => {
    const timer = new Timer({ holdThresholdMs: 300 })
    const solved = vi.fn()
    timer.onSolved(solved)

    timer.keyDown('space', T0)
    timer.keyUp('space', T0 + 100)

    expect(timer.state).toBe('idle')
    expect(timer.snapshot(T0 + 100).elapsedMs).toBe(0)
    expect(solved).not.toHaveBeenCalled()
  })

  it('still starts when released just after the threshold, without a tick', () => {
    // The UI may not have ticked between press and release.
    const timer = new Timer({ holdThresholdMs: 300 })
    timer.keyDown('space', T0)
    timer.keyUp('space', T0 + 450)
    expect(timer.state).toBe('running')
    expect(timer.snapshot(T0 + 450).elapsedMs).toBe(0)
  })

  it('moves holding → ready on update once the threshold passes', () => {
    const timer = new Timer({ holdThresholdMs: 300 })
    timer.keyDown('space', T0)
    timer.update(T0 + 299)
    expect(timer.state).toBe('holding')
    timer.update(T0 + 301)
    expect(timer.state).toBe('ready')
  })
})

describe('Timer — keyboard auto-repeat', () => {
  it('ignores repeated presses of a key that is still held', () => {
    const timer = new Timer({ holdThresholdMs: 300 })
    timer.keyDown('space', T0)
    timer.keyDown('space', T0 + 50) // auto-repeat while held
    timer.keyDown('space', T0 + 100) // auto-repeat again
    expect(timer.snapshot(T0 + 100).holdProgress).toBeCloseTo(100 / 300)

    // The hold must not have restarted from the repeat.
    timer.update(T0 + 300)
    expect(timer.state).toBe('ready')
  })

  it('does not stop a running solve twice on a repeated press', () => {
    const timer = new Timer({ holdThresholdMs: 300 })
    const solved = vi.fn()
    timer.onSolved(solved)

    timer.keyDown('space', T0)
    timer.update(T0 + 300)
    timer.keyUp('space', T0 + 320) // running
    expect(timer.state).toBe('running')

    timer.keyDown('x', T0 + 1_320) // stops
    timer.keyDown('x', T0 + 1_350) // auto-repeat of the stopping key
    timer.keyDown('x', T0 + 1_380) // and again
    expect(timer.state).toBe('stopped')
    expect(solved).toHaveBeenCalledTimes(1)
    expect(timer.lastResultMs).toBe(1_000)
  })

  it('accepts a fresh press of the same key after its release', () => {
    const timer = new Timer({ holdThresholdMs: 300 })
    timer.keyDown('space', T0)
    timer.keyUp('space', T0 + 350) // running
    timer.keyDown('space', T0 + 900) // stops
    expect(timer.state).toBe('stopped')

    timer.keyUp('space', T0 + 950)
    timer.keyDown('space', T0 + 1_000) // next solve arms again
    expect(timer.state).toBe('holding')
  })
})

describe('Timer — which keys matter', () => {
  it('only the start key arms the timer', () => {
    const timer = new Timer({ holdThresholdMs: 300 })
    timer.keyDown('a', T0)
    expect(timer.state).toBe('idle')
    timer.keyDown('Control_L', T0)
    expect(timer.state).toBe('idle')
  })

  it('any fresh key press stops a running solve', () => {
    const timer = new Timer({ holdThresholdMs: 300 })
    timer.keyDown('space', T0)
    timer.update(T0 + 300)
    timer.keyUp('space', T0 + 320)

    timer.keyDown('Escape', T0 + 520)
    expect(timer.state).toBe('stopped')
    expect(timer.lastResultMs).toBe(200)
  })

  it('ignores keys pressed while arming', () => {
    const timer = new Timer({ holdThresholdMs: 300 })
    timer.keyDown('space', T0)
    timer.keyDown('a', T0 + 50)
    expect(timer.state).toBe('holding')
    timer.keyUp('a', T0 + 60) // not the start key: no effect
    expect(timer.state).toBe('holding')
    timer.update(T0 + 300)
    expect(timer.state).toBe('ready')
  })

  it('ignores a release that was never preceded by a press', () => {
    const timer = new Timer({ holdThresholdMs: 300 })
    timer.keyUp('space', T0 + 10)
    expect(timer.state).toBe('idle')
  })
})

describe('Timer — repeated solves', () => {
  it('keeps the previous result visible while arming the next solve', () => {
    const timer = new Timer({ holdThresholdMs: 300 })
    timer.keyDown('space', T0)
    timer.update(T0 + 300)
    timer.keyUp('space', T0 + 320)
    timer.keyDown('x', T0 + 2_320) // solved 2000ms
    expect(timer.lastResultMs).toBe(2_000)

    timer.keyUp('x', T0 + 2_400)
    timer.keyDown('space', T0 + 2_500)
    expect(timer.state).toBe('holding')
    expect(timer.snapshot(T0 + 2_500).elapsedMs).toBe(2_000)
  })

  it('reports each solve exactly once', () => {
    const timer = new Timer({ holdThresholdMs: 300 })
    const solved = vi.fn()
    timer.onSolved(solved)

    timer.keyDown('space', 0)
    timer.update(300)
    timer.keyUp('space', 320)
    timer.keyDown('x', 1_320)
    expect(solved).toHaveBeenCalledTimes(1)

    timer.keyUp('space', 1_400)
    timer.keyDown('space', 1_500)
    timer.update(1_800)
    timer.keyUp('space', 1_820)
    timer.keyDown('y', 2_820)
    expect(solved).toHaveBeenCalledTimes(2)
    expect(solved).toHaveBeenNthCalledWith(2, 1_000)
  })
})

describe('Timer — subscriptions', () => {
  it('emits on transitions but not on idle updates', () => {
    const timer = new Timer({ holdThresholdMs: 300 })
    const listener = vi.fn()
    timer.subscribe(listener)

    timer.update(T0) // idle: nothing changed
    expect(listener).not.toHaveBeenCalled()

    timer.keyDown('space', T0)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0]).toEqual({
      state: 'holding',
      elapsedMs: 0,
      holdProgress: 0,
    })

    timer.update(T0 + 100) // progress changed
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('unsubscribes cleanly', () => {
    const timer = new Timer()
    const listener = vi.fn()
    const unsubscribe = timer.subscribe(listener)
    timer.keyDown('space', T0)
    expect(listener).toHaveBeenCalled()

    const calls = listener.mock.calls.length
    unsubscribe()
    timer.keyDown('a', T0 + 10)
    expect(listener.mock.calls.length).toBe(calls)
  })

  it('reset clears the last result and any held keys', () => {
    const timer = new Timer({ holdThresholdMs: 300 })
    timer.keyDown('space', T0)
    timer.update(T0 + 300)
    timer.keyUp('space', T0 + 320)
    timer.keyDown('x', T0 + 1_320)
    expect(timer.lastResultMs).toBe(1_000)

    timer.reset(T0 + 2_000)
    expect(timer.state).toBe('idle')
    expect(timer.lastResultMs).toBeNull()
    expect(timer.snapshot(T0 + 2_000).elapsedMs).toBe(0)

    // A stale release must not start the timer after a reset.
    timer.keyUp('space', T0 + 2_100)
    expect(timer.state).toBe('idle')
  })
})
