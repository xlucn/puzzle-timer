import { describe, expect, it } from 'vitest'

import { histogram, trend } from './charts.js'

const INF = Number.POSITIVE_INFINITY

describe('histogram', () => {
  it('bins finite times on csTimer’s step ladder', () => {
    // best 1000, worst 3900 → range 2900 → 290 ms target → 500 ms step.
    const chart = histogram([1000, 1100, 3900])
    expect(chart).not.toBeNull()
    expect(chart!.stepMs).toBe(500)
    expect(chart!.bins).toHaveLength(6)
    expect(chart!.bins.map((bin) => [bin.startMs, bin.count, bin.cumulative])).toEqual([
      [1000, 2, 2],
      [1500, 0, 2],
      [2000, 0, 2],
      [2500, 0, 2],
      [3000, 0, 2],
      [3500, 1, 3],
    ])
    expect(chart!.total).toBe(3)
    expect(chart!.dnfCount).toBe(0)
  })

  it('keeps DNFs out of the bins and counts them separately', () => {
    const chart = histogram([1000, INF, INF])
    expect(chart!.bins).toEqual([{ startMs: 1000, endMs: 1100, count: 1, cumulative: 1 }])
    expect(chart!.total).toBe(1)
    expect(chart!.dnfCount).toBe(2)
  })

  it('returns null when every solve is a DNF', () => {
    expect(histogram([INF, INF])).toBeNull()
    expect(histogram([])).toBeNull()
  })

  it('falls back to the 100 ms floor for a single time', () => {
    const chart = histogram([12_340])
    expect(chart!.stepMs).toBe(100)
    expect(chart!.bins).toHaveLength(1)
    expect(chart!.bins[0].count).toBe(1)
  })

  it('caps a very wide range at the 100 s step', () => {
    const chart = histogram([0, 5_000_000])
    expect(chart!.stepMs).toBe(100_000)
    expect(chart!.bins).toHaveLength(51)
  })
})

describe('trend', () => {
  it('normalizes singles and places ao5 at the window end', () => {
    const chart = trend([1000, 1500, 2000, 2500, 3000, 3500])
    expect(chart).not.toBeNull()
    expect(chart!.stepMs).toBe(500)
    expect(chart!.plotMinMs).toBe(1000)
    expect(chart!.plotMaxMs).toBe(3500)
    expect(chart!.ticks.map((tick) => tick.valueMs)).toEqual([
      1000, 1500, 2000, 2500, 3000, 3500,
    ])
    expect(chart!.series[0].kind).toBe('single')
    expect(chart!.series[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 0.2, y: 0.2 },
      { x: 0.4, y: 0.4 },
      { x: 0.6, y: 0.6 },
      { x: 0.8, y: 0.8 },
      { x: 1, y: 1 },
    ])
    expect(chart!.series[1].kind).toBe('ao5')
    expect(chart!.series[1].points).toEqual([
      { x: 0.8, y: 0.4 },
      { x: 1, y: 0.6 },
    ])
    expect(chart!.series[2].points).toEqual([])
  })

  it('leaves DNFs as gaps in the single line', () => {
    const chart = trend([1000, INF, 3000])
    expect(chart!.series[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ])
    expect(chart!.dnfCount).toBe(1)
  })

  it('plots one solve in the middle of the x axis at its own value', () => {
    const chart = trend([12_340])
    expect(chart!.series[0].points).toEqual([{ x: 0.5, y: 0.4 }])
    expect(chart!.plotMinMs).toBe(12_300)
    expect(chart!.plotMaxMs).toBe(12_400)
  })

  it('returns null when every solve is a DNF', () => {
    expect(trend([INF])).toBeNull()
  })
})
