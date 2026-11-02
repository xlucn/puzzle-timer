/*
 * layout.ts — the adaptive-layout rules, as pure functions.
 *
 * Architecture rule (see AGENTS.md): pure TypeScript — no `gi:*`, no Node
 * APIs. The *window* measures itself — `Adw.Breakpoint::apply`/`unapply` and
 * `Gdk.Surface::layout`, both wired up in src/main.ts — and hands the numbers
 * to this module; what the UI has to do about them is decided here, where it
 * can be unit tested. Nothing outside this file may hold a threshold, so the
 * breakpoints in main.ts and the decisions they select cannot drift apart.
 *
 * One job:
 *
 *   layoutFor(width, height)     what the layout does with this window: the
 *                                sidebar as a drawer or side by side, the
 *                                scramble selectors in the header or in their
 *                                own row, and how big the timer / scramble /
 *                                diagram get.
 *
 *   layoutFor(width, height,     the same, with the content area's allocation
 *             mainContent)       deciding whether the diagram has room beside
 *                                the timer or below it, and how much the
 *                                docked sidebar shifts that balance.
 *
 *   layoutFor(width, height,     the same, with the user's size multipliers on
 *             mainContent,       top of the curve: sizes follow the room the
 *             sizes)             window gives, and a scale only changes how
 *                                much of that is shown.
 *
 * Units are **logical px** everywhere: GTK lays out in logical px and the
 * compositor scales them up (tools/README.md trap 6), so these numbers match
 * `setDefaultSize`, `minSidebarWidth`, and the sizes the widgets report.
 */

/**
 * Every size threshold the layout reacts to, in logical px, in one place:
 * main.ts builds its `Adw.BreakpointCondition`s from these strings and
 * `layoutFor` makes the matching decisions, so a threshold cannot exist in one
 * and not the other.
 *
 * **These are layout thresholds only.** The presentation sizes — the readout,
 * the scramble slot, the diagram — are continuous functions of the window
 * (`readoutPx()` and friends below), so there is no size tier to select. What
 * is left are the two decisions that change *structure*: the selectors moving
 * to their own row, and the sidebar becoming a drawer.
 *
 * Those two bands are **mutually exclusive on purpose**. libadwaita keeps a
 * single current breakpoint ("if multiple breakpoints can be used for the
 * current size, the last one is always picked" — AdwBreakpointBin docs, which
 * AdwWindow refers to), so overlapping conditions would starve each other and
 * a resize could leave a decision unapplied. Disjoint bands mean every crossing
 * of a boundary changes the current breakpoint, i.e. always fires apply/unapply.
 */
export const BREAKPOINTS = {
  /**
   * ≤ 540 → the scramble selectors leave the header for their own row.
   * 540 also drives the type picker's collapse breakpoint
   * (scrambleTypePicker.ts): it puts a phone in landscape — its dialog wider
   * than 540 — on the picker's two-column side.
   */
  selectorRowMax: 540,
  /** 541–800 → the sidebar becomes an overlay drawer. */
  drawerMax: 800,
  /**
   * Height ≤ 580 on a narrow window → the diagram has no room and is shed.
   * Kept below a 360×590 phone's content height so that phone keeps it.
   */
  shortMax: 580,
  /**
   * `minSidebarWidth` — the sidebar's share of a side-by-side window, which is
   * what the header does *not* have (main.ts reads it from here for the same
   * reason the bands live here: one place, no drift).
   */
  sidebarMin: 240,
  /**
   * The window refuses to be dragged narrower than this (and shorter than
   * `minHeight`): below either, the layout could not stay deliberate.
   *
   * **360×294 is the GNOME HIG's smallest phone-form-factor window** — see
   * developer.gnome.org/hig/guidelines/adaptive.html, Small Size Handling:
   * "apps that are appropriate for a phone form factor should scale down to
   * 360×294px". The height is 294 rather than a square 360 because that is
   * the height a phone in landscape gives an app: a size devices reach, not
   * a margin.
   *
   * The width also equals libadwaita's own `AdwWindow` default (360×200) —
   * the value the breakpoint docs tell you to override when breakpoints are
   * in use ("the minimum size must be larger than the smallest UI state"),
   * which is what `minHeight` does.
   *
   * What fits inside: the `ToolbarView` bars plus the smallest content were
   * measured to fit in 350 (PLAN §7), and the readout's floor is the 72 px
   * that measurement was taken with. The request can only *add* to that —
   * the content's own minimum still holds the window higher if it needs to.
   */
  minWidth: 360,
  minHeight: 294,
} as const

