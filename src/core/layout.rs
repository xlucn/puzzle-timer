//! The adaptive-layout rules, as pure functions.
//!
//! The *window* measures itself — `Adw.Breakpoint` apply/unapply and
//! `Gdk.Surface::layout`, both wired up in `src/ui/` — and hands the numbers to
//! this module; what the UI has to do about them is decided here, where it can
//! be unit tested. Nothing outside this file may hold a threshold, so the
//! breakpoints and the decisions they select cannot drift apart.
//!
//! One job: [`layout_for`] turns a window size into everything the UI does for
//! it — the sidebar as a drawer or side by side, the scramble selectors in the
//! header or in their own row, the readout / scramble / diagram sizes, and
//! where the diagram sits.
//!
//! Units are **logical px** everywhere: GTK lays out in logical px and the
//! compositor scales them up, so these numbers match `setDefaultSize`,
//! `minSidebarWidth`, and the sizes the widgets report.

/// Every size threshold the layout reacts to, in logical px, in one place.
///
/// **These are layout thresholds only.** The presentation sizes — the readout,
/// the scramble slot, the diagram — are continuous functions of the window, so
/// there is no size tier to select. What is left are the two decisions that
/// change *structure*: the selectors moving to their own row, and the sidebar
/// becoming a drawer.
///
/// Those two bands are **mutually exclusive on purpose**. libadwaita keeps a
/// single current breakpoint ("if multiple breakpoints can be used for the
/// current size, the last one is always picked"), so overlapping conditions
/// would starve each other and a resize could leave a decision unapplied.
/// Disjoint bands mean every crossing of a boundary changes the current
/// breakpoint, i.e. always fires apply/unapply.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Breakpoints {
    /// ≤ 540 → the scramble selectors leave the header for their own row.
    /// 540 also drives the type picker's collapse breakpoint: it puts a phone
    /// in landscape — its dialog wider than 540 — on the picker's two-column
    /// side.
    pub selector_row_max: f64,
    /// 541–800 → the sidebar becomes an overlay drawer.
    pub drawer_max: f64,
    /// Height ≤ 580 on a narrow window → the diagram has no room and is shed.
    /// Kept below a 360×590 phone's content height so that phone keeps it.
    pub short_max: f64,
    /// `minSidebarWidth` — the sidebar's share of a side-by-side window, which
    /// is what the header does *not* have.
    pub sidebar_min: f64,
    /// The window refuses to be dragged narrower than this (and shorter than
    /// `min_height`): below either, the layout could not stay deliberate.
    ///
    /// **360×294 is the GNOME HIG's smallest phone-form-factor window.** The
    /// height is 294 rather than a square 360 because that is the height a
    /// phone in landscape gives an app.
    pub min_width: f64,
    pub min_height: f64,
}

pub const BREAKPOINTS: Breakpoints = Breakpoints {
    selector_row_max: 540.0,
    drawer_max: 800.0,
    short_max: 580.0,
    sidebar_min: 240.0,
    min_width: 360.0,
    min_height: 294.0,
};

/// How far the timer's start target is inset from the window edges, in logical
/// px. libadwaita's drawer swipe strip is 32 px wide, so this leaves its outer
/// half to the swipe and gives the inner half to the timer: a press inside the
/// card claims the sequence, and a drawer swipe can only start in the strip
/// outside it. A 32 px inset would hand the whole strip to the drawer.
pub const START_AREA_INSET_PX: f64 = 16.0;

/// How the timer and the scramble diagram share the lower area.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiagramPlacement {
    Wide,
    TallNarrow,
    None,
}

// The readout's size, in logical px, before the user's scale:
//
//   size = base × (width / at) ^ growth, clamped by the window's height and
//          then into [min, max]
//
// `96 at 900` keeps the size the default window has always had. `growth 0.55`
// makes 4× the width give ~2.2× the size, so a 4K window gets a readout that
// fills it without the blow-up of a linear rule. The height term is what keeps
// a short window from asking for a readout it cannot show — no second
// threshold needed.
const READOUT_BASE: f64 = 96.0;
const READOUT_AT: f64 = 900.0;
const READOUT_GROWTH: f64 = 0.55;
/// Never more than this share of the window's height.
const READOUT_OF_HEIGHT: f64 = 0.22;
const READOUT_MIN: f64 = 72.0;
const READOUT_MAX: f64 = 224.0;

/// The scramble text's size at the default window, in logical px.
pub const SCRAMBLE_PX: f64 = 18.0;

// The scramble text is a share of the readout, so one curve sizes both: 18 px
// where the readout is 96, and proportionally above that. Below 96 the share
// alone would take it to 13.5 px on a phone, so it is floored at 18 px.
const SCRAMBLE_OF_READOUT: f64 = SCRAMBLE_PX / READOUT_BASE;
const SCRAMBLE_MIN: f64 = SCRAMBLE_PX;

