//! The solve editor: penalty and comment together.
//!
//! One dialog, because a solve's grade and its note are the same act of
//! annotating history — the list opens it from its Edit button, a double-click
//! or Ctrl+E.
//!
//! The display rows come first and the controls below: what you read sits
//! above what you change. The time at the end of its row updates with the
//! penalty, so the number always matches the choice, and DNF keeps the solved
//! time in view as `DNF(12.34)`.
//!
//! The shell — dialog, header bar, scroller, list and the three rows that never
//! change — is `solve_editor.blp`, compiled by `build.rs`. Text is not in the
//! template: it comes from the catalogs here, and the two rows that depend on
//! the solve are inserted between the time and penalty rows.

use std::rc::Rc;

use gtk4 as gtk;
use gtk4::prelude::*;
use libadwaita as adw;
use libadwaita::prelude::*;

use crate::core::i18n::{MessageKey, Param, t, t0};
use crate::core::session::{MAX_COMMENT_LENGTH, Solve};
use crate::core::time::{Penalty, format_full_timestamp, format_solve};

/// Above this length the scramble collapses into an expander row: one
/// ellipsized line until asked, so a relay's thousand characters cost a click
/// rather than a screen. The same 200 as v0.3.0, which measured it: 555wca
/// tops out at 198 characters — the tall row that still reads fine in the
/// 480 px dialog — while 666wca starts at 269 and a 2–7 relay runs past 1000.
const EXPAND_SCRAMBLE_ABOVE: usize = 200;

/// The compiled form of `solve_editor.blp`.
const LAYOUT: &str = include_str!(concat!(env!("OUT_DIR"), "/solve_editor.ui"));

fn copy_button(text: &str, tooltip: MessageKey) -> gtk::Button {
    let button = gtk::Button::builder()
        .icon_name("edit-copy-symbolic")
        .tooltip_text(t0(tooltip))
        .css_classes(["flat"])
        .valign(gtk::Align::Center)
        .build();
    let text = text.to_string();
    button.connect_clicked(move |button| {
        button.clipboard().set_text(&text);
    });
    button
}

fn property_row(title: MessageKey, subtitle: &str) -> adw::ActionRow {
    adw::ActionRow::builder()
        .title(t0(title))
        .subtitle(subtitle)
        .css_classes(["property"])
        .build()
}

fn time_text(time_ms: f64, penalty: Option<Penalty>) -> String {
    match penalty {
        Some(Penalty::Dnf) => format!("DNF({})", format_solve(time_ms, None)),
        other => format_solve(time_ms, other),
    }
}

/// A named object from `solve_editor.blp`. The template and this file are one
/// unit, so a missing id is a bug in the pair, not a runtime condition.
fn child<T: IsA<gtk::glib::Object>>(builder: &gtk::Builder, id: &str) -> T {
    builder
        .object(id)
        .unwrap_or_else(|| panic!("solve_editor.blp has no `{id}`"))
}