/**
 * How far the timer's start target is inset from the window edges, in logical
 * px. libadwaita's drawer swipe strip is 32 px wide (`ADW_SWIPE_BORDER`), so
 * this leaves its outer half to the swipe and gives the inner half to the
 * timer: a press inside the card claims the sequence, and a drawer swipe can
 * only start in the strip outside it. A 32 px inset would hand the whole
 * strip to the drawer.
 */
export const START_AREA_INSET_PX = 16

/** How the timer and the scramble diagram share the lower area. */
export type DiagramPlacement = 'wide' | 'tall-narrow' | 'none'

/**
 * The readout's size, in logical px, before the user's scale:
 *
 *   size = base × (width / at) ^ growth, clamped by the window's height and
 *          then into [min, max]
 *
 * `96 at 900` keeps the size the default window has always had. `growth 0.55`
 * makes 4× the width give ~2.2× the size, so a 4K window gets a readout that
 * fills it without the blow-up of a linear rule. The height term is what keeps
 * a short window from asking for a readout it cannot show — no second
 * threshold needed. The floor is 72 px because the digits must never clip: the
 * window floor was measured to fit them (PLAN §7), so the floor holds at every
 * size, wide and short included.
 */
const READOUT = {
  base: 96,
  at: 900,
  growth: 0.55,
  /** Never more than this share of the window's height. */
  ofHeight: 0.22,
  min: 72,
  max: 224,
} as const

/** The scramble text's size at the default window, in logical px. */
export const SCRAMBLE_PX = 18

/**
 * The scramble text is a share of the readout, so one curve sizes both: 18 px
 * where the readout is 96, and proportionally above that (42 px at the
 * readout's 224 cap). Below 96 the share alone would take it to 13.5 px on a
 * phone, so it is floored at the 18 px it was fixed at before the curve.
 */
const SCRAMBLE = { ofReadout: SCRAMBLE_PX / READOUT.base, min: SCRAMBLE_PX } as const

/**
 * The scramble text's *request* cap, in characters: it bounds the label's
 * natural width so a 3000-character relay cannot drag the window wider than
 * the screen. The label wraps at whatever width it is allocated, so this is
 * not a visible size and it does not follow the window; the user's text scale
 * divides it (a bigger font fits fewer characters in the same width).
 */
const SCRAMBLE_CHARS = 60

/**
 * How much of the window's height the scramble slot may take. The cap bounds
 * a long relay; short scrambles keep their natural height, and a short window
 * gives the slot proportionally less room instead of a threshold of its own.
 */
const SCRAMBLE_SLOT = { ofHeight: 0.25, min: 90, max: 240 } as const

/**
 * The diagram's box, in logical px. Both dimensions follow the window's linear
 * size — √(width × height), so a portrait and a landscape window of the same
 * area get the same picture — and neither is capped: a bigger window gets a
 * bigger picture. The height is a share of that size; the width is the height
 * times the widest diagram shape (csTimer's widest canvas is ~2.1:1), an upper
 * bound the panel trims to the picture's own aspect so a 4:3 diagram does not
 * reserve a 2:1 column. The box is only clamped where the room runs out: a
 * far-wider-than-tall window, the readout's width beside the timer, and the
 * content width when stacked.
 */
const DIAGRAM = {
  /** Share of the window's linear size (√area), never below `min`. */
  ofSize: 0.3,
  /** The widest diagram the box must fit without clipping the picture. */
  aspect: 2.1,
  min: 90,
  /**
   * Height share that only binds on windows more than 2.25:1, where the area
   * rule asks for more room than the lower area has.
   */
  maxOfHeight: 0.45,
  /**
   * The readout's own width in em — four digits at the tabular figures'
   * advance (`0.00`) — which the picture may not take from it beside the
   * timer. Measured from the label; the em scales with the font size.
   */
  readoutReserve: 2.5,
  /** The box's own end margin, which its size request does not carry. */
  boxInset: 16,
  /** Room for the panel's own margins when it may use the content width. */
  stackedInset: 48,
} as const

/**
 * The user's three size multipliers. Each one scales an output of this module
 * and nothing else: the curve decides *what size* a window gets, the
 * preference decides how much of it.
 */
export interface SizeScales {
  timer: number
  scramble: number
  diagram: number
}

/** The curve's own sizes, untouched — the default for every caller. */
export const UNIT_SCALES: SizeScales = { timer: 1, scramble: 1, diagram: 1 }