/// The scramble text's *request* cap, in characters: it bounds the label's
/// natural width so a 3000-character relay cannot drag the window wider than
/// the screen. The user's text scale divides it.
const SCRAMBLE_CHARS: f64 = 60.0;

/// How much of the window's height the scramble slot may take.
const SCRAMBLE_SLOT_OF_HEIGHT: f64 = 0.25;
const SCRAMBLE_SLOT_MIN: f64 = 90.0;
const SCRAMBLE_SLOT_MAX: f64 = 240.0;

// The diagram's box, in logical px. Both dimensions follow the window's linear
// size — √(width × height), so a portrait and a landscape window of the same
// area get the same picture — and neither is capped. The height is a share of
// that size; the width is the height times the widest diagram shape (csTimer's
// widest canvas is ~2.1:1).
/// Share of the window's linear size (√area), never below `min`.
const DIAGRAM_OF_SIZE: f64 = 0.3;
/// The widest diagram the box must fit without clipping the picture.
const DIAGRAM_ASPECT: f64 = 2.1;
const DIAGRAM_MIN: f64 = 90.0;
/// Height share that only binds on windows more than 2.25:1.
const DIAGRAM_MAX_OF_HEIGHT: f64 = 0.45;
/// The readout's own width in em — four digits at the tabular figures'
/// advance (`0.00`) — which the picture may not take from it beside the timer.
const DIAGRAM_READOUT_RESERVE: f64 = 2.5;
/// The box's own end margin, which its size request does not carry.
const DIAGRAM_BOX_INSET: f64 = 16.0;
/// Room for the panel's own margins when it may use the content width.
const DIAGRAM_STACKED_INSET: f64 = 48.0;

/// The user's three size multipliers. Each one scales an output of this module
/// and nothing else: the curve decides *what size* a window gets, the
/// preference decides how much of it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SizeScales {
    pub timer: f64,
    pub scramble: f64,
    pub diagram: f64,
}

/// The curve's own sizes, untouched — the default for every caller.
pub const UNIT_SCALES: SizeScales = SizeScales {
    timer: 1.0,
    scramble: 1.0,
    diagram: 1.0,
};

// Wide layout thresholds, as content width / content height. The sidebar
// changes where the timer sits in the window, so the ratio changes with it.
//
// Hidden, the diagram's column pushes the timer about half a diagram left of
// centre, so wide waits for clearly landscape content. Docked, the sidebar
// pushes the content right by roughly the same amount, the timer stays near
// the window centre, and wide can tolerate taller content.
//
// The pair also has to survive the 240 px sidebar docking at 801: the shown
// ratio must stay at or below 561/800 of the hidden ratio, or a wide layout
// just before the dock collapses just after it.
const WIDE_RATIO_HIDDEN: f64 = 1.4;
const WIDE_RATIO_SHOWN: f64 = 0.7;

/// The content area between the toolbar bars, in logical px.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ContentSize {
    pub width: f64,
    pub height: f64,
    /// Width the docked sidebar takes from the window. Zero while the sidebar
    /// overlays the content, is hidden, or has not allocated yet.
    pub sidebar_width: f64,
}

impl ContentSize {
    pub fn new(width: f64, height: f64) -> Self {
        Self {
            width,
            height,
            sidebar_width: 0.0,
        }
    }

    pub fn with_sidebar(width: f64, height: f64, sidebar_width: f64) -> Self {
        Self {
            width,
            height,
            sidebar_width,
        }
    }
}

/// Everything the UI does for a window size, decided in one call. Sizes are
/// logical px; the UI rounds to `i32` where a widget needs one.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LayoutPlan {
    /// Sidebar overlays the content instead of sharing the width with it.
    pub drawer: bool,
    /// The scramble selectors are packed into a second row under the header —
    /// at `selector_row_max` and below, and for no other reason.
    pub selector_row: bool,
    /// The readout's font size: the curve, then the user's scale.
    pub timer_px: f64,
    /// `maxWidthChars` for the scramble text — its *request* cap, in chars.
    pub scramble_chars: i64,
    /// The scramble text's font size: the base, then the user's scale.
    pub scramble_px: f64,
    /// `maxContentHeight` of the scramble slot.
    pub scramble_max_height: f64,
    /// `maxSidebarWidth` — the sidebar's cap; the same 320 at every width.
    pub sidebar_max: f64,
    /// Where the diagram sits, or `None` when this window has no room for it.
    pub diagram_placement: DiagramPlacement,
    /// The diagram box's cap: the box is pinned to this and the picture fits
    /// inside it. Zero means the window has no corner for it.
    pub diagram_max_width: f64,
    pub diagram_max_height: f64,
}

/// Non-finite measurements must not decide a layout.
fn sane(value: f64) -> f64 {
    if value.is_finite() {
        value.max(0.0)
    } else {
        0.0
    }
}

