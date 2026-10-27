/*
 * layout.ts — the adaptive-layout rules, as pure functions.
 *
 * Architecture rule (see AGENTS.md): pure TypeScript — no `gi:*`, no Node
 * APIs. The *window* measures itself — `Adw.Breakpoint::apply`/`unapply` and
 * `Gdk.Surface::layout`, both wired up in src/main.ts — and hands the numbers
 * to this module; what the UI has to do about them is decided here, where it
 * can be unit tested. Nothing outside this file may hold a threshold, so the
 * breakpoints in main.ts and the tiers they select cannot drift apart.
 *
 * One job:
 *
 *   layoutFor(width, height)     which *tier* the window is in: sidebar as a
 *                                drawer or side by side, the scramble
 *                                selectors in the header or in their own row,
 *                                how big the timer / scramble / diagram get.
 *
 *   layoutFor(width, height,     the same, with the content area's allocation
 *             mainContent)       deciding whether the diagram has room beside
 *                                the timer or below it, and how much the
 *                                docked sidebar shifts that balance.
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
  /**
   * 481–540 → tier C: the selectors leave the header for their own row.
   * 540 also drives the type picker's collapse breakpoint
   * (scrambleTypePicker.ts): it puts a phone in landscape — its dialog wider
   * than 540 — on the picker's two-column side.
   */
  selectorRowMax: 540,
  /** 541–800 → tier B: the sidebar becomes an overlay drawer. */
  drawerMax: 800,
  /** 1200–1599 → tier M: the timer steps up and the scramble slot widens. */
  mediumMin: 1200,
  /** ≥ 1600 → tier L: everything takes the room it is given. */
  largeMin: 1600,
  /**
   * Height ≤ 580 → the scramble slot gives height back to the timer. Kept
   * below a 360×590 phone's content height so that phone keeps the diagram.
   */
  shortMax: 580,
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
   * `minHeight`): below either, no tier could keep the layout deliberate.
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
   * What fits inside: the `ToolbarView` bars plus the tier-S content were
   * measured to fit in 350 (PLAN §7). The request can only *add* to that —
   * the content's own minimum still holds the window higher if it needs to.
   */
  minWidth: 360,
  minHeight: 294,
} as const

/**
 * Width of the drawer's edge-swipe target, in logical px. It matches
 * libadwaita's `ADW_SWIPE_BORDER`, which `Adw.OverlaySplitView` uses while the
 * drawer is closed. The timer's touch gesture must not arm inside it: that
 * swipe belongs to the drawer.
 */
export const DRAWER_EDGE_PX = 32

/**
 * Whether a press at `x` falls in the drawer's edge-swipe target. The caller
 * only uses this while the drawer is closed; `sidebarAtStart` is the split
 * view's logical sidebar position, and `rtl` flips which physical edge that
 * is.
 */
export function isDrawerEdgePress(
  x: number,
  width: number,
  sidebarAtStart: boolean,
  rtl: boolean,
): boolean {
  if (width <= 0) return false
  const edgeOnLeft = sidebarAtStart !== rtl
  return edgeOnLeft ? x < DRAWER_EDGE_PX : x > width - DRAWER_EDGE_PX
}

/** Timer readout size class (src/ui/timerLabel.ts styles `.size-*`). */
export type TimerSize = 's' | 'm' | 'l'

/** How the timer and the scramble diagram share the lower area. */
export type DiagramPlacement = 'wide' | 'tall-narrow' | 'none'

/**
 * Widest the picture may be beside the timer in the wide layout. The dock
 * gets its own column, so this keeps that column compact and leaves the rest
 * of the width to the timer.
 */
const DIAGRAM_SIDE_MAX_WIDTH = 180

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
  /**
   * `maxSidebarWidth` — the sidebar's cap; the same 320 at every tier.
   */
  sidebarMax: number
  /** Where the diagram sits, or `none` when this tier has no room for it. */
  diagramPlacement: DiagramPlacement
  /**
   * Diagram cap, px — the picture is scaled to fit before it is shown. Zero
   * means the tier has no corner for it and it is not drawn at all.
   */
  diagramMaxWidth: number
  diagramMaxHeight: number
}

/** Non-finite measurements must not decide a tier. */
const sane = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0)

/**
 * The tier for a window size (logical px), with the measured content area when
 * it is available. Called on every resize and from every breakpoint handler,
 * so it must stay cheap and total: same inputs, same output, no matter which
 * one asked.
 *
 * The width bands decide the sidebar, the selector row, the timer tier and
 * the scramble width; height decides the short-window caps. The diagram
 * placement is the one rule that also reads the content area's aspect and
 * whether the sidebar is docked. Long
 * labels are not a factor: the header's selector is an icon button and the
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
): LayoutTier {
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

  const drawer = w <= BREAKPOINTS.drawerMax

  const tier: LayoutTier = {
    drawer,
    // The width band is the whole rule: at ≤540 the window is too narrow for
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
    sidebarMax: 320, // pinned at every tier
    diagramPlacement: 'tall-narrow',
    diagramMaxWidth: 440,
    diagramMaxHeight: 150,
  }

  // Tall enough for the bigger caps before any of them grow: a 1600×400 strip
  // gets a wide timer but not a 190 px diagram or a 220 px scramble slot.
  const roomy = h > BREAKPOINTS.shortMax

  if (w >= BREAKPOINTS.mediumMin) {
    tier.scrambleChars = 76
    if (roomy) {
      tier.diagramMaxWidth = 500
      tier.diagramMaxHeight = 170
    }
  }
  if (w >= BREAKPOINTS.largeMin) {
    tier.scrambleChars = 88
    if (roomy) {
      tier.diagramMaxWidth = 560
      tier.diagramMaxHeight = 190
    }
    if (h >= BREAKPOINTS.tallMin) tier.scrambleMaxHeight = 220
  }

  // The width band decides whether the window is narrow enough to stack at
  // all; above it, the content area's aspect decides whether the timer and
  // diagram have room side by side. A portrait tablet is wide in window terms
  // (800 > 540) but its content is tall, so the timer gets a full-width row.
  // The sidebar's own width is part of that decision: a docked sidebar moves
  // the content right, so the same content aspect can be balanced while wide.
  if (w <= BREAKPOINTS.selectorRowMax) {
    tier.diagramPlacement = h <= BREAKPOINTS.shortMax ? 'none' : 'tall-narrow'
  } else {
    tier.diagramPlacement =
      contentWidth >= contentHeight * wideRatio ? 'wide' : 'tall-narrow'
  }
  if (tier.diagramPlacement === 'wide') {
    tier.diagramMaxWidth = Math.min(tier.diagramMaxWidth, DIAGRAM_SIDE_MAX_WIDTH)
  } else if (tier.diagramPlacement === 'none') {
    tier.diagramMaxWidth = 0
    tier.diagramMaxHeight = 0
  }

  return tier
}
