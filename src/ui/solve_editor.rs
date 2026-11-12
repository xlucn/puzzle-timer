//! The solve editor: penalty and comment together.
//!
//! One dialog, because a solve's grade and its note are the same act of
//! annotating history — the list opens it from its Edit button, a double-click
//! or Ctrl+E.

use std::rc::Rc;

use gtk4 as gtk;
use gtk4::prelude::*;
use libadwaita as adw;
use libadwaita::prelude::*;

use crate::core::i18n::{MessageKey, t0};
use crate::core::session::{MAX_COMMENT_LENGTH, Solve};
use crate::core::time::{Penalty, format_full_timestamp};

/// Open the editor on `solve`; `on_save` gets the chosen penalty (`None` = OK)
/// and the trimmed comment (`None` when empty).
pub fn open(
    parent: &impl IsA<gtk::Widget>,
    solve: &Solve,
    on_save: impl Fn(Option<Penalty>, Option<String>) + 'static,
) {
    let dialog = adw::Dialog::builder()
        .title(t0(MessageKey::ListEditTitle))
        .content_width(420)
        .build();

    let header = adw::HeaderBar::new();
    let cancel = gtk::Button::with_label(&t0(MessageKey::CommonCancel));
    let save = gtk::Button::builder()
        .label(t0(MessageKey::CommonSave))
        .css_classes(["suggested-action"])
        .build();
    header.pack_start(&cancel);
    header.pack_end(&save);

    // ---- penalty -----------------------------------------------------------
    let penalty_labels = [
        t0(MessageKey::ListPenaltyOk),
        t0(MessageKey::ListPenaltyPlus2),
        t0(MessageKey::ListPenaltyDnf),
    ];
    let labels: Vec<&str> = penalty_labels.iter().map(String::as_str).collect();
    let penalty = gtk::DropDown::from_strings(&labels);
    penalty.set_selected(match solve.penalty {
        Some(Penalty::Plus2) => 1,
        Some(Penalty::Dnf) => 2,
        None => 0,
    });

    let penalty_row = adw::ActionRow::builder()
        .title(t0(MessageKey::ListPenalty))
        .build();
    penalty_row.add_suffix(&penalty);

    // ---- comment -----------------------------------------------------------
    let comment = gtk::Entry::builder()
        .text(solve.comment.clone().unwrap_or_default())
        .max_length(MAX_COMMENT_LENGTH as i32)
        .hexpand(true)
        .build();
    let comment_row = adw::ActionRow::builder()
        .title(t0(MessageKey::ListComment))
        .build();
    comment_row.add_suffix(&comment);

    let group = gtk::ListBox::builder()
        .selection_mode(gtk::SelectionMode::None)
        .css_classes(["boxed-list"])
        .build();
    group.append(&penalty_row);
    group.append(&comment_row);

    // ---- what was solved ---------------------------------------------------
    let time = gtk::Label::builder()
        .label(crate::core::time::format_solve(
            solve.time_ms,
            solve.penalty,
        ))
        .xalign(0.0)
        .css_classes(["title-2", "numeric"])
        .build();
    let stamp = gtk::Label::builder()
        .label(format_full_timestamp(solve.created_at_ms))
        .xalign(0.0)
        .css_classes(["caption", "dim-label"])
        .build();
    let scramble = gtk::Label::builder()
        .label(&solve.scramble)
        .xalign(0.0)
        .wrap(true)
        .selectable(true)
        .css_classes(["monospace", "caption"])
        .build();
    let scramble_scroll = gtk::ScrolledWindow::builder()
        .child(&scramble)
        .hscrollbar_policy(gtk::PolicyType::Never)
        .max_content_height(160)
        .propagate_natural_height(true)
        .build();

    let content = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(12)
        .margin_top(12)
        .margin_bottom(12)
        .margin_start(12)
        .margin_end(12)
        .build();
    content.append(&time);
    content.append(&stamp);
    content.append(&group);
    content.append(&scramble_scroll);

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
        let penalty = penalty.clone();
        let comment = comment.clone();
        save.connect_clicked(move |_| {
            let grade = match penalty.selected() {
                1 => Some(Penalty::Plus2),
                2 => Some(Penalty::Dnf),
                _ => None,
            };
            let text = comment.text().trim().to_string();
            on_save(grade, (!text.is_empty()).then_some(text));
            dialog.close();
        });
    }

    dialog.present(Some(parent));
    comment.grab_focus();
}
