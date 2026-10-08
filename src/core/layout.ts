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
 * One job:
 *
 *   layoutFor(width, height)     which *tier* the window is in: sidebar as a
 *                                drawer or side by side, the scramble
 *                                selectors in the header or in their own row,
 *                                how big the timer / scramble / diagram get,
 *                                how wide the sidebar may grow.
 *
 * (The timer used to get offset aside for the diagram — `timerMargins` and
 * the phone-form `phoneFormFor` predicate lived here. Dropped 2026-10-05:
 * the timer stays centred at all times, user call.)
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
   * What used to hold this number up is gone: the selector was two
   * Gtk.DropDowns wanting ~282px between them, and is now one ellipsizing
   * button that moves into ToolbarView's bottom bar at ≤600. The floor is
   * therefore the ToolbarView bars plus the tier-S content, which fit inside
   * 350 (measured — see PLAN §7).
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
 * header's selector is now an icon button and the type text lives in the
 * window title, whose `Adw.WindowTitle` template labels ellipsize (see
 * src/ui/scrambleTypeButton.ts and src/ui/scrambleTypeTitle.ts), so the
 * header's *min* stays small, it absorbs
 * whatever it is given, and the labels have a place to go (user calls,
 * 2026-10-04, 2026-10-08).
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
