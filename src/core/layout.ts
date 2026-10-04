/*
 * layout.ts — the adaptive-layout rules (M6), as pure functions.
 *
 * Architecture rule (see AGENTS.md): pure TypeScript — no `gi:*`, no Node
 * APIs. The *window* measures itself — `Adw.Breakpoint::apply`/`unapply` and
 * `Gdk.Surface::layout`, both wired up in src/main.ts — and hands the numbers
 * to this module; what the UI has to do about them is decided here, where it
 * can be unit tested. Nothing outside this file may hold a threshold, so the
 * breakpoints in main.ts and the tiers they select cannot drift apart.
 *
 * Two jobs:
 *
 *   layoutFor(width, height)     which *tier* the window is in: sidebar as a
 *                                drawer or side by side, the scramble
 *                                selectors in the header or in their own row,
 *                                how big the timer / scramble / diagram get,
 *                                how wide the sidebar may grow.
 *   timerMargins(placement)      where the timer block sits while the scramble
 *                                diagram is on screen — see the note on the
 *                                nudge below.
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
 * The width bands are **mutually exclusive on purpose**. libadwaita keeps a
 * single current breakpoint ("if multiple breakpoints can be used for the
 * current size, the last one is always picked" — AdwBreakpointBin docs, which
 * AdwWindow refers to), so overlapping conditions would starve each other and
 * a resize could leave a tier unapplied. Disjoint bands mean every crossing of
 * a boundary changes the current breakpoint, i.e. always fires apply/unapply.
 */
export const BREAKPOINTS = {
  /** ≤ 480 → tier S: the timer's digits step down so they never clip. */
  smallMax: 480,
  /** 481–600 → tier C: the selectors leave the header for their own row. */
  selectorRowMax: 600,
  /** 601–800 → tier B: the sidebar becomes an overlay drawer. */
  drawerMax: 800,
  /** 1200–1599 → tier M: the sidebar may grow, the timer steps up. */
  mediumMin: 1200,
  /** ≥ 1600 → tier L: everything takes the room it is given. */
  largeMin: 1600,
  /** Height ≤ 620 → the scramble slot gives height back to the timer. */
  shortMax: 620,
  /** A window this short needs the smaller timer, whatever its width. */
  timerSmallMaxHeight: 480,
  /** Tier L only grows the scramble slot and the diagram when it is also tall. */
  tallMin: 760,
  /**
   * `minSidebarWidth` — the sidebar's share of a side-by-side window, which is
   * what the header does *not* have (main.ts reads it from here for the same
   * reason the bands live here: one place, no drift).
   */
  sidebarMin: 240,
  /**
   * The window refuses to be dragged narrower than this (and shorter than
   * `minHeight`): below it no tier could keep the layout deliberate.
   *
   * **360 is the GNOME HIG's minimum for the phone form factor** — see
   * developer.gnome.org/hig/guidelines/adaptive.html (user call, 2026-10-03;
   * it was 400 before, which was this project's own number). Height stays
   * 360, so the floor is square, and the width now equals libadwaita's own
   * `AdwWindow` default (360×200) — the value the breakpoint docs tell you to
   * override when breakpoints are in use ("the minimum size must be larger
   * than the smallest UI state"), which is what `minHeight` still does.
   *
   * What used to hold this number up is gone: the selector row was two
   * Gtk.DropDowns wanting ~282px between them, and is now one ButtonRow whose
   * title ellipsizes (user-verified), while at ≤600 the header carries no
   * labels at all. The floor is therefore the header's fixed chrome and the
   * tier-S timer, both comfortably inside 350 (measured — see PLAN §7).
   */
  minWidth: 360,
  minHeight: 360,
} as const

/** Timer readout size class (src/ui/timerLabel.ts styles `.size-*`). */
export type TimerSize = 's' | 'm' | 'l'

/** Everything that changes with the window's size, decided in one call. */
export interface LayoutTier {
  /** Sidebar overlays the content instead of sharing the width with it. */
  drawer: boolean
  /** The scramble selectors are packed into a second row under the header —
   *  at `selectorRowMax` and below, and for no other reason. */
  selectorRow: boolean
  /** Size class for the timer's digits. */
  timerSize: TimerSize
  /** `maxWidthChars` for the scramble text — how wide it is allowed to run. */
  scrambleChars: number
  /** `maxContentHeight` of the scramble slot, in px. */
  scrambleMaxHeight: number
  /** `maxSidebarWidth` — the sidebar may grow with the window (M6). */
  sidebarMax: number
  /** Diagram cap, px — the picture is scaled to fit before it is shown. */
  diagramMaxWidth: number
  diagramMaxHeight: number
}