/**
 * Wide layout thresholds, as content width / content height. The sidebar
 * changes where the timer sits in the window, so the ratio changes with it.
 *
 * Hidden, the diagram's column pushes the timer about half a diagram left of
 * centre, so wide waits for clearly landscape content. Docked, the sidebar
 * pushes the content right by roughly the same amount, the timer stays near
 * the window centre, and wide can tolerate taller content.
 *
 * The pair also has to survive the 240 px sidebar docking at 801: the shown
 * ratio must stay at or below 561/800 of the hidden ratio, or a wide layout
 * just before the dock collapses just after it.
 */
const WIDE_RATIO_HIDDEN = 1.4
const WIDE_RATIO_SHOWN = 0.7

/** The content area between the toolbar bars, in logical px. */
export interface ContentSize {
  width: number
  height: number
  /**
   * Width the docked sidebar takes from the window. Zero while the sidebar
   * overlays the content, is hidden, or has not allocated yet — the caller
   * combines the state with the measured gap.
   */
  sidebarWidth?: number
}

/** Everything the UI does for a window size, decided in one call. */
export interface LayoutPlan {
  /** Sidebar overlays the content instead of sharing the width with it. */
  drawer: boolean
  /** The scramble selectors are packed into a second row under the header —
   *  at `selectorRowMax` and below, and for no other reason. */
  selectorRow: boolean
  /** The readout's font size, px: the curve, then the user's scale. */
  timerPx: number
  /** `maxWidthChars` for the scramble text — its *request* cap, in chars. */
  scrambleChars: number
  /** The scramble text's font size, px: the base, then the user's scale. */
  scramblePx: number
  /** `maxContentHeight` of the scramble slot, px. */
  scrambleMaxHeight: number
  /**
   * `maxSidebarWidth` — the sidebar's cap; the same 320 at every width.
   */
  sidebarMax: number
  /** Where the diagram sits, or `none` when this window has no room for it. */
  diagramPlacement: DiagramPlacement
  /**
   * The diagram box's cap, px: the box is pinned to this and the picture fits
   * inside it. Zero means the window has no corner for it and it is not drawn
   * at all.
   */
  diagramMaxWidth: number
  diagramMaxHeight: number
}

/** Non-finite measurements must not decide a layout. */
const sane = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0)

/** A size that cannot mean anything (a bad scale) is "unchanged". */
const multiplier = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : 1

/** Keep a computed size inside a designed range. */
const within = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** Rounded px for a widget property or a stylesheet. */
const rounded = (value: number): number => Math.round(value)

/**
 * The readout's size for a window, before the user's scale: the curve from
 * READOUT, clamped by the height and the hard floor. Width grows it, height
 * caps it, and the floor wins at the small end.
 */
function readoutPx(w: number, h: number): number {
  const byWidth = READOUT.base * (w / READOUT.at) ** READOUT.growth
  return Math.max(READOUT.min, Math.min(byWidth, h * READOUT.ofHeight, READOUT.max))
}

/**
 * The layout for a window size (logical px), with the measured content area
 * when it is available and the user's size multipliers on top. Called on every
 * resize and from every breakpoint handler, so it must stay cheap and total:
 * same inputs, same output, no matter which one asked.
 *
 * Only two things here are discrete: the sidebar's drawer/side-by-side state
 * and the selectors' row. Everything else — the readout, the scramble slot,
 * the diagram's box — follows the window continuously, so a resize has no size
 * steps and no band edges to get wrong. The diagram's *placement* is the one
 * rule that also reads the content area's aspect and whether the sidebar is
 * docked. The user's scales are applied last: they never touch a band, a
 * ratio or the placement, so a preference can make the timer bigger but
 * cannot change which layout the window gets.
 *
 * Long labels are not a factor: the header's selector is an icon button and the
 * type text lives in the window title, whose `Adw.WindowTitle` template
 * labels ellipsize (see src/ui/scrambleTypeButton.ts and
 * src/ui/scrambleTypeTitle.ts), so the header's *min* stays small, it absorbs
 * whatever it is given, and the labels have a place to go.
 *
 * `mainContent` is optional because the first layout pass runs before GTK has
 * allocated it. With no measurement, the window's own aspect stands in; the
 * after-paint pass supplies the real content area.
 */
