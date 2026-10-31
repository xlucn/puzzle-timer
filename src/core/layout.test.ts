import { describe, expect, it } from 'vitest'

import {
  BREAKPOINTS,
  START_AREA_INSET_PX,
  layoutFor,
  UNIT_SCALES,
  type SizeScales,
} from './layout.js'

const { selectorRowMax, drawerMax, shortMax } = BREAKPOINTS

/** A full set of scales with only the one under test changed. */
const scales = (patch: Partial<SizeScales>): SizeScales => ({ ...UNIT_SCALES, ...patch })

describe('layoutFor — width bands', () => {
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
    expect(layoutFor(400, 540).selectorRow).toBe(true)
    expect(layoutFor(400, 540).drawer).toBe(true)
  })

  it('pins the sidebar at 320 at every width', () => {
    expect(layoutFor(400, 540).sidebarMax).toBe(320)
    expect(layoutFor(1199, 800).sidebarMax).toBe(320)
    expect(layoutFor(1200, 800).sidebarMax).toBe(320)
    expect(layoutFor(1600, 800).sidebarMax).toBe(320)
    expect(layoutFor(3000, 1600).sidebarMax).toBe(320)
  })

  it('is total: measurements that make no sense select a layout, not a crash', () => {
    expect(layoutFor(Number.NaN, Number.POSITIVE_INFINITY).drawer).toBe(true)
    expect(layoutFor(-50, -50).timerPx).toBe(72)
    expect(layoutFor(0, 0).scrambleMaxHeight).toBe(90)
  })
})

