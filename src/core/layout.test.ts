import { describe, expect, it } from 'vitest'

import { BREAKPOINTS, DRAWER_EDGE_PX, isDrawerEdgePress, layoutFor } from './layout.js'

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

  it('pins the sidebar at 320 at every width', () => {
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

describe('layoutFor — the diagram follows the room', () => {
  it('uses one row and two columns on every wide window', () => {
    expect(layoutFor(selectorRowMax + 1, 360).diagramPlacement).toBe('wide')
    expect(layoutFor(640, 360).diagramPlacement).toBe('wide')
    expect(layoutFor(900, shortMax).diagramPlacement).toBe('wide')
    expect(layoutFor(900, shortMax + 1).diagramPlacement).toBe('wide')
    expect(layoutFor(1600, 900).diagramPlacement).toBe('wide')
  })

  it('stacks the rows on a narrow tall window', () => {
    expect(layoutFor(selectorRowMax, shortMax + 1).diagramPlacement).toBe('tall-narrow')
    expect(layoutFor(360, 590).diagramPlacement).toBe('tall-narrow') // 16:9 phone content
    expect(layoutFor(360, 700).diagramPlacement).toBe('tall-narrow')
  })

  it('stacks a wide window when its content area is taller than wide', () => {
    expect(
      layoutFor(800, 1280, { width: 790, height: 1240 }).diagramPlacement,
    ).toBe('tall-narrow')
    expect(
      layoutFor(1024, 1366, { width: 1010, height: 1300 }).diagramPlacement,
    ).toBe('tall-narrow')
    expect(layoutFor(800, 1280, { width: 790, height: 940 }).diagramPlacement).toBe(
      'tall-narrow',
    )
  })

  it('keeps a square content area stacked while the sidebar is hidden', () => {
    expect(layoutFor(790, 1000, { width: 790, height: 790 }).diagramPlacement).toBe(
      'tall-narrow',
    )
  })

  it('falls back to the window aspect before the content is allocated', () => {
    expect(layoutFor(800, 1280).diagramPlacement).toBe('tall-narrow')
    expect(layoutFor(1280, 800).diagramPlacement).toBe('wide')
    expect(layoutFor(800, 1280, { width: 0, height: 0 }).diagramPlacement).toBe(
      'tall-narrow',
    )
  })

  it('sheds it on a narrow short window', () => {
    for (const [w, h] of [
      [360, 294], // the window floor
      [360, 360],
      [selectorRowMax, 360],
      [selectorRowMax, shortMax],
    ]) {
      const tier = layoutFor(w, h)
      expect(tier.diagramPlacement).toBe('none')
      expect([tier.diagramMaxWidth, tier.diagramMaxHeight]).toEqual([0, 0])
    }
  })

  it('keeps the tier caps, narrowed only in the wide layout', () => {
    expect(layoutFor(640, 360).diagramMaxWidth).toBe(180)
    expect(layoutFor(640, 360).diagramMaxHeight).toBe(150)
    expect(layoutFor(800, 540).diagramMaxHeight).toBe(150)
    expect(layoutFor(1600, 500).diagramMaxWidth).toBe(180)
    expect(layoutFor(360, 700).diagramMaxWidth).toBe(440)
    expect(layoutFor(1600, 900).diagramMaxWidth).toBe(180)
  })
})

describe('layoutFor — the sidebar shifts the wide threshold', () => {
  it('requires more width when the sidebar is hidden', () => {
    expect(
      layoutFor(800, 800, { width: 800, height: 600, sidebarWidth: 0 }).diagramPlacement,
    ).toBe('tall-narrow') // 800 < 1.4 × 600
    expect(
      layoutFor(840, 800, { width: 840, height: 600, sidebarWidth: 0 }).diagramPlacement,
    ).toBe('wide') // 840 = 1.4 × 600
  })

  it('allows a taller content area once the sidebar is docked', () => {
    expect(
      layoutFor(801, 694, {
        width: 800 - BREAKPOINTS.sidebarMin,
        height: 648,
        sidebarWidth: BREAKPOINTS.sidebarMin,
      }).diagramPlacement,
    ).toBe('wide') // 561 >= 0.7 × 648
    expect(
      layoutFor(801, 694, { width: 561, height: 648, sidebarWidth: 0 }).diagramPlacement,
    ).toBe('tall-narrow')
  })

  it('reads the measured gap, not the show-sidebar flag', () => {
    // At 801 the breakpoint has applied but the sidebar has not allocated yet.
    // The gap is still zero, so the hidden ratio keeps the layout stacked
    // until the content actually shrinks.
    expect(
      layoutFor(801, 694, { width: 800, height: 648, sidebarWidth: 0 }).diagramPlacement,
    ).toBe('tall-narrow')
    expect(
      layoutFor(801, 694, { width: 561, height: 648, sidebarWidth: 240 }).diagramPlacement,
    ).toBe('wide')
  })

  it('uses the window width while a collapsing sidebar is still allocated', () => {
    // 800×562 is wide with the sidebar hidden. A stale 560-wide content
    // allocation must not select tall for a frame on the way out.
    expect(
      layoutFor(800, 608, { width: 560, height: 562, sidebarWidth: 0 }).diagramPlacement,
    ).toBe('wide')
  })

  it('never flips wide→tall when the sidebar docks at 801', () => {
    for (let height = 500; height <= 800; height++) {
      const hidden = layoutFor(800, height + 46, {
        width: 800,
        height,
        sidebarWidth: 0,
      })
      if (hidden.diagramPlacement !== 'wide') continue
      const docked = layoutFor(801, height + 46, {
        width: 800 - BREAKPOINTS.sidebarMin,
        height,
        sidebarWidth: BREAKPOINTS.sidebarMin,
      })
      expect(docked.diagramPlacement, `content height ${height}`).toBe('wide')
    }
  })

  it('keeps the wide layout across the dock for the heights that used to flip', () => {
    for (const height of [562, 648, 800]) {
      const docked = layoutFor(801, height + 46, {
        width: 800 - BREAKPOINTS.sidebarMin,
        height,
        sidebarWidth: BREAKPOINTS.sidebarMin,
      })
      expect(docked.diagramPlacement, `content height ${height}`).toBe('wide')
    }
  })
})

describe('layoutFor — the selectors leave only at ≤540', () => {
  it('follows the width band alone, at every band edge', () => {
    // The width band is the whole rule: the header's selector is one button
    // whose label ellipsizes, so the header absorbs whatever it is given and
    // long labels never force the move — only the window's width decides,
    // hence no third argument to layoutFor.
    expect(layoutFor(selectorRowMax, 540).selectorRow).toBe(true) // 540 → row
    expect(layoutFor(selectorRowMax + 1, 540).selectorRow).toBe(false) // 541 → header
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

describe('BREAKPOINTS — the window floor', () => {
  it('is the HIG phone minimum: 360 wide, 294 tall', () => {
    expect(BREAKPOINTS.minWidth).toBe(360)
    expect(BREAKPOINTS.minHeight).toBe(294)
  })

  it('selects a deliberate tier at the floor', () => {
    const tier = layoutFor(BREAKPOINTS.minWidth, BREAKPOINTS.minHeight)
    expect(tier.drawer).toBe(true)
    expect(tier.selectorRow).toBe(true)
    expect(tier.timerSize).toBe('s')
    expect(tier.scrambleMaxHeight).toBe(100)
  })
})

describe('isDrawerEdgePress — the drawer owns the edge', () => {
  it('matches libadwaita’s 32px edge target', () => {
    expect(DRAWER_EDGE_PX).toBe(32)
  })

  it('is the left edge for a start sidebar in LTR', () => {
    expect(isDrawerEdgePress(0, 360, true, false)).toBe(true)
    expect(isDrawerEdgePress(DRAWER_EDGE_PX - 1, 360, true, false)).toBe(true)
    expect(isDrawerEdgePress(DRAWER_EDGE_PX, 360, true, false)).toBe(false)
    expect(isDrawerEdgePress(359, 360, true, false)).toBe(false)
  })

  it('is the right edge for an end sidebar in LTR', () => {
    expect(isDrawerEdgePress(359, 360, false, false)).toBe(true)
    expect(isDrawerEdgePress(360 - DRAWER_EDGE_PX, 360, false, false)).toBe(false)
    expect(isDrawerEdgePress(0, 360, false, false)).toBe(false)
  })

  it('follows the logical side in RTL', () => {
    expect(isDrawerEdgePress(0, 360, true, true)).toBe(false)
    expect(isDrawerEdgePress(359, 360, true, true)).toBe(true)
    expect(isDrawerEdgePress(0, 360, false, true)).toBe(true)
    expect(isDrawerEdgePress(359, 360, false, true)).toBe(false)
  })

  it('never claims a press before the widget has a width', () => {
    expect(isDrawerEdgePress(0, 0, true, false)).toBe(false)
  })
})