export function layoutFor(
  width: number,
  height: number,
  mainContent?: ContentSize,
  sizes: SizeScales = UNIT_SCALES,
): LayoutPlan {
  const w = sane(width)
  const h = sane(height)
  const measuredWidth = sane(mainContent?.width ?? 0)
  const measuredHeight = sane(mainContent?.height ?? 0)
  const hasContent = measuredWidth > 0 && measuredHeight > 0
  const sidebarDocked = sane(mainContent?.sidebarWidth ?? 0) > 0
  const wideRatio = sidebarDocked ? WIDE_RATIO_SHOWN : WIDE_RATIO_HIDDEN
  // Hidden, the content spans the window, so use the window width: the
  // measured one still carries the shrunken width of a sidebar that is
  // collapsing. Docked, the measured width is the real content width.
  const contentWidth = sidebarDocked && hasContent ? measuredWidth : w
  const contentHeight = hasContent ? measuredHeight : h

  const timerScale = multiplier(sizes.timer)
  const scrambleScale = multiplier(sizes.scramble)
  const diagramScale = multiplier(sizes.diagram)

  // The width band decides whether the window is narrow enough to stack at
  // all; above it, the content area's aspect decides whether the timer and
  // diagram have room side by side. A portrait tablet is wide in window terms
  // (800 > 540) but its content is tall, so the timer gets a full-width row.
  // The sidebar's own width is part of that decision: a docked sidebar moves
  // the content right, so the same content aspect can be balanced while wide.
  let diagramPlacement: DiagramPlacement
  if (w <= BREAKPOINTS.selectorRowMax) {
    diagramPlacement = h <= BREAKPOINTS.shortMax ? 'none' : 'tall-narrow'
  } else {
    diagramPlacement = contentWidth >= contentHeight * wideRatio ? 'wide' : 'tall-narrow'
  }

  // The picture's box follows the window's linear size — the square root of
  // its area — so a portrait and a landscape window of the same area get the
  // same picture and neither orientation looks starved. Only a window far
  // wider than it is tall (past 2.25:1) is clamped by its height, where the
  // lower area has no room for the area rule's answer. The width is the
  // height times the widest shape (the panel trims it to the picture's own
  // aspect).
  const readout = readoutPx(w, h)
  const timerPx = rounded(readout * timerScale)
  const diagramBoxHeight = Math.min(
    Math.max(DIAGRAM.min, Math.sqrt(w * h) * DIAGRAM.ofSize),
    h * DIAGRAM.maxOfHeight,
  )
  const diagramBoxWidth = diagramBoxHeight * DIAGRAM.aspect
  // The box only takes room nothing else claims: beside the timer it leaves
  // the readout its own width, the split view's room for a docked sidebar and
  // its own end margin (a 2:1 picture otherwise outgrew the content and Adw
  // refused the window); stacked it stays inside the content's margins.
  const wideRoom =
    (w > BREAKPOINTS.drawerMax ? w - BREAKPOINTS.sidebarMin : w) -
    timerPx * DIAGRAM.readoutReserve -
    DIAGRAM.boxInset
  const diagramRoom =
    diagramPlacement === 'wide' ? wideRoom : contentWidth - DIAGRAM.stackedInset
  const diagramHeight = rounded(diagramBoxHeight * diagramScale)
  const diagramWidth =
    diagramPlacement === 'none'
      ? 0
      : rounded(Math.min(diagramBoxWidth, Math.max(1, diagramRoom)) * diagramScale)

  // One curve, two readouts: the scramble text follows the timer's size but
  // never drops below the size it had before the curve — on a phone the share
  // alone is too small to read.
  const scrambleSize = Math.max(readout * SCRAMBLE.ofReadout, SCRAMBLE.min)

  return {
    // The width band is the whole rule: at ≤540 the window is too narrow for
    // two controls side by side, and the row gives the labels their own space.
    drawer: w <= BREAKPOINTS.drawerMax,
    selectorRow: w <= BREAKPOINTS.selectorRowMax,
    timerPx,
    // A bigger font fits fewer characters in the same width; the slot's cap
    // grows because the same lines are taller.
    scrambleChars: Math.max(1, Math.round(SCRAMBLE_CHARS / scrambleScale)),
    scramblePx: Math.round(scrambleSize * scrambleScale * 100) / 100,
    scrambleMaxHeight: rounded(
      within(h * SCRAMBLE_SLOT.ofHeight, SCRAMBLE_SLOT.min, SCRAMBLE_SLOT.max) *
        scrambleScale,
    ),
    sidebarMax: 320, // pinned at every width
    diagramPlacement,
    diagramMaxWidth: diagramPlacement === 'none' ? 0 : diagramWidth,
    diagramMaxHeight: diagramPlacement === 'none' ? 0 : diagramHeight,
  }
}