describe('layoutFor — the sizes follow the room', () => {
  it('keeps the readout at its hard floor where the digits could clip', () => {
    // 360×294 is the window floor; 72 is the size the floor was measured at.
    expect(layoutFor(360, 294).timerPx).toBe(72)
    expect(layoutFor(480, 700).timerPx).toBe(72)
    // Wide but very short: the height cap asks for less than the floor.
    expect(layoutFor(1600, 294).timerPx).toBe(72)
  })

  it('keeps the 96 px the default window has always had', () => {
    expect(layoutFor(900, 540).timerPx).toBe(96)
  })

  it('grows with the width and stops at the cap', () => {
    const at = (w: number) => layoutFor(w, 1200).timerPx
    expect(at(1200)).toBeGreaterThan(at(900))
    expect(at(1600)).toBeGreaterThan(at(1200))
    expect(at(2560)).toBeGreaterThan(at(1600))
    expect(layoutFor(5000, 2000).timerPx).toBe(224) // the cap
  })

  it('is monotone: no window is ever smaller than a narrower one', () => {
    for (let w = 360; w < 3840; w += 7) {
      expect(layoutFor(w + 1, 900).timerPx).toBeGreaterThanOrEqual(layoutFor(w, 900).timerPx)
    }
  })

  it('lets the height cap win on a short window', () => {
    expect(layoutFor(1600, 400).timerPx).toBe(Math.round(400 * 0.22))
    expect(layoutFor(1600, 400).timerPx).toBeLessThan(layoutFor(1600, 900).timerPx)
  })

  it('floors the scramble text at the size it had before the curve', () => {
    expect(layoutFor(900, 540).scramblePx).toBe(18) // the default window
    expect(layoutFor(360, 294).scramblePx).toBe(18) // the share alone gives 13.5
    expect(layoutFor(1600, 400).scramblePx).toBe(18) // height cap: 88 px readout
    for (const w of [400, 540, 700, 860]) {
      expect(layoutFor(w, 900).scramblePx, String(w)).toBe(18)
    }
    const at = (w: number) => layoutFor(w, 900).scramblePx
    expect(at(1600)).toBeGreaterThan(at(900))
    expect(at(2560)).toBeGreaterThan(at(1600))
    const huge = layoutFor(3840, 2160)
    expect(huge.scramblePx).toBeCloseTo(huge.timerPx * (18 / 96), 0) // ~40 px
  })

  it('gives the scramble slot a share of the height, clamped', () => {
    expect(layoutFor(900, 294).scrambleMaxHeight).toBe(90) // floor
    expect(layoutFor(900, 540).scrambleMaxHeight).toBe(Math.round(540 * 0.25))
    expect(layoutFor(900, 1440).scrambleMaxHeight).toBe(240) // cap
    expect(layoutFor(900, 900).scrambleChars).toBe(60)
  })

  it('scales the diagram with the room and sheds it where there is none', () => {
    // Wide: the corner may take a fifth of the window width.
    expect(layoutFor(900, 540).diagramMaxWidth).toBe(180)
    expect(layoutFor(900, 540).diagramMaxHeight).toBe(Math.round(540 * 0.3))
    expect(layoutFor(1600, 900).diagramMaxWidth).toBe(260) // cap
    expect(layoutFor(1600, 900).diagramMaxHeight).toBe(260) // cap
    // Stacked under the timer, the content width is the limit — but no wider
    // than the wide placement's cap.
    expect(layoutFor(360, 700).diagramMaxWidth).toBe(260)
    expect(layoutFor(360, 700).diagramMaxHeight).toBe(Math.round(700 * 0.3))
    // A narrow, short window still sheds it entirely.
    expect(layoutFor(360, 294).diagramPlacement).toBe('none')
    expect(layoutFor(360, shortMax).diagramMaxWidth).toBe(0)
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
      const plan = layoutFor(w, h)
      expect(plan.diagramPlacement).toBe('none')
      expect([plan.diagramMaxWidth, plan.diagramMaxHeight]).toEqual([0, 0])
    }
  })

  it('scales the box with the window instead of switching to a fixed cap', () => {
    expect(layoutFor(640, 360).diagramMaxWidth).toBe(128) // 0.2 × 640, wide
    expect(layoutFor(640, 360).diagramMaxHeight).toBe(108) // 0.3 × 360
    expect(layoutFor(800, 540).diagramMaxHeight).toBe(162)
    expect(layoutFor(1600, 500).diagramMaxWidth).toBe(260) // 0.2 × 1600, capped
    expect(layoutFor(360, 700).diagramMaxWidth).toBe(260) // stacked, capped too
    expect(layoutFor(1600, 900).diagramMaxWidth).toBe(260) // capped beside the timer
  })

  it('caps both placements at the same size, so one cannot dwarf the other', () => {
    // A tall portrait window used to get content width − 48 (752 on 800×1280)
    // while a wide one got 260 — the stacked picture was three times as big.
    const stacked = layoutFor(800, 1280)
    expect(stacked.diagramPlacement).toBe('tall-narrow')
    expect(stacked.diagramMaxWidth).toBe(260)
    expect(stacked.diagramMaxHeight).toBe(260)
    const wide = layoutFor(1600, 900)
    expect(wide.diagramPlacement).toBe('wide')
    expect(wide.diagramMaxWidth).toBe(stacked.diagramMaxWidth)
    expect(wide.diagramMaxHeight).toBe(stacked.diagramMaxHeight)
    // …and a genuinely narrow window can still fit the capped box.
    expect(layoutFor(360, 700).diagramMaxWidth).toBe(260)
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
    expect(layoutFor(3000, 540).selectorRow).toBe(false) // large → header
    expect(layoutFor(900, 540).selectorRow).toBe(false) // the default window
  })
})

describe('layoutFor — the sizes leave no steps behind', () => {
  it('never jumps when a band edge is crossed', () => {
    // The sizes used to step at 480/1200/1600; crossing those widths must now
    // move them by at most a pixel or two, never by a tier's worth.
    for (const edge of [480, 1200, 1600]) {
      const below = layoutFor(edge - 1, 900)
      const above = layoutFor(edge, 900)
      expect(Math.abs(above.timerPx - below.timerPx), String(edge)).toBeLessThanOrEqual(1)
      expect(Math.abs(above.diagramMaxWidth - below.diagramMaxWidth), String(edge)).toBeLessThanOrEqual(2)
    }
  })

  it('trims the scramble slot smoothly instead of at 580', () => {
    const at = (h: number) => layoutFor(900, h).scrambleMaxHeight
    expect(at(shortMax + 1) - at(shortMax)).toBeLessThanOrEqual(1)
    expect(at(shortMax + 200)).toBeGreaterThan(at(shortMax))
  })

  it('shrinks the readout on a short window without a threshold', () => {
    const at = (h: number) => layoutFor(1400, h).timerPx
    expect(at(480) - at(479)).toBeLessThanOrEqual(1)
    expect(at(400)).toBeLessThan(at(700))
  })
})

