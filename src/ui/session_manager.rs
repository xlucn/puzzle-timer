//! The session manager: switch, rename, reorder and delete the sessions.
//!
//! Reordering is a drag from the row's handle. The handle starts the drag
//! rather than the row, so a plain click still activates the session and the
//! list keeps scrolling under the text on a touch screen. Dropping on the top
//! half of a row inserts before it, the bottom half after it.

use std::rc::Rc;

use gtk4 as gtk;
use gtk4::prelude::*;
use libadwaita as adw;
use libadwaita::prelude::*;

use crate::core::i18n::{MessageKey, t0};
use crate::core::scramble_types::{SCRAMBLE_DEFAULT_TYPE, scramble_type_label};

use super::session_dialogs::confirm_delete;
use super::{App, AppSlot, with_app};

/// The row a dragged session will land on. A tint rather than a border: the
/// row's own card keeps its shape while the pointer moves down the list.
const DROP_TARGET_CLASS: &str = "session-drop-target";

/// The dialog's own rebuild, filled in after the closure exists.
type RebuildSlot = Rc<std::cell::RefCell<Option<Rc<dyn Fn()>>>>;

pub fn open(parent: &impl IsA<gtk::Widget>, app: &App) {
    let dialog = adw::Dialog::builder()
        .title(t0(MessageKey::SessionManagerTitle))
        .content_width(420)
        .content_height(480)
        .build();

    let header = adw::HeaderBar::new();

    let page = adw::PreferencesPage::new();
    let group = adw::PreferencesGroup::new();
    page.add(&group);

    // `render` needs to rebuild itself after every change, so the Rc is filled
    // in after the closure exists — the usual two-step for a recursive
    // callback.
    let holder: RebuildSlot = Rc::default();
    // The rows this dialog added: `PreferencesGroup` has no "clear", and its
    // `first_child` is the group's own box, not the rows.
    let rows: Rc<std::cell::RefCell<Vec<gtk::Widget>>> = Rc::default();
    let render: Rc<dyn Fn()> = {
        let holder = Rc::clone(&holder);
        let group = group.clone();
        let rows = Rc::clone(&rows);
        let slot = app.slot.clone();
        Rc::new(move || {
            let Some(render) = holder.borrow().clone() else {
                return;
            };
            for row in rows.borrow_mut().drain(..) {
                group.remove(&row);
            }
            fill(&group, &rows, &slot, &render);
        })
    };
    *holder.borrow_mut() = Some(Rc::clone(&render));

    render();

    let new = gtk::Button::builder()
        .icon_name("list-add-symbolic")
        .tooltip_text(t0(MessageKey::SessionNewTooltip))
        .css_classes(["flat"])
        .build();
    {
        let slot = app.slot.clone();
        new.connect_clicked(move |_| with_app(&slot, |app| app.new_session()));
    }
    header.pack_start(&new);

    let close = gtk::Button::builder()
        .icon_name("window-close-symbolic")
        .tooltip_text(t0(MessageKey::CommonCancel))
        .css_classes(["flat"])
        .build();
    {
        let dialog = dialog.clone();
        close.connect_clicked(move |_| {
            dialog.close();
        });
    }
    header.pack_end(&close);

    let toolbar = adw::ToolbarView::new();
    toolbar.add_top_bar(&header);
    toolbar.set_content(Some(&page));
    dialog.set_child(Some(&toolbar));

    dialog.present(Some(parent));
}

type Rows = Rc<std::cell::RefCell<Vec<gtk::Widget>>>;

