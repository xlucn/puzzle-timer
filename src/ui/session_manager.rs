//! The session manager: rename, reorder and delete the sessions.
//!
//! Reordering is a pair of arrow buttons rather than a drag: it works on a
//! touch screen, and every action stays reachable from the keyboard.

use std::rc::Rc;

use gtk4 as gtk;
use gtk4::prelude::*;
use libadwaita as adw;
use libadwaita::prelude::*;

use crate::core::i18n::{MessageKey, t0};

use super::session_dialogs::confirm_delete;
use super::{App, AppSlot, with_app};

/// The dialog's own rebuild, filled in after the closure exists.
type RebuildSlot = Rc<std::cell::RefCell<Option<Rc<dyn Fn()>>>>;

pub fn open(parent: &impl IsA<gtk::Widget>, app: &App) {
    let dialog = adw::Dialog::builder()
        .title(t0(MessageKey::SessionManagerTitle))
        .content_width(420)
        .content_height(480)
        .build();

    let header = adw::HeaderBar::new();
    let close = gtk::Button::builder()
        .icon_name("window-close-symbolic")
        .tooltip_text(t0(MessageKey::CommonCancel))
        .build();
    header.pack_end(&close);

    let list = gtk::ListBox::builder()
        .selection_mode(gtk::SelectionMode::None)
        .css_classes(["boxed-list"])
        .margin_top(12)
        .margin_bottom(12)
        .margin_start(12)
        .margin_end(12)
        .build();

    let scroller = gtk::ScrolledWindow::builder()
        .child(&list)
        .hscrollbar_policy(gtk::PolicyType::Never)
        .vexpand(true)
        .build();

    let toolbar = adw::ToolbarView::new();
    toolbar.add_top_bar(&header);
    toolbar.set_content(Some(&scroller));
    dialog.set_child(Some(&toolbar));

    // `fill` needs to rebuild itself after every action, so the Rc is filled
    // in after the closure exists — the usual two-step for a recursive
    // callback.
    let holder: RebuildSlot = Rc::default();
    let rebuild: Rc<dyn Fn()> = {
        let holder = Rc::clone(&holder);
        let list = list.clone();
        let slot = app.slot.clone();
        Rc::new(move || {
            let Some(rebuild) = holder.borrow().clone() else {
                return;
            };
            fill(&list, &slot, &rebuild);
        })
    };
    *holder.borrow_mut() = Some(Rc::clone(&rebuild));

    rebuild();

    {
        let dialog = dialog.clone();
        close.connect_clicked(move |_| {
            dialog.close();
        });
    }

    dialog.present(Some(parent));
}

fn fill(list: &gtk::ListBox, slot: &AppSlot, rebuild: &Rc<dyn Fn()>) {
    while let Some(child) = list.first_child() {
        list.remove(&child);
    }

    let Some(app) = slot.borrow().clone() else {
        return;
    };
    let (entries, active) = app.state.library_snapshot();
    let last_index = entries.len().saturating_sub(1);

    for (index, entry) in entries.iter().enumerate() {
        let row = adw::ActionRow::builder()
            .title(&entry.name)
            .activatable(true)
            .build();
        if entry.id == active {
            row.add_prefix(&gtk::Image::from_icon_name("emblem-ok-symbolic"));
        }

        if index > 0 {
            let up = gtk::Button::builder()
                .icon_name("go-up-symbolic")
                .css_classes(["flat"])
                .build();
            let id = entry.id.clone();
            let slot = slot.clone();
            let rebuild = Rc::clone(rebuild);
            up.connect_clicked(move |_| {
                with_app(&slot, |app| app.move_session(&id, index as isize - 1));
                rebuild();
            });
            row.add_suffix(&up);
        }
        if index < last_index {
            let down = gtk::Button::builder()
                .icon_name("go-down-symbolic")
                .css_classes(["flat"])
                .build();
            let id = entry.id.clone();
            let slot = slot.clone();
            let rebuild = Rc::clone(rebuild);
            down.connect_clicked(move |_| {
                with_app(&slot, |app| app.move_session(&id, index as isize + 1));
                rebuild();
            });
            row.add_suffix(&down);
        }

        if entries.len() > 1 {
            let delete = gtk::Button::builder()
                .icon_name("user-trash-symbolic")
                .tooltip_text(t0(MessageKey::SessionManagerDelete))
                .css_classes(["flat"])
                .build();
            let id = entry.id.clone();
            let name = entry.name.clone();
            let slot = slot.clone();
            let rebuild = Rc::clone(rebuild);
            delete.connect_clicked(move |_| {
                let Some(app) = slot.borrow().clone() else {
                    return;
                };
                let solve_count = app.state.session(&id).borrow().len();
                let slot = slot.clone();
                let id = id.clone();
                let rebuild = Rc::clone(&rebuild);
                confirm_delete(&app.window, &name, solve_count, move || {
                    with_app(&slot, |app| app.apply_delete_session(&id));
                    rebuild();
                });
            });
            row.add_suffix(&delete);
        }

        {
            let name = entry.name.clone();
            let id = entry.id.clone();
            let slot = slot.clone();
            row.connect_activated(move |_| {
                with_app(&slot, |app| app.rename_session(&id, &name));
            });
        }

        list.append(&row);
    }
}
