//! The scramble above the timer, and its diagram.
//!
//! Three states, one slot:
//!
//! ```text
//!   scramble   → show it (wrapped); the diagram sits in the lower area
//!   generating → the previous scramble stays as a dimmed ghost under a
//!                spinner, so the timer holds still
//!   error      → the reason, in the error colour, over the ghost
//! ```
//!
//! The panel renders the picture but does not place it: `mod.rs` owns the dock
//! that puts it beside the timer or in its bottom-right cell.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use gtk4 as gtk;
use gtk4::prelude::*;
use libadwaita as adw;

use super::font_size::FontSize;
use crate::core::i18n::{MessageKey, Param, t, t0};

/// The panel's own vertical margins, outside its measured height.
const PANEL_MARGIN_TOP: i32 = 8;
const PANEL_MARGIN_BOTTOM: i32 = 4;

/// "Not decided yet": every cap starts unset and the first layout pass fills it
/// in before the window is presented.
const UNSET: i32 = -1;

/// A declared size as `GdkPaintable` can report it. csTimer declares some
/// images with a fractional size (4x4 is 526×392.667) while the intrinsic
/// getters answer whole px, so accept floor/ceil/round.
fn plausible_size(reported: i32, declared: f64) -> bool {
    reported as f64 == declared.floor()
        || reported as f64 == declared.ceil()
        || reported as f64 == declared.round()
}

/// csTimer's SVG quirks, rewritten on the way in: literal `undefined` colours
/// and the `font:` shorthand its generator emits. A `viewBox` is added when it
/// is missing so the content scales with the box it is drawn into.
fn rewrite_svg(svg: &str) -> Option<(String, f64, f64)> {
    let root_end = svg.find('>')?;
    let root = &svg[..=root_end];
    if !root.starts_with("<svg") {
        return None;
    }
    let declared_width = attr(root, "width")?;
    let declared_height = attr(root, "height")?;
    // NaN is csTimer's own answer for a type with no drawing rule.
    if !(declared_width.is_finite() && declared_height.is_finite())
        || declared_width <= 0.0
        || declared_height <= 0.0
    {
        return None;
    }

    let mut with_view_box = root.to_string();
    if !root.contains("viewBox=") {
        with_view_box = format!(
            "<svg{} viewBox=\"0 0 {declared_width} {declared_height}\">",
            &root[4..root.len() - 1]
        );
    }
    let mut rewritten = format!("{with_view_box}{}", &svg[root_end + 1..]);
    rewritten = rewritten
        .replace("fill:undefined", "fill:#000000")
        .replace("stroke:undefined", "stroke:#ffdddd");
    Some((rewritten, declared_width, declared_height))
}

/// The numeric value of `name="…"` in an element's opening tag.
fn attr(root: &str, name: &str) -> Option<f64> {
    let start = root.find(&format!("{name}=\""))? + name.len() + 2;
    let rest = &root[start..];
    let end = rest.find('"')?;
    rest[..end].parse().ok()
}

/// An SVG string → a `gtk::Svg` paintable at the SVG's own size, or `None`
/// when it cannot be parsed (a broken picture must not cost the scramble).
fn svg_paintable(svg: &str) -> Option<gtk::Svg> {
    let (rewritten, width, height) = rewrite_svg(svg)?;
    let bytes = glib::Bytes::from(rewritten.as_bytes());
    let paintable = gtk::Svg::from_bytes(&bytes);
    if !plausible_size(paintable.intrinsic_width(), width)
        || !plausible_size(paintable.intrinsic_height(), height)
    {
        return None;
    }
    Some(paintable)
}

pub struct ScramblePanel {
    pub widget: gtk::Box,
    /// The diagram's box: the caller places it, the panel fills it.
    pub image: gtk::Overlay,
    text: gtk::Label,
    scroll: gtk::ScrolledWindow,
    spinner: adw::Spinner,
    status: gtk::Label,
    warm_error: gtk::Label,
    status_row: gtk::Box,
    picture: gtk::Picture,
    diagram_spacer: gtk::Box,
    font: FontSize,