/** Non-finite measurements must not decide a tier. */
const sane = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0)

/**
 * The tier for a content width/height (logical px). Called on every resize and
 * from every breakpoint handler, so it must stay cheap and total: same inputs,
 * same output, no matter which one asked.
 *
 * Width bands alone decide everything, selectors included — the row takes them
 * over at `selectorRowMax` and nowhere else. It used to have a second,
 * label-driven escape hatch (`headerSlack`: move them out early when the
 * header's natural width exceeded its room), but that only existed because the
 * two Gtk.DropDowns could not shrink: Gtk.HeaderBar packs start widgets at
 * natural width, so long labels pushed the window controls off the edge. The
 * header's selector is now one button whose label ellipsizes (see
 * src/ui/scrambleTypeButton.ts), so its *min* stays small, the header absorbs
 * whatever it is given, and the labels have a place to go (user call,
 * 2026-10-04).
 */
export function layoutFor(width: number, height: number): LayoutTier {
  const w = sane(width)
  const h = sane(height)

  const drawer = w <= BREAKPOINTS.drawerMax

  const tier: LayoutTier = {
    drawer,
    // The width band is the whole rule: at ≤600 the window is too narrow for
    // two controls side by side, and the row gives the labels their own space.
    selectorRow: w <= BREAKPOINTS.selectorRowMax,
    // Narrow *or* short: the digits are the one thing that must never clip.
    timerSize:
      w <= BREAKPOINTS.smallMax || h <= BREAKPOINTS.timerSmallMaxHeight
        ? 's'
        : w >= BREAKPOINTS.mediumMin
          ? 'l'
          : 'm',
    scrambleChars: 60,
    scrambleMaxHeight: h <= BREAKPOINTS.shortMax ? 100 : 160,
    sidebarMax: 320, // the M2 default, still right for a normal window
    diagramMaxWidth: 440,
    diagramMaxHeight: 150,
  }

  // Tall enough for the bigger caps before any of them grow: a 1600×400 strip
  // gets a wide timer but not a 190 px diagram or a 220 px scramble slot.
  const roomy = h > BREAKPOINTS.shortMax

  if (w >= BREAKPOINTS.mediumMin) {
    tier.sidebarMax = 380
    tier.scrambleChars = 76
    if (roomy) {
      tier.diagramMaxWidth = 500
      tier.diagramMaxHeight = 170
    }
  }
  if (w >= BREAKPOINTS.largeMin) {
    tier.sidebarMax = 440
    tier.scrambleChars = 88
    if (roomy) {
      tier.diagramMaxWidth = 560
      tier.diagramMaxHeight = 190
    }
    if (h >= BREAKPOINTS.tallMin) tier.scrambleMaxHeight = 220
  }

  return tier
}

/**
 * Whether the window is in the phone form factor — tiers C and S, i.e. width
 * at or below `selectorRowMax` (user call, 2026-10-03).
 *
 * A predicate of its own rather than a field of `LayoutTier`, because the
 * nudge needs it on every frame (frame clock and sidebar toggles, which do not
 * go through `applyLayout`) and it must not drag the rest of a tier along.
 * The threshold itself is `selectorRowMax`, so the band that moves the
 * selectors out of the header and the band that changes how the timer sits are
 * the same band by construction.
 */
export function phoneFormFor(width: number): boolean {
  return sane(width) <= BREAKPOINTS.selectorRowMax
}

/** Where the timer block should sit, as the window measures it. */
export interface TimerPlacement {
  /**
   * Whether the scramble diagram is on screen — the nudge exists to balance
   * it, so with no diagram the timer stays exactly centred.
   */
  diagramVisible: boolean
  /**
   * Size of the diagram itself, as drawn. The nudge is *relative to the
   * diagram*: a quarter of it up, a quarter of it left (see `timerMargins`),
   * so a bigger picture moves the timer further and a diagram-only layout
   * never moves it.
   */
  diagramWidth: number
  diagramHeight: number
  /** Size of the content view the timer block is centred in (below the sidebar). */
  viewWidth: number
  viewHeight: number
  /**
   * Y of the top of the timer's own region, i.e. below the header *and* the
   * scramble panel. The scramble's height depends on how it wraps, so this is
   * a measurement, not a constant.
   */
  regionTop: number
  /**
   * Phone form factor (tiers C and S — `phoneFormFor`): the timer stays
   * centred horizontally and lifts by half the diagram instead of a quarter.
   * Off on a normal window, where the quarter-diagram nudge applies.
   */
  phoneForm: boolean
  /** Natural size of the timer block — what the region has to keep clear. */
  naturalWidth: number
  naturalHeight: number
}

