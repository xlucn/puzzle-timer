import { describe, expect, it } from 'vitest'

import { BREAKPOINTS, layoutFor } from './layout.js'

const { smallMax, selectorRowMax, drawerMax, mediumMin, largeMin, shortMax } = BREAKPOINTS

describe('layoutFor — width tiers', () => {
  it('makes the sidebar a drawer only while the content header would otherwise starve', () => {
    expect(layoutFor(drawerMax, 540).drawer).toBe(true)
    expect(layoutFor(drawerMax + 1, 540).drawer).toBe(false)
    expect(layoutFor(900, 540).drawer).toBe(false) // the default window
  })

  it('keeps the selectors in the header until the window is genuinely small', () => {
    expect(layoutFor(selectorRowMax, 540).selectorRow).toBe(true)
    expect(layoutFor(selectorRowMax + 1, 540).selectorRow).toBe(false)
    // …and every window small enough for the second row is also a drawer, so
    // the two never fight over the same line.
    expect(layoutFor(smallMax, 540).selectorRow).toBe(true)
    expect(layoutFor(smallMax, 540).drawer).toBe(true)
  })

  it('steps the timer down only where its digits could clip', () => {
    expect(layoutFor(smallMax, 540).timerSize).toBe('s')
    expect(layoutFor(smallMax + 1, 540).timerSize).toBe('m')
    expect(layoutFor(900, 540).timerSize).toBe('m')
  })

  it('pins the sidebar at 320 at every width (user call, 2026-10-09)', () => {
    expect(layoutFor(smallMax, 540).sidebarMax).toBe(320)
    expect(layoutFor(1199, 800).sidebarMax).toBe(320)
    expect(layoutFor(mediumMin, 800).sidebarMax).toBe(320)
    expect(layoutFor(largeMin - 1, 800).sidebarMax).toBe(320)
    expect(layoutFor(largeMin, 800).sidebarMax).toBe(320)
    expect(layoutFor(3000, 1600).sidebarMax).toBe(320)
  })

  it('gives the timer and the scramble more room on a large window', () => {
    expect(layoutFor(largeMin, 900).timerSize).toBe('l')
    expect(layoutFor(largeMin, 900).scrambleChars).toBeGreaterThan(60)
    expect(layoutFor(largeMin, 900).scrambleMaxHeight).toBe(220)
    expect(layoutFor(900, 900).scrambleChars).toBe(60)
  })

  it('never grows the diagram or the scramble slot into a short window', () => {
    const strip = layoutFor(largeMin, 500)
    expect(strip.drawer).toBe(false)
    expect(strip.diagramMaxHeight).toBe(150) // roomy is false
    expect(strip.scrambleMaxHeight).toBe(100) // height ≤ shortMax
    expect(strip.timerSize).toBe('l') // 500 is still taller than the small-timer limit
  })

  it('is total: measurements that make no sense select a tier, not a crash', () => {
    expect(layoutFor(Number.NaN, Number.POSITIVE_INFINITY).drawer).toBe(true)
    expect(layoutFor(-50, -50).timerSize).toBe('s')
    expect(layoutFor(0, 0).scrambleMaxHeight).toBe(100)
  })
})

describe('layoutFor — the selectors leave only at ≤600', () => {
  it('follows the width band alone, at every band edge', () => {
    // The label-driven escape hatch (headerSlack) is gone as of 2026-10-04:
    // it existed only because the two Gtk.DropDowns could not shrink, so long
    // labels had to be moved out before they pushed the window controls off
    // the edge. The header's selector is now one button whose label
    // ellipsizes, so the header absorbs what it is given and only the window's
    // width decides — hence no third argument to layoutFor.
    expect(layoutFor(selectorRowMax, 540).selectorRow).toBe(true) // 600 → row
    expect(layoutFor(selectorRowMax + 1, 540).selectorRow).toBe(false) // 601 → header
    expect(layoutFor(drawerMax, 540).selectorRow).toBe(false) // 800 → drawer, still header
    expect(layoutFor(drawerMax + 1, 540).selectorRow).toBe(false) // 801 → side by side, header
    expect(layoutFor(largeMin, 540).selectorRow).toBe(false) // tier L → header
    expect(layoutFor(900, 540).selectorRow).toBe(false) // the default window
  })
})

describe('layoutFor — height tiers', () => {
  it('trims the scramble slot when the window is short', () => {
    expect(layoutFor(900, shortMax).scrambleMaxHeight).toBe(100)
    expect(layoutFor(900, shortMax + 1).scrambleMaxHeight).toBe(160)
  })

  it('shrinks the timer on a window too short for the 96px readout', () => {
    expect(layoutFor(1400, BREAKPOINTS.timerSmallMaxHeight).timerSize).toBe('s')
    expect(layoutFor(1400, BREAKPOINTS.timerSmallMaxHeight + 1).timerSize).toBe('l')
  })
})