describe('layoutFor — the user’s size scales', () => {
  it('changes nothing at 1.00', () => {
    expect(layoutFor(900, 900, undefined, UNIT_SCALES)).toEqual(layoutFor(900, 900))
  })

  it('scales the readout on top of the curve', () => {
    const curve = layoutFor(900, 900).timerPx
    expect(layoutFor(900, 900, undefined, scales({ timer: 1.5 })).timerPx).toBe(
      Math.round(curve * 1.5),
    )
    // The floor and the cap are scaled too: a preference may push past the
    // curve's own bounds, which is the point of a size setting.
    expect(layoutFor(360, 294, undefined, scales({ timer: 0.75 })).timerPx).toBe(54)
    expect(layoutFor(5000, 2000, undefined, scales({ timer: 1.5 })).timerPx).toBe(336)
  })

  it('fits fewer characters and a taller slot as the scramble text grows', () => {
    const base = layoutFor(900, 900).scrambleChars
    const big = layoutFor(900, 900, undefined, scales({ scramble: 1.5 }))
    expect(big.scramblePx).toBe(18 * 1.5)
    expect(big.scrambleChars).toBe(Math.round(base / 1.5))
    expect(big.scrambleMaxHeight).toBe(Math.round(225 * 1.5))
    const small = layoutFor(900, 900, undefined, scales({ scramble: 0.75 }))
    expect(small.scrambleChars).toBe(Math.round(base / 0.75))
  })

  it('scales the diagram box on top of the curve', () => {
    const wide = layoutFor(640, 360)
    expect(layoutFor(640, 360, undefined, scales({ diagram: 0.5 })).diagramMaxWidth).toBe(
      Math.round(wide.diagramMaxWidth * 0.5),
    )
    expect(layoutFor(640, 360, undefined, scales({ diagram: 1.5 })).diagramMaxHeight).toBe(
      Math.round(wide.diagramMaxHeight * 1.5),
    )
    // A window that sheds the diagram keeps it shed, whatever the scale says.
    const shed = layoutFor(360, 294, undefined, scales({ diagram: 1.5 }))
    expect([shed.diagramMaxWidth, shed.diagramMaxHeight]).toEqual([0, 0])
  })

  it('leaves the layout decisions to the window', () => {
    const scalesAll = scales({ timer: 1.5, scramble: 1.5, diagram: 1.5 })
    const zoomed = layoutFor(400, 700, undefined, scalesAll)
    expect(zoomed.drawer).toBe(true)
    expect(zoomed.selectorRow).toBe(true)
    expect(zoomed.diagramPlacement).toBe('tall-narrow')
    const small = scales({ timer: 0.75, scramble: 0.75, diagram: 0.75 })
    const wide = layoutFor(1600, 900, undefined, small)
    expect(wide.drawer).toBe(false)
    expect(wide.diagramPlacement).toBe('wide')
  })

  it('treats a scale that cannot mean anything as unchanged', () => {
    const base = layoutFor(900, 900)
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const plan = layoutFor(
        900,
        900,
        undefined,
        scales({ timer: bad, scramble: bad, diagram: bad }),
      )
      expect(plan.timerPx, String(bad)).toBe(base.timerPx)
      expect(plan.scramblePx, String(bad)).toBe(18)
      expect(plan.diagramMaxWidth, String(bad)).toBe(base.diagramMaxWidth)
    }
  })
})

describe('BREAKPOINTS — the window floor', () => {
  it('is the HIG phone minimum: 360 wide, 294 tall', () => {
    expect(BREAKPOINTS.minWidth).toBe(360)
    expect(BREAKPOINTS.minHeight).toBe(294)
  })

  it('selects a deliberate layout at the floor', () => {
    const plan = layoutFor(BREAKPOINTS.minWidth, BREAKPOINTS.minHeight)
    expect(plan.drawer).toBe(true)
    expect(plan.selectorRow).toBe(true)
    expect(plan.timerPx).toBe(72) // the measured floor, not a step
    expect(plan.scrambleMaxHeight).toBe(90)
  })
})

describe('START_AREA_INSET_PX — the strip is shared with the swipe', () => {
  it('keeps the target inside libadwaita’s 32px strip, leaving the outer half to the drawer', () => {
    expect(START_AREA_INSET_PX).toBe(16)
    // 32 is ADW_SWIPE_BORDER; at that inset the target would cover the whole
    // strip and no drawer swipe could start.
    expect(START_AREA_INSET_PX).toBeLessThan(32)
  })
})