/**
 * Room kept between the timer block and the edge of the view, on both axes,
 * so the nudge can never become the thing that makes the window's *minimum*
 * size grow (the block's natural size plus its margins is the content's
 * minimum — see the note on `timerMargins`).
 */
const NUDGE_SLACK = 16

/**
 * Margins that offset the timer block from where it would otherwise sit, or
 * `{0, 0}` when there is no diagram to step aside for.
 *
 * The block is centred in the view by default; the rule (user call,
 * 2026-10-02, halved the same day) is to move it **relative to that centred
 * position** — up by a quarter of the diagram's height, left by a quarter of
 * its width — so the offset scales with the picture rather than with the
 * window, and a diagram that grows at tier L pushes the timer further out of
 * its way.
 *
 * On a phone-form-factor window (≤600, tiers C and S — user call,
 * 2026-10-03) the sideways move is dropped entirely and the lift doubles: the
 * block stays **horizontally centred** and its centre sits **half a
 * diagram-height** up instead of a quarter. A window that narrow is barely
 * wider than the picture, so sliding left buys nothing, while the extra lift
 * is what keeps the readout clear of it. `phoneForm` on the placement is
 * that condition, decided by `phoneFormFor` from the same
 * `BREAKPOINTS.selectorRowMax` the selectors' row uses.
 *
 * GTK's box model gives the block the whole region below the scramble and
 * centres its natural height inside it; a margin shrinks the region the block
 * centres in, so the centre moves by *half* the margin. Hence the 2×: to move
 * the centre by `d`, set a margin of `2d` — offsetting up by `diagramHeight/4`
 * is a bottom margin of `diagramHeight/2` (and up by `diagramHeight/2` on a
 * phone is a bottom margin of `diagramHeight`), likewise on the end side.
 *
 * Both margins are clamped to the space that is actually spare — the timer
 * never gets squeezed below its natural size, which is the PLAN invariant that
 * the timer and the scramble cannot collide or jump (that outranks the rule).
 *
 * The slack is not decoration: a child's margins are part of its parent's
 * *minimum*, so a bottom margin of exactly `regionHeight − naturalHeight`
 * would make the content's minimum equal its current height — the window
 * could then never be made shorter (and, resized below that from outside,
 * would clip: measured, 439px of content in a 370px window). Keeping 16px of
 * headroom means the minimum always stays below the size the margins were
 * measured from, so the window can keep shrinking and the margins follow it
 * down to zero. The horizontal clamp needs it for the same reason: an end
 * margin of exactly `width − naturalWidth` would lock the window's *width*.
 */
export function timerMargins(placement: TimerPlacement): {
  marginEnd: number
  marginBottom: number
} {
  if (!placement.diagramVisible) return { marginEnd: 0, marginBottom: 0 }

  const width = sane(placement.viewWidth)
  const height = sane(placement.viewHeight)
  const regionTop = Math.min(sane(placement.regionTop), height)
  const naturalWidth = sane(placement.naturalWidth)
  const naturalHeight = sane(placement.naturalHeight)
  const diagramWidth = sane(placement.diagramWidth)
  const diagramHeight = sane(placement.diagramHeight)

  // Horizontal: normally the centre moves left by a quarter of the diagram's
  // width, and a margin moves the centre by half of itself → end margin of
  // diagramWidth/2, capped so the block keeps its slack from the view's edge.
  // In the phone form factor (≤600, tiers C and S) there is no sideways move
  // at all: the window is barely wider than the picture, so stepping left buys
  // nothing and costs the centring the narrow layout is built around.
  const roomEnd = Math.max(0, width - naturalWidth - NUDGE_SLACK)
  const marginEnd = placement.phoneForm
    ? 0
    : Math.min(diagramWidth / 2, roomEnd)

  // Vertical: normally the centre goes up by a quarter of the diagram's
  // height (bottom margin of diagramHeight/2). In the phone form factor the
  // centre goes up by *half* the diagram's height → bottom margin of
  // diagramHeight, so the readout clears the picture and sits high in the
  // remaining space. Both are capped so the block stays inside its region
  // *and* leaves the headroom that keeps the region's minimum below its
  // current height.
  const lift = placement.phoneForm ? diagramHeight : diagramHeight / 2
  const regionHeight = Math.max(0, height - regionTop)
  const marginBottom = Math.min(
    lift,
    Math.max(0, regionHeight - naturalHeight - NUDGE_SLACK),
  )

  return { marginEnd, marginBottom }
}
