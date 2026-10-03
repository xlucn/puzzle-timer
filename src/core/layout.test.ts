import { describe, expect, it } from 'vitest'

import { BREAKPOINTS, layoutFor, phoneFormFor, timerMargins } from './layout.js'

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

  it('grows the sidebar in steps instead of pinning it at 320', () => {
    expect(layoutFor(1199, 800).sidebarMax).toBe(320)
    expect(layoutFor(mediumMin, 800).sidebarMax).toBe(380)
    expect(layoutFor(largeMin - 1, 800).sidebarMax).toBe(380)
    expect(layoutFor(largeMin, 800).sidebarMax).toBe(440)
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

describe('layoutFor — the measured header', () => {
  it('keeps this app’s own labels in the header at every band edge', () => {
    // 724px is what the header asks for with a 3x3x3 session (measured, and
    // reported by the `[layout] header asks` line at runtime).
    expect(layoutFor(900, 540, 724).selectorRow).toBe(false) // the default window
    expect(layoutFor(drawerMax + 1, 540, 724).selectorRow).toBe(false) // 801 → 561 for the header
    expect(layoutFor(drawerMax, 540, 724).selectorRow).toBe(false) // 800 → drawer, full width
  })

  it('moves the selectors out when the labels outgrow the header', () => {
    // 1186px is the catalogue's worst case (FTO category + Diamond type).
    expect(layoutFor(900, 540, 1186).selectorRow).toBe(true)
    // …and back in as soon as the window can carry them again: at 1600 the
    // header gets 1360 once the sidebar's share is taken out.
    expect(layoutFor(largeMin, 540, 1186).selectorRow).toBe(false)
  })

  it('charges a side-by-side header for the sidebar’s share, a drawer for nothing', () => {
    const slack = BREAKPOINTS.headerSlack
    // Side by side at 900: room = 900 − 240 = 660, so demand is tolerated up
    // to room + slack and not one pixel more.
    expect(layoutFor(900, 540, 660 + slack).selectorRow).toBe(false)
    expect(layoutFor(900, 540, 661 + slack).selectorRow).toBe(true)
    // Drawer at 700: the header has the whole window, sidebar or no sidebar.
    expect(layoutFor(700, 540, 700 + slack).selectorRow).toBe(false)
    expect(layoutFor(700, 540, 701 + slack).selectorRow).toBe(true)
  })

  it('falls back to the width bands when nothing has been measured', () => {
    expect(layoutFor(900, 540).selectorRow).toBe(false)
    expect(layoutFor(900, 540, 0).selectorRow).toBe(false)
    // A demand that makes no sense decides nothing — the bands still do.
    expect(layoutFor(900, 540, Number.NaN).selectorRow).toBe(false)
    expect(layoutFor(selectorRowMax, 540, Number.NaN).selectorRow).toBe(true)
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

/** A 900×540 window with the sidebar open: content 660 wide, header + one-line scramble. */
const balanced = {
  diagramVisible: true,
  diagramWidth: 240,
  diagramHeight: 120,
  phoneForm: false,
  viewWidth: 660,
  viewHeight: 540,
  regionTop: 111,
  naturalWidth: 300,
  naturalHeight: 180,
}

/** Where the block's centre sits with no margins: dead centre of its region. */
const centred = (p: typeof balanced): { x: number; y: number } => ({
  x: p.viewWidth / 2,
  y: (p.regionTop + p.viewHeight) / 2,
})

/** Where it sits after `m`, given that a margin moves the centre by half of it. */
const nudged = (
  p: typeof balanced,
  m: { marginEnd: number; marginBottom: number },
): { x: number; y: number } => ({
  x: (p.viewWidth - m.marginEnd) / 2,
  y: p.regionTop + (p.viewHeight - p.regionTop - m.marginBottom) / 2,
})

describe('timerMargins — the nudge for the diagram', () => {
  it('does nothing without a diagram to step aside for', () => {
    expect(timerMargins({ ...balanced, diagramVisible: false })).toEqual({
      marginEnd: 0,
      marginBottom: 0,
    })
  })

  it('moves the centre a quarter of a diagram left and a quarter up (user call, 2026-10-02)', () => {
    const m = timerMargins(balanced)
    const before = centred(balanced)
    const after = nudged(balanced, m)

    // Margin shrinks the centring area, so the centre moves by half of it: an
    // end margin of `diagramWidth / 2` is exactly the requested quarter-diagram
    // shift (the rule was halved from /2 the same day it was introduced).
    expect(before.x - after.x).toBeCloseTo(balanced.diagramWidth / 4, 5)
    expect(before.y - after.y).toBeCloseTo(balanced.diagramHeight / 4, 5)
  })

  it('scales with the diagram: a bigger picture moves the timer further', () => {
    const small = timerMargins({ ...balanced, diagramWidth: 100, diagramHeight: 40 })
    const large = timerMargins({ ...balanced, diagramWidth: 560, diagramHeight: 190 })
    expect(large.marginEnd).toBeGreaterThan(small.marginEnd)
    expect(large.marginBottom).toBeGreaterThan(small.marginBottom)
  })

  it('leaves the block taller than its natural height — the timer cannot collide with the scramble', () => {
    const { marginBottom } = timerMargins(balanced)
    expect(balanced.viewHeight - balanced.regionTop - marginBottom).toBeGreaterThanOrEqual(
      balanced.naturalHeight,
    )
  })

  it('clamps horizontally rather than pushing the window wider than it is', () => {
    // The rule asks for a 120px end margin (240/2); a 400px-wide view with a
    // 350px readout has 34px spare, so the nudge gives up ground instead of
    // growing the content's minimum width. (A view width, not the window's
    // floor — that is 360, see BREAKPOINTS.minWidth.)
    const narrow = { ...balanced, viewWidth: 400, naturalWidth: 350 }
    const { marginEnd } = timerMargins(narrow)
    expect(marginEnd).toBe(400 - 350 - 16)
  })

  it('clamps vertically to the region instead of squeezing the block', () => {
    // Room for 44 of the 60 the rule wants here (120/2): a quarter of the
    // offset, never a block below its natural height.
    const short = { ...balanced, regionTop: 300 }
    expect(timerMargins(short).marginBottom).toBe(
      short.viewHeight - short.regionTop - short.naturalHeight - 16,
    )
  })

  it('always leaves the content a smaller minimum than its current height', () => {
    // The block's margins are part of its parent's *minimum size*, so a margin
    // of exactly the spare height would lock the window at the size it had when
    // the nudge was measured — and resizing below that from outside clips the
    // content (measured: 439px of content in a 370px window). Strict headroom
    // on both axes is what keeps the window shrinkable.
    // (Only regions that can hold the block at all: where the block overflows
    // on its own the minimum is already past this, nudge or not.)
    const cases = [
      { viewHeight: 440, regionTop: 111 },
      { viewHeight: 540, regionTop: 111 },
      { viewHeight: 540, regionTop: 300 },
      { viewHeight: 1080, regionTop: 300 },
    ]
    for (const { viewHeight, regionTop } of cases) {
      const p = { ...balanced, viewHeight, regionTop }
      const m = timerMargins(p)
      expect(p.regionTop + p.naturalHeight + m.marginBottom).toBeLessThan(p.viewHeight)
      expect(p.naturalWidth + m.marginEnd).toBeLessThan(p.viewWidth)
    }
  })

  it('adds nothing when the region is already tighter than the block', () => {
    // The block overflows on its own here; the nudge must not make it worse.
    const cramped = { ...balanced, viewHeight: 300, regionTop: 220, naturalHeight: 180 }
    expect(timerMargins(cramped).marginBottom).toBe(0)
  })

  it('only ever moves the timer up and left — never down or right', () => {
    for (const viewWidth of [400, 660, 900, 1920]) {
      for (const viewHeight of [360, 540, 1080]) {
        const m = timerMargins({ ...balanced, viewWidth, viewHeight })
        expect(m.marginEnd).toBeGreaterThanOrEqual(0)
        expect(m.marginBottom).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('is total: nonsense geometry produces margins, not NaN', () => {
    const m = timerMargins({
      diagramVisible: true,
      diagramWidth: Number.NaN,
      diagramHeight: Number.NaN,
      phoneForm: false,
      viewWidth: Number.NaN,
      viewHeight: Number.NaN,
      regionTop: Number.NaN,
      naturalWidth: Number.NaN,
      naturalHeight: Number.NaN,
    })
    expect(Number.isFinite(m.marginEnd)).toBe(true)
    expect(Number.isFinite(m.marginBottom)).toBe(true)
  })
})

describe('phoneFormFor — the tiers C/S condition', () => {
  it('holds up to and including the selector-row band, and not one pixel more', () => {
    expect(phoneFormFor(smallMax)).toBe(true)
    expect(phoneFormFor(selectorRowMax)).toBe(true)
    expect(phoneFormFor(selectorRowMax + 1)).toBe(false)
    expect(phoneFormFor(900)).toBe(false) // the default window
  })

  it('is total: a measurement that makes no sense is a phone, not a crash', () => {
    expect(phoneFormFor(Number.NaN)).toBe(true)
    expect(phoneFormFor(-50)).toBe(true)
  })
})

describe('timerMargins — the phone form (≤600)', () => {
  const phone = { ...balanced, phoneForm: true, viewWidth: 350, naturalWidth: 300 }

  it('leaves the timer dead centre horizontally', () => {
    expect(timerMargins(phone).marginEnd).toBe(0)
  })

  it('still steps aside when there is no diagram to step aside for', () => {
    expect(timerMargins({ ...phone, diagramVisible: false })).toEqual({
      marginEnd: 0,
      marginBottom: 0,
    })
  })

  it('lifts the centre up by half the diagram, not a quarter (user call, 2026-10-03)', () => {
    const m = timerMargins(phone)
    const before = centred(phone)
    const after = nudged(phone, m)
    // margin = diagramHeight moves the centre by half of it → diagramHeight/2
    expect(before.y - after.y).toBeCloseTo(phone.diagramHeight / 2, 5)
    expect(before.x).toBeCloseTo(after.x, 5) // …and not one pixel sideways
  })

  it('still clamps to the room that exists — the invariant outranks the rule', () => {
    // A region with only 44px to spare wants 120 and gets 44, same as wide.
    const cramped = { ...phone, regionTop: 300 }
    expect(timerMargins(cramped).marginBottom).toBe(
      cramped.viewHeight - cramped.regionTop - cramped.naturalHeight - 16,
    )
  })

  it('never squeezes the block below its natural size', () => {
    // Where the region can hold the block at all, the clamp must leave it the
    // whole natural height — the tighter the region, the more it matters.
    for (const regionTop of [111, 200, 300, 344]) {
      const p = { ...phone, regionTop }
      const { marginBottom } = timerMargins(p)
      if (p.viewHeight - regionTop < p.naturalHeight) continue // region can't hold it
      expect(p.viewHeight - regionTop - marginBottom).toBeGreaterThanOrEqual(p.naturalHeight)
    }
  })

  it('gives more lift than the wide rule, never less', () => {
    expect(timerMargins(phone).marginBottom).toBeGreaterThan(
      timerMargins({ ...phone, phoneForm: false }).marginBottom,
    )
  })

  it('only ever moves the timer up — never down or right', () => {
    for (const viewWidth of [350, 400, 599, 600]) {
      for (const viewHeight of [360, 540, 1080]) {
        const m = timerMargins({ ...phone, viewWidth, viewHeight })
        expect(m.marginEnd).toBe(0)
        expect(m.marginBottom).toBeGreaterThanOrEqual(0)
      }
    }
  })
})