    last_text: RefCell<Option<String>>,
    current_svg: RefCell<Option<String>>,
    picture_ready: Cell<bool>,
    picture_aspect: Cell<f64>,
    diagram_max_width: Cell<f64>,
    diagram_max_height: Cell<f64>,
    chrome_visible: Cell<bool>,
    spinning: Cell<bool>,
}

impl ScramblePanel {
    pub fn new() -> Rc<Self> {
        let text = gtk::Label::builder()
            .css_classes(["scramble-text", "monospace"])
            .visible(false)
            .wrap(true)
            .selectable(false)
            .xalign(0.5)
            .justify(gtk::Justification::Center)
            .max_width_chars(UNSET)
            .build();

        let scroll = gtk::ScrolledWindow::builder()
            .child(&text)
            .hscrollbar_policy(gtk::PolicyType::Never)
            .vscrollbar_policy(gtk::PolicyType::External)
            .propagate_natural_height(true)
            .max_content_height(UNSET)
            .build();

        let spinner = adw::Spinner::new();
        spinner.set_visible(false);

        let status = gtk::Label::builder()
            .css_classes(["scramble-status", "caption", "dim-label"])
            .label(t0(MessageKey::ScrambleGenerating))
            .wrap(true)
            .max_width_chars(60)
            .visible(false)
            .build();

        let status_row = gtk::Box::builder()
            .orientation(gtk::Orientation::Horizontal)
            .spacing(8)
            .halign(gtk::Align::Center)
            .valign(gtk::Align::Center)
            .visible(false)
            .build();
        status_row.append(&spinner);
        status_row.append(&status);

        let warm_error = gtk::Label::builder()
            .css_classes(["scramble-status", "caption", "error"])
            .wrap(true)
            .max_width_chars(60)
            .visible(false)
            .build();

        let overlay = gtk::Overlay::new();
        overlay.set_child(Some(&scroll));
        overlay.add_overlay(&status_row);

        let widget = gtk::Box::builder()
            .orientation(gtk::Orientation::Vertical)
            .spacing(6)
            .margin_top(PANEL_MARGIN_TOP)
            .margin_bottom(PANEL_MARGIN_BOTTOM)
            .margin_start(18)
            .margin_end(18)
            .build();
        widget.append(&overlay);
        widget.append(&warm_error);

        let picture = gtk::Picture::builder()
            .alternative_text(t0(MessageKey::ScrambleDiagram))
            .can_shrink(true)
            .can_target(false)
            .content_fit(gtk::ContentFit::Contain)
            .halign(gtk::Align::End)
            .valign(gtk::Align::End)
            .build();

        let diagram_spacer = gtk::Box::builder().can_target(false).build();
        let diagram_box = gtk::Overlay::builder()
            .child(&diagram_spacer)
            .halign(gtk::Align::End)
            .valign(gtk::Align::End)
            .margin_end(16)
            .margin_bottom(16)
            .can_target(false)
            .visible(false)
            .build();
        diagram_box.add_overlay(&picture);

        Rc::new(Self {
            widget,
            image: diagram_box,
            text,
            scroll,
            spinner,
            status,
            warm_error,
            status_row,
            picture,
            diagram_spacer,
            font: FontSize::new(".scramble-text"),
            last_text: RefCell::new(None),
            current_svg: RefCell::new(None),
            picture_ready: Cell::new(false),
            picture_aspect: Cell::new(0.0),
            diagram_max_width: Cell::new(-1.0),
            diagram_max_height: Cell::new(-1.0),
            chrome_visible: Cell::new(true),
            spinning: Cell::new(false),
        })
    }

