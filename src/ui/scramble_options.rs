//! The scramble type's options: how the chosen scrambler runs.
//!
//! Two options with the same split as the legacy app: a per-type length (the
//! number passed to `getScramble`, meaning moves, scrambles or cubes — the
//! catalogue owns the default) and csTimer's "fast" switch for the types that
//! have a random-move stand-in. Neither is persisted: a type change resets
//! both, which is what the original does.

use std::cell::Cell;
use std::rc::Rc;

use gtk4 as gtk;
use gtk4::prelude::*;
use libadwaita as adw;
use libadwaita::prelude::*;

use crate::core::i18n::{MessageKey, t0};
use crate::core::scramble_types::{ScrambleLengthKind, fast_scramble_type, scramble_length_kind};

/// csTimer's length input allows three digits; the same ceiling here.
const MAX_LENGTH: f64 = 999.0;

pub struct ScrambleOptions {
    pub popover: gtk::Popover,
    length: adw::SpinRow,
    fast: adw::SwitchRow,
    syncing: Rc<Cell<bool>>,
}

fn length_title(kind: ScrambleLengthKind) -> MessageKey {
    match kind {
        ScrambleLengthKind::Moves => MessageKey::ScrambleMoves,
        ScrambleLengthKind::Scrambles => MessageKey::ScrambleScrambles,
        ScrambleLengthKind::Cubes => MessageKey::ScrambleCubes,
    }
}

impl ScrambleOptions {
    pub fn new(on_length: impl Fn(u32) + 'static, on_fast: impl Fn(bool) + 'static) -> Rc<Self> {
        let adjustment = gtk::Adjustment::new(1.0, 1.0, MAX_LENGTH, 1.0, 10.0, 0.0);
        let length = adw::SpinRow::new(Some(&adjustment), 1.0, 0);
        length.set_numeric(true);
        let fast = adw::SwitchRow::builder()
            .title(t0(MessageKey::ScrambleFast))
            .build();

        let list = gtk::ListBox::builder()
            .selection_mode(gtk::SelectionMode::None)
            .css_classes(["boxed-list"])
            .width_request(260)
            .build();
        list.append(&length);
        list.append(&fast);

        let popover = gtk::Popover::new();
        popover.set_child(Some(&list));

        let syncing = Rc::new(Cell::new(false));
        {
            let syncing = Rc::clone(&syncing);
            length.connect_value_notify(move |row| {
                if syncing.get() {
                    return;
                }
                on_length(row.value().round().max(1.0) as u32);
            });
        }
        {
            let syncing = Rc::clone(&syncing);
            fast.connect_active_notify(move |row| {
                if syncing.get() {
                    return;
                }
                on_fast(row.is_active());
            });
        }

        Rc::new(Self {
            popover,
            length,
            fast,
            syncing,
        })
    }

    /// Show the values that belong to `type_id` without pretending they were
    /// edits, and hide the fast switch where there is no stand-in.
    pub fn sync(&self, type_id: &str, length: u32, fast_enabled: bool) {
        self.syncing.set(true);
        let kind = scramble_length_kind(type_id);
        self.length.set_title(&t0(length_title(kind)));
        self.length.set_value(f64::from(length.max(1)));
        self.fast.set_visible(fast_scramble_type(type_id).is_some());
        self.fast.set_active(fast_enabled);
        self.syncing.set(false);
    }
}