/// A size that cannot mean anything (a bad scale) is "unchanged".
fn multiplier(value: f64) -> f64 {
    if value.is_finite() && value > 0.0 {
        value
    } else {
        1.0
    }
}

/// Keep a computed size inside a designed range.
fn within(value: f64, min: f64, max: f64) -> f64 {
    value.clamp(min, max)
}

/// The readout's size for a window, before the user's scale: the curve,
/// clamped by the height and the hard floor. Width grows it, height caps it,
/// and the floor wins at the small end.
fn readout_px(width: f64, height: f64) -> f64 {
    let by_width = READOUT_BASE * (width / READOUT_AT).powf(READOUT_GROWTH);
    by_width
        .min(height * READOUT_OF_HEIGHT)
        .clamp(READOUT_MIN, READOUT_MAX)
}

/// The layout for a window size (logical px), with the measured content area
/// when it is available and the user's size multipliers on top. Called on every
/// resize and from every breakpoint handler, so it must stay cheap and total:
/// same inputs, same output, no matter which one asked.
///
/// Only two things here are discrete: the sidebar's drawer/side-by-side state
/// and the selectors' row. Everything else — the readout, the scramble slot,
/// the diagram's box — follows the window continuously. The user's scales are
/// applied last: they never touch a band, a ratio or the placement.
pub fn layout_for(
    width: f64,
    height: f64,
    main_content: Option<ContentSize>,
    sizes: SizeScales,
) -> LayoutPlan {
    let w = sane(width);
    let h = sane(height);
    let measured_width = sane(main_content.map_or(0.0, |content| content.width));
    let measured_height = sane(main_content.map_or(0.0, |content| content.height));
    let has_content = measured_width > 0.0 && measured_height > 0.0;
    let sidebar_docked = sane(main_content.map_or(0.0, |content| content.sidebar_width)) > 0.0;
    let wide_ratio = if sidebar_docked {
        WIDE_RATIO_SHOWN
    } else {
        WIDE_RATIO_HIDDEN
    };
    // Hidden, the content spans the window, so use the window width: the
    // measured one still carries the shrunken width of a sidebar that is
    // collapsing. Docked, the measured width is the real content width.
    let content_width = if sidebar_docked && has_content {
        measured_width
    } else {
        w
    };
    let content_height = if has_content { measured_height } else { h };

    let timer_scale = multiplier(sizes.timer);
    let scramble_scale = multiplier(sizes.scramble);
    let diagram_scale = multiplier(sizes.diagram);

    // The width band decides whether the window is narrow enough to stack at
    // all; above it, the content area's aspect decides whether the timer and
    // diagram have room side by side.
    let diagram_placement = if w <= BREAKPOINTS.selector_row_max {
        if h <= BREAKPOINTS.short_max {
            DiagramPlacement::None
        } else {
            DiagramPlacement::TallNarrow
        }
    } else if content_width >= content_height * wide_ratio {
        DiagramPlacement::Wide
    } else {
        DiagramPlacement::TallNarrow
    };

    // The picture's box follows the window's linear size — the square root of
    // its area — so a portrait and a landscape window of the same area get the
    // same picture. Only a window far wider than it is tall (past 2.25:1) is
    // clamped by its height.
    let readout = readout_px(w, h);
    let timer_px = (readout * timer_scale).round();
    let diagram_box_height = (w * h)
        .sqrt()
        .mul_add(DIAGRAM_OF_SIZE, 0.0)
        .max(DIAGRAM_MIN)
        .min(h * DIAGRAM_MAX_OF_HEIGHT);
    let diagram_box_width = diagram_box_height * DIAGRAM_ASPECT;
    // The box only takes room nothing else claims: beside the timer it leaves
    // the readout its own width, the split view's room for a docked sidebar and
    // its own end margin; stacked it stays inside the content's margins.
    let wide_room = if w > BREAKPOINTS.drawer_max {
        w - BREAKPOINTS.sidebar_min
    } else {
        w
    } - timer_px * DIAGRAM_READOUT_RESERVE
        - DIAGRAM_BOX_INSET;
    let diagram_room = if diagram_placement == DiagramPlacement::Wide {
        wide_room
    } else {
        content_width - DIAGRAM_STACKED_INSET
    };
    let diagram_height = (diagram_box_height * diagram_scale).round();
    let diagram_width = if diagram_placement == DiagramPlacement::None {
        0.0
    } else {
        (diagram_box_width.min(diagram_room.max(1.0)) * diagram_scale).round()
    };

    // One curve, two readouts: the scramble text follows the timer's size but
    // never drops below the size it had before the curve.
    let scramble_size = (readout * SCRAMBLE_OF_READOUT).max(SCRAMBLE_MIN);

    LayoutPlan {
        // The width band is the whole rule: at ≤540 the window is too narrow
        // for two controls side by side, and the row gives the labels their
        // own space.
        drawer: w <= BREAKPOINTS.drawer_max,
        selector_row: w <= BREAKPOINTS.selector_row_max,
        timer_px,
        // A bigger font fits fewer characters in the same width; the slot's
        // cap grows because the same lines are taller.
        scramble_chars: (SCRAMBLE_CHARS / scramble_scale).round().max(1.0) as i64,
        scramble_px: (scramble_size * scramble_scale * 100.0).round() / 100.0,
        scramble_max_height: within(
            h * SCRAMBLE_SLOT_OF_HEIGHT,
            SCRAMBLE_SLOT_MIN,
            SCRAMBLE_SLOT_MAX,
        )
        .mul_add(scramble_scale, 0.0)
        .round(),
        sidebar_max: 320.0, // pinned at every width
        diagram_placement,
        diagram_max_width: if diagram_placement == DiagramPlacement::None {
            0.0
        } else {
            diagram_width
        },
        diagram_max_height: if diagram_placement == DiagramPlacement::None {
            0.0
        } else {
            diagram_height
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scales(patch: SizeScales) -> SizeScales {
        patch
    }

    fn plan(width: f64, height: f64) -> LayoutPlan {
        layout_for(width, height, None, UNIT_SCALES)
    }

    #[test]
    fn makes_the_sidebar_a_drawer_only_while_the_header_would_starve() {
        assert!(plan(BREAKPOINTS.drawer_max, 540.0).drawer);
        assert!(!plan(BREAKPOINTS.drawer_max + 1.0, 540.0).drawer);
        assert!(!plan(900.0, 540.0).drawer); // the default window
    }

    #[test]
    fn keeps_the_selectors_in_the_header_until_the_window_is_small() {
        assert!(plan(BREAKPOINTS.selector_row_max, 540.0).selector_row);
        assert!(!plan(BREAKPOINTS.selector_row_max + 1.0, 540.0).selector_row);
        // …and every window small enough for the second row is also a drawer.
        assert!(plan(400.0, 540.0).selector_row);
        assert!(plan(400.0, 540.0).drawer);
    }

    #[test]
    fn pins_the_sidebar_at_320_at_every_width() {
        for (w, h) in [
            (400.0, 540.0),
            (1199.0, 800.0),
            (1200.0, 800.0),
            (1600.0, 800.0),
            (3000.0, 1600.0),
        ] {
            assert_eq!(plan(w, h).sidebar_max, 320.0);
        }
    }

    #[test]
    fn is_total_measurements_that_make_no_sense_select_a_layout() {
        assert!(plan(f64::NAN, f64::INFINITY).drawer);
        assert_eq!(plan(-50.0, -50.0).timer_px, 72.0);
        assert_eq!(plan(0.0, 0.0).scramble_max_height, 90.0);
    }

    #[test]
    fn keeps_the_readout_at_its_hard_floor_where_digits_could_clip() {
        // 360×294 is the window floor; 72 is the size it was measured at.
        assert_eq!(plan(360.0, 294.0).timer_px, 72.0);
        assert_eq!(plan(480.0, 700.0).timer_px, 72.0);
        assert_eq!(plan(1600.0, 294.0).timer_px, 72.0);
    }

    #[test]
    fn keeps_the_96_px_the_default_window_has_always_had() {
        assert_eq!(plan(900.0, 540.0).timer_px, 96.0);
    }

    #[test]
    fn grows_with_the_width_and_stops_at_the_cap() {
        let at = |w: f64| plan(w, 1200.0).timer_px;
        assert!(at(1200.0) > at(900.0));
        assert!(at(1600.0) > at(1200.0));
        assert!(at(2560.0) > at(1600.0));
        assert_eq!(plan(5000.0, 2000.0).timer_px, 224.0);
    }

    #[test]
    fn is_monotone_no_window_is_smaller_than_a_narrower_one() {
        let mut w = 360.0;
        while w < 3840.0 {
            assert!(plan(w + 1.0, 900.0).timer_px >= plan(w, 900.0).timer_px);
            w += 7.0;
        }
    }

    #[test]
    fn lets_the_height_cap_win_on_a_short_window() {
        assert_eq!(plan(1600.0, 400.0).timer_px, (400.0_f64 * 0.22).round());
        assert!(plan(1600.0, 400.0).timer_px < plan(1600.0, 900.0).timer_px);
    }

    #[test]
    fn floors_the_scramble_text_at_the_size_it_had_before_the_curve() {
        assert_eq!(plan(900.0, 540.0).scramble_px, 18.0);
        assert_eq!(plan(360.0, 294.0).scramble_px, 18.0);
        assert_eq!(plan(1600.0, 400.0).scramble_px, 18.0);
        for w in [400.0, 540.0, 700.0, 860.0] {
            assert_eq!(plan(w, 900.0).scramble_px, 18.0, "{w}");
        }
        let at = |w: f64| plan(w, 900.0).scramble_px;
        assert!(at(1600.0) > at(900.0));
        assert!(at(2560.0) > at(1600.0));
        let huge = plan(3840.0, 2160.0);
        assert!((huge.scramble_px - huge.timer_px * (18.0 / 96.0)).abs() < 0.5);
    }

    #[test]
    fn gives_the_scramble_slot_a_share_of_the_height_clamped() {
        assert_eq!(plan(900.0, 294.0).scramble_max_height, 90.0);
        assert_eq!(
            plan(900.0, 540.0).scramble_max_height,
            (540.0_f64 * 0.25).round()
        );
        assert_eq!(plan(900.0, 1440.0).scramble_max_height, 240.0);
        assert_eq!(plan(900.0, 900.0).scramble_chars, 60);
    }

    #[test]
    fn scales_the_diagram_with_the_room_and_sheds_it_where_there_is_none() {
        // Both dimensions follow the window's linear size, √(w × h).
        assert_eq!(plan(900.0, 540.0).diagram_max_height, 209.0);
        assert_eq!(plan(900.0, 540.0).diagram_max_width, 404.0);
        assert_eq!(plan(1600.0, 900.0).diagram_max_height, 360.0);
        assert_eq!(plan(1600.0, 900.0).diagram_max_width, 756.0);
        // Stacked under the timer, the content width is the limit.
        assert_eq!(plan(360.0, 700.0).diagram_max_width, 312.0);
        assert_eq!(plan(360.0, 700.0).diagram_max_height, 151.0);
        // A narrow, short window still sheds it entirely.
        assert_eq!(plan(360.0, 294.0).diagram_placement, DiagramPlacement::None);
        assert_eq!(plan(360.0, BREAKPOINTS.short_max).diagram_max_width, 0.0);
    }

    #[test]
    fn uses_one_row_and_two_columns_on_every_wide_window() {
        for (w, h) in [
            (BREAKPOINTS.selector_row_max + 1.0, 360.0),
            (640.0, 360.0),
            (900.0, BREAKPOINTS.short_max),
            (900.0, BREAKPOINTS.short_max + 1.0),
            (1600.0, 900.0),
        ] {
            assert_eq!(
                plan(w, h).diagram_placement,
                DiagramPlacement::Wide,
                "{w}×{h}"
            );
        }
    }

    #[test]
    fn stacks_the_rows_on_a_narrow_tall_window() {
        assert_eq!(
            plan(BREAKPOINTS.selector_row_max, BREAKPOINTS.short_max + 1.0).diagram_placement,
            DiagramPlacement::TallNarrow
        );
        assert_eq!(
            plan(360.0, 590.0).diagram_placement,
            DiagramPlacement::TallNarrow
        );
        assert_eq!(
            plan(360.0, 700.0).diagram_placement,
            DiagramPlacement::TallNarrow
        );
    }

    #[test]
    fn stacks_a_wide_window_when_its_content_area_is_taller_than_wide() {
        for content in [
            ContentSize::new(790.0, 1240.0),
            ContentSize::new(1010.0, 1300.0),
            ContentSize::new(790.0, 940.0),
        ] {
            assert_eq!(
                layout_for(800.0, 1280.0, Some(content), UNIT_SCALES).diagram_placement,
                DiagramPlacement::TallNarrow
            );
        }
    }

    #[test]
    fn keeps_a_square_content_area_stacked_while_the_sidebar_is_hidden() {
        assert_eq!(
            layout_for(
                790.0,
                1000.0,
                Some(ContentSize::new(790.0, 790.0)),
                UNIT_SCALES
            )
            .diagram_placement,
            DiagramPlacement::TallNarrow
        );
    }

    #[test]
    fn falls_back_to_the_window_aspect_before_the_content_is_allocated() {
        assert_eq!(
            plan(800.0, 1280.0).diagram_placement,
            DiagramPlacement::TallNarrow
        );
        assert_eq!(
            plan(1280.0, 800.0).diagram_placement,
            DiagramPlacement::Wide
        );
        assert_eq!(
            layout_for(800.0, 1280.0, Some(ContentSize::new(0.0, 0.0)), UNIT_SCALES)
                .diagram_placement,
            DiagramPlacement::TallNarrow
        );
    }

    #[test]
    fn sheds_the_diagram_on_a_narrow_short_window() {
        for (w, h) in [
            (360.0, 294.0),
            (360.0, 360.0),
            (BREAKPOINTS.selector_row_max, 360.0),
            (BREAKPOINTS.selector_row_max, BREAKPOINTS.short_max),
        ] {
            let plan = plan(w, h);
            assert_eq!(plan.diagram_placement, DiagramPlacement::None);
            assert_eq!(
                [plan.diagram_max_width, plan.diagram_max_height],
                [0.0, 0.0]
            );
        }
    }

    #[test]
    fn scales_the_box_with_the_window_instead_of_a_fixed_cap() {
        assert_eq!(plan(640.0, 360.0).diagram_max_width, 302.0);
        assert_eq!(plan(640.0, 360.0).diagram_max_height, 144.0);
        assert_eq!(plan(800.0, 540.0).diagram_max_height, 197.0);
        assert_eq!(plan(800.0, 540.0).diagram_max_width, 414.0);
        assert_eq!(plan(1600.0, 500.0).diagram_max_width, 473.0);
        assert_eq!(plan(1600.0, 500.0).diagram_max_height, 225.0);
        assert_eq!(plan(360.0, 700.0).diagram_max_width, 312.0);
        assert_eq!(plan(1600.0, 900.0).diagram_max_width, 756.0);
    }

    #[test]
    fn sizes_the_box_from_the_window_area_so_rotating_keeps_it() {
        let landscape = plan(640.0, 360.0);
        let portrait = plan(360.0, 640.0);
        assert_eq!(landscape.diagram_max_height, 144.0);
        assert_eq!(portrait.diagram_max_height, 144.0);
        assert_eq!(landscape.diagram_max_width, portrait.diagram_max_width);
        assert_eq!(
            plan(1600.0, 900.0).diagram_max_height,
            plan(900.0, 1600.0).diagram_max_height
        );
        // Growing the window either way never shrinks it — including across
        // the wide/stacked boundary.
        let stacked = plan(755.0, 700.0);
        let wide = plan(1000.0, 700.0);
        assert_eq!(stacked.diagram_placement, DiagramPlacement::TallNarrow);
        assert_eq!(wide.diagram_placement, DiagramPlacement::Wide);
        assert!(wide.diagram_max_height >= stacked.diagram_max_height);
        assert!(plan(900.0, 700.0).diagram_max_height > plan(900.0, 540.0).diagram_max_height);
        assert!(plan(900.0, 700.0).diagram_max_width > plan(900.0, 540.0).diagram_max_width);
    }

    #[test]
    fn holds_the_box_back_only_on_a_window_far_wider_than_it_is_tall() {
        let short = plan(1920.0, 360.0);
        assert_eq!(short.diagram_placement, DiagramPlacement::Wide);
        assert_eq!(short.diagram_max_height, (360.0_f64 * 0.45).round());
        assert_eq!(plan(640.0, 360.0).diagram_max_height, 144.0);
    }

    #[test]
    fn keeps_growing_on_a_very_large_window() {
        let big = plan(3840.0, 2160.0);
        assert_eq!(big.diagram_placement, DiagramPlacement::Wide);
        assert_eq!(big.diagram_max_height, 864.0);
        assert_eq!(big.diagram_max_width, 1814.0);
    }

    #[test]
    fn clamps_the_stacked_width_to_the_content_it_has() {
        let stacked = plan(800.0, 1280.0);
        assert_eq!(stacked.diagram_placement, DiagramPlacement::TallNarrow);
        assert_eq!(stacked.diagram_max_height, 304.0);
        assert_eq!(stacked.diagram_max_width, 638.0);
        assert_eq!(plan(360.0, 700.0).diagram_max_width, 360.0 - 48.0);
    }

    #[test]
    fn leaves_the_readout_and_the_docked_sidebar_their_room() {
        let plan = layout_for(
            890.0,
            530.0,
            Some(ContentSize::new(680.0, 484.0)),
            UNIT_SCALES,
        );
        assert_eq!(plan.diagram_placement, DiagramPlacement::Wide);
        assert_eq!(plan.timer_px, 95.0);
        assert_eq!(plan.diagram_max_height, 206.0);
        assert_eq!(plan.diagram_max_width, 397.0);
        assert_eq!(
            layout_for(
                1280.0,
                800.0,
                Some(ContentSize::new(953.0, 744.0)),
                UNIT_SCALES
            )
            .diagram_max_width,
            638.0
        );
    }

    #[test]
    fn requires_more_width_when_the_sidebar_is_hidden() {
        assert_eq!(
            layout_for(
                800.0,
                800.0,
                Some(ContentSize::with_sidebar(800.0, 600.0, 0.0)),
                UNIT_SCALES,
            )
            .diagram_placement,
            DiagramPlacement::TallNarrow // 800 < 1.4 × 600
        );
        assert_eq!(
            layout_for(
                840.0,
                800.0,
                Some(ContentSize::with_sidebar(840.0, 600.0, 0.0)),
                UNIT_SCALES,
            )
            .diagram_placement,
            DiagramPlacement::Wide // 840 = 1.4 × 600
        );
    }

    #[test]
    fn allows_a_taller_content_area_once_the_sidebar_is_docked() {
        assert_eq!(
            layout_for(
                801.0,
                694.0,
                Some(ContentSize::with_sidebar(561.0, 648.0, 240.0)),
                UNIT_SCALES,
            )
            .diagram_placement,
            DiagramPlacement::Wide
        );
        assert_eq!(
            layout_for(
                801.0,
                694.0,
                Some(ContentSize::with_sidebar(561.0, 648.0, 0.0)),
                UNIT_SCALES,
            )
            .diagram_placement,
            DiagramPlacement::TallNarrow
        );
    }

    #[test]
    fn reads_the_measured_gap_not_the_show_sidebar_flag() {
        // At 801 the breakpoint has applied but the sidebar has not allocated.
        assert_eq!(
            layout_for(
                801.0,
                694.0,
                Some(ContentSize::with_sidebar(800.0, 648.0, 0.0)),
                UNIT_SCALES,
            )
            .diagram_placement,
            DiagramPlacement::TallNarrow
        );
        assert_eq!(
            layout_for(
                801.0,
                694.0,
                Some(ContentSize::with_sidebar(561.0, 648.0, 240.0)),
                UNIT_SCALES,
            )
            .diagram_placement,
            DiagramPlacement::Wide
        );
    }

    #[test]
    fn uses_the_window_width_while_a_collapsing_sidebar_is_still_allocated() {
        assert_eq!(
            layout_for(
                800.0,
                608.0,
                Some(ContentSize::with_sidebar(560.0, 562.0, 0.0)),
                UNIT_SCALES,
            )
            .diagram_placement,
            DiagramPlacement::Wide
        );
    }

    #[test]
    fn never_flips_wide_to_tall_when_the_sidebar_docks_at_801() {
        let mut height = 500.0;
        while height <= 800.0 {
            let hidden = layout_for(
                800.0,
                height + 46.0,
                Some(ContentSize::with_sidebar(800.0, height, 0.0)),
                UNIT_SCALES,
            );
            if hidden.diagram_placement == DiagramPlacement::Wide {
                let docked = layout_for(
                    801.0,
                    height + 46.0,
                    Some(ContentSize::with_sidebar(561.0, height, 240.0)),
                    UNIT_SCALES,
                );
                assert_eq!(
                    docked.diagram_placement,
                    DiagramPlacement::Wide,
                    "content height {height}"
                );
            }
            height += 1.0;
        }
    }

    #[test]
    fn keeps_the_wide_layout_across_the_dock_for_the_heights_that_used_to_flip() {
        for height in [562.0, 648.0, 800.0] {
            let docked = layout_for(
                801.0,
                height + 46.0,
                Some(ContentSize::with_sidebar(561.0, height, 240.0)),
                UNIT_SCALES,
            );
            assert_eq!(
                docked.diagram_placement,
                DiagramPlacement::Wide,
                "content height {height}"
            );
        }
    }

    #[test]
    fn follows_the_width_band_alone_at_every_band_edge() {
        assert!(plan(BREAKPOINTS.selector_row_max, 540.0).selector_row);
        assert!(!plan(BREAKPOINTS.selector_row_max + 1.0, 540.0).selector_row);
        assert!(!plan(BREAKPOINTS.drawer_max, 540.0).selector_row);
        assert!(!plan(BREAKPOINTS.drawer_max + 1.0, 540.0).selector_row);
        assert!(!plan(3000.0, 540.0).selector_row);
        assert!(!plan(900.0, 540.0).selector_row);
    }

    #[test]
    fn never_jumps_when_a_band_edge_is_crossed() {
        for edge in [480.0, 1200.0, 1600.0] {
            let below = plan(edge - 1.0, 900.0);
            let above = plan(edge, 900.0);
            assert!((above.timer_px - below.timer_px).abs() <= 1.0, "{edge}");
            assert!(
                (above.diagram_max_width - below.diagram_max_width).abs() <= 2.0,
                "{edge}"
            );
        }
    }

    #[test]
    fn trims_the_scramble_slot_smoothly_instead_of_at_580() {
        let at = |h: f64| plan(900.0, h).scramble_max_height;
        assert!(at(BREAKPOINTS.short_max + 1.0) - at(BREAKPOINTS.short_max) <= 1.0);
        assert!(at(BREAKPOINTS.short_max + 200.0) > at(BREAKPOINTS.short_max));
    }

    #[test]
    fn shrinks_the_readout_on_a_short_window_without_a_threshold() {
        let at = |h: f64| plan(1400.0, h).timer_px;
        assert!(at(480.0) - at(479.0) <= 1.0);
        assert!(at(400.0) < at(700.0));
    }

    #[test]
    fn user_scales_change_nothing_at_one() {
        assert_eq!(
            layout_for(900.0, 900.0, None, scales(UNIT_SCALES)),
            plan(900.0, 900.0)
        );
    }

    #[test]
    fn scales_the_readout_on_top_of_the_curve() {
        let curve = plan(900.0, 900.0).timer_px;
        assert_eq!(
            layout_for(
                900.0,
                900.0,
                None,
                scales(SizeScales {
                    timer: 1.5,
                    ..UNIT_SCALES
                })
            )
            .timer_px,
            (curve * 1.5).round()
        );
        // The floor and the cap are scaled too: a preference may push past the
        // curve's own bounds, which is the point of a size setting.
        assert_eq!(
            layout_for(
                360.0,
                294.0,
                None,
                scales(SizeScales {
                    timer: 0.75,
                    ..UNIT_SCALES
                })
            )
            .timer_px,
            54.0
        );
        assert_eq!(
            layout_for(
                5000.0,
                2000.0,
                None,
                scales(SizeScales {
                    timer: 1.5,
                    ..UNIT_SCALES
                })
            )
            .timer_px,
            336.0
        );
    }

    #[test]
    fn fits_fewer_characters_and_a_taller_slot_as_the_scramble_text_grows() {
        let base = plan(900.0, 900.0).scramble_chars;
        let big = layout_for(
            900.0,
            900.0,
            None,
            scales(SizeScales {
                scramble: 1.5,
                ..UNIT_SCALES
            }),
        );
        assert_eq!(big.scramble_px, 18.0 * 1.5);
        assert_eq!(big.scramble_chars, (base as f64 / 1.5).round() as i64);
        assert_eq!(big.scramble_max_height, (225.0_f64 * 1.5).round());
        let small = layout_for(
            900.0,
            900.0,
            None,
            scales(SizeScales {
                scramble: 0.75,
                ..UNIT_SCALES
            }),
        );
        assert_eq!(small.scramble_chars, (base as f64 / 0.75).round() as i64);
    }

    #[test]
    fn scales_the_diagram_box_on_top_of_the_curve() {
        let wide = plan(640.0, 360.0);
        let half = layout_for(
            640.0,
            360.0,
            None,
            scales(SizeScales {
                diagram: 0.5,
                ..UNIT_SCALES
            }),
        );
        assert!((half.diagram_max_width - wide.diagram_max_width * 0.5).abs() <= 1.0);
        assert_eq!(
            layout_for(
                640.0,
                360.0,
                None,
                scales(SizeScales {
                    diagram: 1.5,
                    ..UNIT_SCALES
                })
            )
            .diagram_max_height,
            (wide.diagram_max_height * 1.5).round()
        );
        // A window that sheds the diagram keeps it shed, whatever the scale.
        let shed = layout_for(
            360.0,
            294.0,
            None,
            scales(SizeScales {
                diagram: 1.5,
                ..UNIT_SCALES
            }),
        );
        assert_eq!(
            [shed.diagram_max_width, shed.diagram_max_height],
            [0.0, 0.0]
        );
    }

    #[test]
    fn leaves_the_layout_decisions_to_the_window() {
        let zoomed = layout_for(
            400.0,
            700.0,
            None,
            scales(SizeScales {
                timer: 1.5,
                scramble: 1.5,
                diagram: 1.5,
            }),
        );
        assert!(zoomed.drawer);
        assert!(zoomed.selector_row);
        assert_eq!(zoomed.diagram_placement, DiagramPlacement::TallNarrow);
        let small = layout_for(
            1600.0,
            900.0,
            None,
            scales(SizeScales {
                timer: 0.75,
                scramble: 0.75,
                diagram: 0.75,
            }),
        );
        assert!(!small.drawer);
        assert_eq!(small.diagram_placement, DiagramPlacement::Wide);
    }

    #[test]
    fn treats_a_scale_that_cannot_mean_anything_as_unchanged() {
        let base = plan(900.0, 900.0);
        for bad in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            let plan = layout_for(
                900.0,
                900.0,
                None,
                scales(SizeScales {
                    timer: bad,
                    scramble: bad,
                    diagram: bad,
                }),
            );
            assert_eq!(plan.timer_px, base.timer_px, "{bad}");
            assert_eq!(plan.scramble_px, 18.0, "{bad}");
            assert_eq!(plan.diagram_max_width, base.diagram_max_width, "{bad}");
        }
    }

    #[test]
    fn the_window_floor_is_the_hig_phone_minimum() {
        assert_eq!(BREAKPOINTS.min_width, 360.0);
        assert_eq!(BREAKPOINTS.min_height, 294.0);
    }

    #[test]
    fn selects_a_deliberate_layout_at_the_floor() {
        let plan = plan(BREAKPOINTS.min_width, BREAKPOINTS.min_height);
        assert!(plan.drawer);
        assert!(plan.selector_row);
        assert_eq!(plan.timer_px, 72.0);
        assert_eq!(plan.scramble_max_height, 90.0);
    }

    #[test]
    fn keeps_the_start_target_inside_libadwaitas_32_px_strip() {
        assert_eq!(START_AREA_INSET_PX, 16.0);
        const { assert!(START_AREA_INSET_PX < 32.0) };
    }
}