    /// Redraw for the feed state: the scramble on screen (or its ghost), the
    /// failure reason, and the SVG for that scramble when its type has one.
    pub fn render(&self, scramble: Option<&str>, error: Option<&str>, svg: Option<&str>) {
        let has_scramble = scramble.is_some();
        let generating = !has_scramble && error.is_none();

        if let Some(scramble) = scramble {
            *self.last_text.borrow_mut() = Some(scramble.to_string());
            self.text.set_label(scramble);
            self.text.set_css_classes(&["scramble-text", "monospace"]);
        } else if self.last_text.borrow().is_some() {
            self.text
                .set_css_classes(&["scramble-text", "monospace", "pending"]);
        }
        self.text.set_visible(self.last_text.borrow().is_some());

        self.status_row.set_visible(!has_scramble);
        self.set_spinning(generating);
        if !has_scramble {
            if generating {
                self.status.set_label(&t0(MessageKey::ScrambleGenerating));
                self.status
                    .set_css_classes(&["scramble-status", "caption", "dim-label"]);
            } else {
                self.status.set_label(&t(
                    MessageKey::ScrambleFailed,
                    &[("reason", Param::Text(error.unwrap_or("")))],
                ));
                self.status
                    .set_css_classes(&["scramble-status", "caption", "error"]);
            }
        }

        // A warm failure reports under the scramble still on screen.
        let warm_failure = if has_scramble { error } else { None };
        self.warm_error.set_visible(warm_failure.is_some());
        if let Some(reason) = warm_failure {
            self.warm_error.set_label(&t(
                MessageKey::ScrambleFailed,
                &[("reason", Param::Text(reason))],
            ));
        }

        // The diagram follows the scramble on screen (or its ghost), so it
        // swaps in the same frame as the text.
        let svg = if has_scramble {
            svg.map(str::to_string)
        } else {
            self.current_svg.borrow().clone()
        };
        if *self.current_svg.borrow() != svg {
            *self.current_svg.borrow_mut() = svg.clone();
            let paintable = svg.as_deref().and_then(svg_paintable);
            self.picture_ready.set(paintable.is_some());
            match &paintable {
                Some(paintable) => self.picture.set_paintable(Some(paintable)),
                None => self.picture.set_paintable(None::<&gtk::Svg>),
            }
            let aspect = paintable
                .as_ref()
                .filter(|paintable| paintable.intrinsic_height() > 0)
                .map(|paintable| {
                    paintable.intrinsic_width() as f64 / paintable.intrinsic_height() as f64
                })
                .unwrap_or(0.0);
            self.picture_aspect.set(aspect);
            self.apply_diagram_size();
            self.update_diagram_visibility();
        }
    }

    pub fn set_chrome_visible(&self, visible: bool) {
        if visible == self.chrome_visible.get() {
            return;
        }
        self.chrome_visible.set(visible);
        self.widget.set_visible(visible);
        self.update_diagram_visibility();
    }

    /// The scramble text's request cap and the slot's height cap, from the
    /// layout curve (already carrying the user's text scale).
    pub fn set_limits(&self, max_width_chars: i32, max_content_height: f64) {
        self.text.set_max_width_chars(max_width_chars);
        self.scroll
            .set_max_content_height(max_content_height.round() as i32);
    }

    /// The scramble text's font size — the curve times the user's scale.
    pub fn set_font_size(&self, px: f64) {
        self.font.set(px);
    }

    /// The diagram box's cap for this window. Only the box's size request
    /// moves: the paintable keeps the SVG's own size.
    pub fn set_diagram_max(&self, width: f64, height: f64) {
        if (width - self.diagram_max_width.get()).abs() < f64::EPSILON
            && (height - self.diagram_max_height.get()).abs() < f64::EPSILON
        {
            return;
        }
        self.diagram_max_width.set(width);
        self.diagram_max_height.set(height);
        self.apply_diagram_size();
        self.update_diagram_visibility();
    }

    fn set_spinning(&self, on: bool) {
        if on == self.spinning.get() {
            return;
        }
        self.spinning.set(on);
        self.spinner.set_visible(on);
    }

    /// The spacer is the box's only size request; trimming it to the picture's
    /// own aspect keeps a 4:3 diagram from reserving a 2:1 column.
    fn apply_diagram_size(&self) {
        let max_width = self.diagram_max_width.get();
        let max_height = self.diagram_max_height.get();
        let aspect = self.picture_aspect.get();
        let width = if aspect > 0.0 {
            max_width.min(max_height * aspect)
        } else {
            max_width
        };
        self.diagram_spacer.set_size_request(
            width.max(0.0).round() as i32,
            max_height.max(0.0).round() as i32,
        );
    }

    fn update_diagram_visibility(&self) {
        let has_room = self.diagram_max_width.get() > 0.0 && self.diagram_max_height.get() > 0.0;
        self.image
            .set_visible(self.chrome_visible.get() && self.picture_ready.get() && has_room);
    }
}
