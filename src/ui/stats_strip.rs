//! The ao5/ao12 strip under the timer readout.
//!
//! Values are the *current* window averages, computed on the effective
//! (penalised) times, so a +2 or DNF in the last five solves shows up here
//! immediately. An incomplete window — fewer solves than the average needs — is
//! an em dash, never a partial average: a 3-solve "ao5" would lie about what it
//! is.

use std::rc::Rc;

use gtk4 as gtk;
use gtk4::prelude::*;

use crate::core::session::Solve;
use crate::core::stats::{StatKind, current_window, effective_times};
use crate::core::time::format_average;

pub struct StatsStrip {
    pub widget: gtk::Box,
    ao5: gtk::Label,
    ao12: gtk::Label,
}

fn cell(kind: &str) -> (gtk::Box, gtk::Label) {
    let label = gtk::Label::builder()
        .label(kind)
        .css_classes(["caption", "dim-label"])
        .build();
    let value = gtk::Label::builder()
        .css_classes(["stats-value", "numeric"])
        .build();
    let row = gtk::Box::builder()
        .orientation(gtk::Orientation::Horizontal)
        .spacing(6)
        .build();
    row.append(&label);
    row.append(&value);
    (row, value)
}

fn paint(target: &gtk::Label, average: f64) {
    if average.is_nan() {
        target.set_label("—");
        target.set_css_classes(&["stats-value", "incomplete"]);
    } else {
        target.set_label(&format_average(average));
        target.set_css_classes(&["stats-value", "numeric"]);
    }
}

impl StatsStrip {
    pub fn new() -> Rc<Self> {
        let (row5, ao5) = cell("ao5");
        let (row12, ao12) = cell("ao12");

        let widget = gtk::Box::builder()
            .orientation(gtk::Orientation::Horizontal)
            .spacing(28)
            .halign(gtk::Align::Center)
            .build();
        widget.append(&row5);
        widget.append(&row12);

        Rc::new(Self { widget, ao5, ao12 })
    }

    /// Recompute both cells from the session's solves.
    pub fn refresh(&self, solves: &[Solve]) {
        let times = effective_times(solves);
        paint(&self.ao5, current_window(&times, StatKind::Ao5));
        paint(&self.ao12, current_window(&times, StatKind::Ao12));
    }
}