fn fill(group: &adw::PreferencesGroup, rows: &Rows, slot: &AppSlot, render: &Rc<dyn Fn()>) {
    let Some(app) = slot.borrow().clone() else {
        return;
    };
    let (entries, active) = app.state.library_snapshot();
    let can_delete = entries.len() > 1;

    for (index, entry) in entries.iter().enumerate() {
        let count = app.state.session(&entry.id).borrow().len();
        let type_label = scramble_type_label(
            entry
                .scramble_type
                .as_deref()
                .unwrap_or(SCRAMBLE_DEFAULT_TYPE),
        );
        let solves = crate::core::i18n::t(
            MessageKey::StatsSolves,
            &[("count", crate::core::i18n::Param::Number(count as f64))],
        );
        let row = adw::ActionRow::builder()
            .title(&entry.name)
            .subtitle(format!("{solves} · {type_label}"))
            .activatable(true)
            .build();
        row.set_use_markup(false);
        {
            let id = entry.id.clone();
            let slot = slot.clone();
            row.connect_activated(move |_| {
                with_app(&slot, |app| app.switch_session(&id));
            });
        }

        // The handle, not the row, starts the drag.
        let handle = gtk::Box::builder()
            .width_request(22)
            .height_request(22)
            .valign(gtk::Align::Center)
            .tooltip_text(t0(MessageKey::SessionManagerReorder))
            .css_classes(["dim-label"])
            .build();
        handle.append(&gtk::Image::from_icon_name("session-drag-handle-symbolic"));
        {
            let drag = gtk::DragSource::builder()
                .actions(gtk::gdk::DragAction::MOVE)
                .build();
            let id = entry.id.clone();
            drag.connect_prepare(move |_, _, _| {
                Some(gtk::gdk::ContentProvider::for_value(&id.to_value()))
            });
            handle.add_controller(drag);
        }
        row.add_prefix(&handle);

        {
            let target = gtk::DropTarget::new(String::static_type(), gtk::gdk::DragAction::MOVE);
            let row_ = row.clone();
            target.connect_enter(move |_, _, _| {
                row_.add_css_class(DROP_TARGET_CLASS);
                gtk::gdk::DragAction::MOVE
            });
            let row_ = row.clone();
            target.connect_leave(move |_| {
                row_.remove_css_class(DROP_TARGET_CLASS);
            });
            let id = entry.id.clone();
            let slot = slot.clone();
            let render = Rc::clone(render);
            let row_ = row.clone();
            let height_row = row.clone();
            target.connect_drop(move |_, value, _, y| {
                row_.remove_css_class(DROP_TARGET_CLASS);
                let Ok(dragged) = value.get::<String>() else {
                    return false;
                };
                if dragged == id {
                    return false;
                }
                let Some(app) = slot.borrow().clone() else {
                    return false;
                };
                let (entries, _) = app.state.library_snapshot();
                let Some(from) = entries.iter().position(|entry| entry.id == dragged) else {
                    return false;
                };
                // Dropping on the top half inserts before the row, the bottom
                // half after it; the source index is one clamp away.
                let after = y >= f64::from(height_row.height()) / 2.0;
                let mut to = index as isize + if after { 1 } else { 0 };
                if (from as isize) < to {
                    to -= 1;
                }
                app.move_session(&dragged, to);
                render();
                true
            });
            row.add_controller(target);
        }

        if entry.id == active {
            row.add_suffix(
                &gtk::Image::builder()
                    .icon_name("object-select-symbolic")
                    .tooltip_text(t0(MessageKey::SessionManagerCurrent))
                    .css_classes(["accent"])
                    .valign(gtk::Align::Center)
                    .build(),
            );
        }

        let rename = gtk::Button::builder()
            .icon_name("document-edit-symbolic")
            .tooltip_text(t0(MessageKey::SessionManagerRename))
            .css_classes(["flat"])
            .valign(gtk::Align::Center)
            .build();
        {
            let id = entry.id.clone();
            let name = entry.name.clone();
            let slot = slot.clone();
            rename.connect_clicked(move |_| {
                with_app(&slot, |app| app.rename_session(&id, &name));
            });
        }
        row.add_suffix(&rename);

        let remove = gtk::Button::builder()
            .icon_name("user-trash-symbolic")
            .tooltip_text(t0(MessageKey::SessionManagerDelete))
            .css_classes(["flat"])
            .valign(gtk::Align::Center)
            .sensitive(can_delete)
            .build();
        {
            let id = entry.id.clone();
            let name = entry.name.clone();
            let slot = slot.clone();
            let render = Rc::clone(render);
            remove.connect_clicked(move |_| {
                let Some(app) = slot.borrow().clone() else {
                    return;
                };
                let solve_count = app.state.session(&id).borrow().len();
                let slot = slot.clone();
                let id = id.clone();
                let render = Rc::clone(&render);
                confirm_delete(&app.window, &name, solve_count, move || {
                    with_app(&slot, |app| app.apply_delete_session(&id));
                    render();
                });
            });
        }
        row.add_suffix(&remove);

        group.add(&row);
        rows.borrow_mut().push(row.upcast());
    }
}