/// Open the editor on `solve`; `on_save` gets the chosen penalty (`None` = OK)
/// and the trimmed comment (`None` when empty).
pub fn open(
    parent: &impl IsA<gtk::Widget>,
    solve: &Solve,
    number: usize,
    on_save: impl Fn(Option<Penalty>, Option<String>) + 'static,
) {
    let builder = gtk::Builder::from_string(LAYOUT);

    let dialog: adw::Dialog = child(&builder, "solve_editor");
    dialog.set_title(&t(
        MessageKey::ListEditTitle,
        &[("number", Param::Number(number as f64))],
    ));

    // Both title-button sides are off in the template: that is how a dialog
    // does away with its own close button, leaving Cancel and Save as the only
    // ways out.
    let cancel: gtk::Button = child(&builder, "cancel");
    cancel.set_label(&t0(MessageKey::CommonCancel));
    let save: gtk::Button = child(&builder, "save");
    save.set_label(&t0(MessageKey::CommonSave));

    let rows: gtk::ListBox = child(&builder, "rows");

    // ---- time: display, updated by the toggles -----------------------------
    let time_row: adw::ActionRow = child(&builder, "time_row");
    time_row.set_title(&t0(MessageKey::ListTime));
    let time_label: gtk::Label = child(&builder, "time_label");
    time_label.set_label(&time_text(solve.time_ms, solve.penalty));

    // ---- date and scramble: display-only history ---------------------------
    let date_text = format_full_timestamp(solve.created_at_ms);
    let date_row = property_row(MessageKey::ListDate, &date_text);
    date_row.add_suffix(&copy_button(&date_text, MessageKey::ListCopyDate));
    rows.insert(&date_row, 1);

    if !solve.scramble.is_empty() {
        let scramble_row = scramble_row(solve);
        rows.insert(&scramble_row, 2);
    }

    // ---- penalty: all three choices visible at a glance --------------------
    let group: adw::ToggleGroup = child(&builder, "group");
    for (index, key) in [
        MessageKey::ListPenaltyOk,
        MessageKey::ListPenaltyPlus2,
        MessageKey::ListPenaltyDnf,
    ]
    .into_iter()
    .enumerate()
    {
        // A toggle is addressed by name, so the save path survives the three
        // being reordered by a future translation. The catalogs carry the
        // mnemonics (Alt+O / Alt+2 / Alt+D), so the labels keep their
        // underscores.
        group.add(
            adw::Toggle::builder()
                .label(t0(key))
                .name(penalty_name(index))
                .use_underline(true)
                .build(),
        );
    }
    group.set_active_name(Some(penalty_name(match solve.penalty {
        Some(Penalty::Plus2) => 1,
        Some(Penalty::Dnf) => 2,
        None => 0,
    })));
    let penalty_row: adw::ActionRow = child(&builder, "penalty_row");
    penalty_row.set_title(&t0(MessageKey::ListPenalty));

    {
        let time_label = time_label.clone();
        let time_ms = solve.time_ms;
        group.connect_active_name_notify(move |group| {
            let penalty = penalty_of(group.active_name().as_deref());
            time_label.set_label(&time_text(time_ms, penalty));
        });
    }

    // ---- comment -----------------------------------------------------------
    // Enter in the comment must not save and close: only Save does that.
    let comment: adw::EntryRow = child(&builder, "comment");
    comment.set_title(&t0(MessageKey::ListComment));
    comment.set_text(&solve.comment.clone().unwrap_or_default());
    comment.set_max_length(MAX_COMMENT_LENGTH as i32);

    {
        let dialog = dialog.clone();
        cancel.connect_clicked(move |_| {
            dialog.close();
        });
    }

    let on_save = Rc::new(on_save);
    {
        let dialog = dialog.clone();
        let group = group.clone();
        let comment = comment.clone();
        save.connect_clicked(move |_| {
            let penalty = penalty_of(group.active_name().as_deref());
            let text = comment.text().trim().to_string();
            on_save(penalty, (!text.is_empty()).then_some(text));
            dialog.close();
        });
    }

    // Focus opens on Save: Cancel takes the start slot, and Return landing
    // there would throw the edit away. The comment line is still reachable
    // with Tab or its mnemonic, and Return resolves to Save from anywhere
    // outside it — the entry itself keeps Enter.
    dialog.set_default_widget(Some(&save));
    dialog.set_focus(Some(&save));
    dialog.present(Some(parent));
}

/// The scramble row, which is an expander when the sequence would push the
/// dialog past a screen.
fn scramble_row(solve: &Solve) -> adw::PreferencesRow {
    if solve.scramble.len() <= EXPAND_SCRAMBLE_ABOVE {
        let row = property_row(MessageKey::ListScramble, &solve.scramble);
        row.add_suffix(&copy_button(&solve.scramble, MessageKey::ListCopyScramble));
        return row.upcast();
    }

    let row = adw::ExpanderRow::builder()
        .title(t0(MessageKey::ListScramble))
        .subtitle(&solve.scramble)
        .subtitle_lines(1)
        .build();
    row.add_suffix(&copy_button(&solve.scramble, MessageKey::ListCopyScramble));
    // No scroller of its own: the form scrolls as one, so a long scramble
    // costs scroll rather than structure.
    let full = gtk::Label::builder()
        .label(&solve.scramble)
        .wrap(true)
        .xalign(0.0)
        .margin_top(6)
        .margin_bottom(6)
        .margin_start(12)
        .margin_end(12)
        .build();
    row.add_row(
        &gtk::ListBoxRow::builder()
            .child(&full)
            .selectable(false)
            .activatable(false)
            .build(),
    );
    row.upcast()
}

fn penalty_name(index: usize) -> &'static str {
    match index {
        1 => "plus2",
        2 => "dnf",
        _ => "ok",
    }
}

fn penalty_of(name: Option<&str>) -> Option<Penalty> {
    match name {
        Some("plus2") => Some(Penalty::Plus2),
        Some("dnf") => Some(Penalty::Dnf),
        _ => None,
    }
}
