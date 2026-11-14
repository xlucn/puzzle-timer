//! The big timer readout, its hint line and the averages strip.

use std::cell::Cell;
use std::rc::Rc;

use gtk4 as gtk;
use gtk4::prelude::*;

use crate::core::i18n::{MessageKey, t0};
use crate::core::time::{format_inspection, format_solve, format_time};
use crate::core::timer::{INSPECTION_DNF_MS, TimerSnapshot, TimerState};

use super::font_size::FontSize;
use super::stats_strip::StatsStrip;

fn hint_for(state: TimerState) -> MessageKey {
    match state {
        TimerState::Idle => MessageKey::TimerHintIdle,
        TimerState::Holding => MessageKey::TimerHintHolding,
        TimerState::Ready => MessageKey::TimerHintReady,
        TimerState::InspectionReady => MessageKey::TimerHintInspectionReady,
        TimerState::Inspecting => MessageKey::TimerHintInspecting,
        TimerState::Running => MessageKey::TimerHintRunning,
        TimerState::Stopped => MessageKey::TimerHintIdle,
    }
}

fn state_class(state: TimerState) -> &'static str {
    match state {
        TimerState::Idle => "state-idle",
        TimerState::Holding => "state-holding",
        TimerState::Ready => "state-ready",
        TimerState::InspectionReady => "state-inspection-ready",
        TimerState::Inspecting => "state-inspecting",
        TimerState::Running => "state-running",
        TimerState::Stopped => "state-stopped",
    }
}

pub struct TimerView {
    pub widget: gtk::Box,
    label: gtk::Label,
    hint: gtk::Label,
    strip: Rc<StatsStrip>,
    font: FontSize,
    chrome_visible: Cell<bool>,
}

impl TimerView {
    pub fn new(strip: Rc<StatsStrip>) -> Rc<Self> {
        let label = gtk::Label::builder()
            .label("0.00")
            .css_classes(["timer-display", "numeric", "state-idle"])
            .build();

        let hint = gtk::Label::builder()
            .label(t0(MessageKey::TimerHintIdle))
            .css_classes(["dim-label"])
            .build();

        let widget = gtk::Box::builder()
            .orientation(gtk::Orientation::Vertical)
            .spacing(2)
            .halign(gtk::Align::Center)
            .valign(gtk::Align::Center)
            .hexpand(true)
            .vexpand(true)
            .build();
        widget.append(&label);
        widget.append(&hint);
        widget.append(&strip.widget);

        Rc::new(Self {
            widget,
            label,
            hint,
            strip,
            font: FontSize::new(".timer-display"),
            chrome_visible: Cell::new(true),
        })
    }

    /// Hide the hint and the averages for the distraction-free timer view; the
    /// readout stays, and its font size is untouched.
    pub fn set_chrome_visible(&self, visible: bool) {
        if visible == self.chrome_visible.get() {
            return;
        }
        self.chrome_visible.set(visible);
        self.hint.set_visible(visible);
        self.strip.widget.set_visible(visible);
    }

    /// The readout's font size follows the layout curve and the user's scale.
    pub fn set_font_size(&self, px: f64) {
        self.font.set(px);
    }

    /// Redraw for a new snapshot. The inspection countdown stays up through the
    /// hold that starts the run; a stopped solve shows its graded result, so
    /// the readout always matches what the list records.
    pub fn render(&self, snapshot: &TimerSnapshot) {
        let in_inspection = snapshot.state == TimerState::Inspecting
            || (snapshot.inspection_ms > 0.0
                && matches!(snapshot.state, TimerState::Holding | TimerState::Ready));

        let text = if in_inspection {
            format_inspection(snapshot.inspection_ms)
        } else if snapshot.state == TimerState::Stopped && snapshot.penalty.is_some() {
            format_solve(snapshot.elapsed_ms, snapshot.penalty)
        } else {
            format_time(snapshot.elapsed_ms, false)
        };

        self.label.set_label(&text);
        let mut classes = vec!["timer-display", "numeric", state_class(snapshot.state)];
        if in_inspection && snapshot.inspection_ms >= INSPECTION_DNF_MS {
            classes.push("expired");
        }
        self.label.set_css_classes(&classes);
        self.hint.set_label(&t0(hint_for(snapshot.state)));
    }
}
