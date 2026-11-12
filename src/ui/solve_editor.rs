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
/// rather than a screen.
const EXPAND_SCRAMBLE_ABOVE: usize = 120;

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

/// Open the editor on `solve`; `on_save` gets the chosen penalty (`None` = OK)
/// and the trimmed comment (`None` when empty).
pub fn open(
    parent: &impl IsA<gtk::Widget>,
    solve: &Solve,
    number: usize,
    on_save: impl Fn(Option<Penalty>, Option<String>) + 'static,
) {
    let dialog = adw::Dialog::builder()
        .title(t(
            MessageKey::ListEditTitle,
            &[("number", Param::Number(number as f64))],
        ))
        .content_width(440)
        .build();

    let header = adw::HeaderBar::new();
    let cancel = gtk::Button::with_label(&t0(MessageKey::CommonCancel));
    let save = gtk::Button::builder()
        .label(t0(MessageKey::CommonSave))
        .css_classes(["suggested-action"])
        .build();
    header.pack_start(&cancel);
    header.pack_end(&save);

    let rows = gtk::ListBox::builder()
        .selection_mode(gtk::SelectionMode::None)
        .css_classes(["boxed-list"])
        .build();

    // ---- time: display, updated by the toggles -----------------------------
    let time_label = gtk::Label::builder()
        .label(time_text(solve.time_ms, solve.penalty))
        .css_classes(["title-2", "numeric"])
        .valign(gtk::Align::Center)
        .build();
    let time_row = adw::ActionRow::builder()
        .title(t0(MessageKey::ListTime))
        .build();
    time_row.add_suffix(&time_label);
    rows.append(&time_row);

    // ---- date and scramble: display-only history ---------------------------
    let date_text = format_full_timestamp(solve.created_at_ms);
    let date_row = property_row(MessageKey::ListDate, &date_text);
    date_row.add_suffix(&copy_button(&date_text, MessageKey::ListCopyDate));
    rows.append(&date_row);

    if !solve.scramble.is_empty() {
        if solve.scramble.len() <= EXPAND_SCRAMBLE_ABOVE {
            let scramble_row = property_row(MessageKey::ListScramble, &solve.scramble);
            scramble_row.add_suffix(&copy_button(&solve.scramble, MessageKey::ListCopyScramble));
            rows.append(&scramble_row);
        } else {
            let scramble_row = adw::ExpanderRow::builder()
                .title(t0(MessageKey::ListScramble))
                .subtitle(&solve.scramble)
                .subtitle_lines(1)
                .build();
            scramble_row.add_suffix(&copy_button(&solve.scramble, MessageKey::ListCopyScramble));
            // No scroller of its own: the form scrolls as one, so a long
            // scramble costs scroll rather than structure.
            let full = gtk::Label::builder()
                .label(&solve.scramble)
                .wrap(true)
                .xalign(0.0)
                .margin_top(6)
                .margin_bottom(6)
                .margin_start(12)
                .margin_end(12)
                .build();
            scramble_row.add_row(
                &gtk::ListBoxRow::builder()
                    .child(&full)
                    .selectable(false)
                    .activatable(false)
                    .build(),
            );
            rows.append(&scramble_row);
        }
    }

    // ---- penalty: all three choices visible at a glance --------------------
    let group = adw::ToggleGroup::builder()
        .valign(gtk::Align::Center)
        .build();
    for (index, key) in [
        MessageKey::ListPenaltyOk,
        MessageKey::ListPenaltyPlus2,
        MessageKey::ListPenaltyDnf,
    ]
    .into_iter()
    .enumerate()
    {
        // A toggle is addressed by name, so the save path survives the three
        // being reordered by a future translation.
        let label = t0(key).replace('_', "");
        group.add(
            adw::Toggle::builder()
                .label(&label)
                .name(penalty_name(index))
                .build(),
        );
    }
    group.set_active_name(Some(penalty_name(match solve.penalty {
        Some(Penalty::Plus2) => 1,
        Some(Penalty::Dnf) => 2,
        None => 0,
    })));
    let penalty_row = adw::ActionRow::builder()
        .title(t0(MessageKey::ListPenalty))
        .build();
    penalty_row.add_suffix(&group);
    rows.append(&penalty_row);

    {
        let time_label = time_label.clone();
        let time_ms = solve.time_ms;
        group.connect_active_name_notify(move |group| {
            let penalty = penalty_of(group.active_name().as_deref());
            time_label.set_label(&time_text(time_ms, penalty));
        });
    }

    // ---- comment -----------------------------------------------------------
    let comment = adw::EntryRow::builder()
        .title(t0(MessageKey::ListComment))
        .text(solve.comment.clone().unwrap_or_default())
        .build();
    comment.set_max_length(MAX_COMMENT_LENGTH as i32);
    // Enter in the comment must not save and close: only Save does that.
    rows.append(&comment);

    let content = gtk::Box::new(gtk::Orientation::Vertical, 0);
    content.set_margin_top(6);
    content.set_margin_bottom(12);
    content.set_margin_start(12);
    content.set_margin_end(12);
    content.append(&rows);

    let scroller = gtk::ScrolledWindow::builder()
        .child(&content)
        .hscrollbar_policy(gtk::PolicyType::Never)
        .propagate_natural_height(true)
        .vexpand(true)
        .build();

    let toolbar = adw::ToolbarView::new();
    toolbar.add_top_bar(&header);
    toolbar.set_content(Some(&scroller));
    dialog.set_child(Some(&toolbar));

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

    dialog.present(Some(parent));
    comment.grab_focus();
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
