//! The session dialogs: name a session, and confirm its deletion.

use std::rc::Rc;

use gtk4 as gtk;
use gtk4::prelude::*;
use libadwaita as adw;
use libadwaita::prelude::*;

use crate::core::i18n::{MessageKey, Param, t, t0};
use crate::core::session_library::{MAX_NAME_LENGTH, NameError};

/// Decides whether a typed name may be accepted, and why not when it may not.
pub type NameValidator = Rc<dyn Fn(&str) -> Option<NameError>>;

fn name_error_message(error: NameError) -> String {
    match error {
        NameError::Empty => t0(MessageKey::SessionErrorName),
        NameError::Long => t(
            MessageKey::SessionErrorLong,
            &[("count", Param::Number(MAX_NAME_LENGTH as f64))],
        ),
        NameError::Duplicate => t0(MessageKey::SessionErrorTaken),
    }
}

/// Ask for a session name. `validate` decides whether the typed value may be
/// accepted, so the dialog and the library can never disagree.
pub fn prompt_name(
    parent: &impl IsA<gtk::Widget>,
    heading: &str,
    initial: &str,
    validate: NameValidator,
    on_accept: impl Fn(String) + 'static,
) {
    let dialog = adw::Dialog::builder()
        .title(heading)
        .content_width(360)
        .build();

    let header = adw::HeaderBar::new();
    let cancel = gtk::Button::with_label(&t0(MessageKey::CommonCancel));
    let accept = gtk::Button::builder()
        .label(t0(MessageKey::CommonSave))
        .css_classes(["suggested-action"])
        .sensitive(false)
        .build();
    header.pack_start(&cancel);
    header.pack_end(&accept);

    let entry = gtk::Entry::builder()
        .text(initial)
        .max_length(MAX_NAME_LENGTH as i32)
        .activates_default(true)
        .hexpand(true)
        .build();
    let error = gtk::Label::builder()
        .xalign(0.0)
        .wrap(true)
        .css_classes(["caption", "error"])
        .visible(false)
        .build();

    let content = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(8)
        .margin_top(12)
        .margin_bottom(12)
        .margin_start(12)
        .margin_end(12)
        .build();
    content.append(&entry);
    content.append(&error);

    let toolbar = adw::ToolbarView::new();
    toolbar.add_top_bar(&header);
    toolbar.set_content(Some(&content));
    dialog.set_child(Some(&toolbar));

    // Show why a name is unusable while it is typed — the library's own rule,
    // so the dialog cannot enable a value the library would refuse.
    {
        let accept = accept.clone();
        let error = error.clone();
        entry.connect_changed(move |entry| match validate(entry.text().as_str()) {
            None => {
                accept.set_sensitive(true);
                error.set_visible(false);
            }
            Some(reason) => {
                accept.set_sensitive(false);
                error.set_label(&name_error_message(reason));
                error.set_visible(true);
            }
        });
    }

    {
        let dialog = dialog.clone();
        cancel.connect_clicked(move |_| {
            dialog.close();
        });
    }

    let on_accept: Rc<dyn Fn(String)> = Rc::new(on_accept);
    {
        let dialog = dialog.clone();
        let entry = entry.clone();
        let on_accept = Rc::clone(&on_accept);
        accept.connect_clicked(move |_| {
            on_accept(entry.text().to_string());
            dialog.close();
        });
    }
    wire_entry_activate(&entry, &dialog, &on_accept);

    dialog.present(Some(parent));
    entry.grab_focus();
}

/// Enter in the entry accepts, like the button.
fn wire_entry_activate(entry: &gtk::Entry, dialog: &adw::Dialog, on_accept: &Rc<dyn Fn(String)>) {
    let dialog = dialog.clone();
    let entry = entry.clone();
    let on_accept = Rc::clone(on_accept);
    entry.connect_activate(move |entry| {
        if entry.text().trim().is_empty() {
            return;
        }
        on_accept(entry.text().to_string());
        dialog.close();
    });
}

/// Confirm deleting a session; `on_accept` runs for the destructive response.
pub fn confirm_delete(
    parent: &impl IsA<gtk::Widget>,
    name: &str,
    solve_count: usize,
    on_accept: impl Fn() + 'static,
) {
    let body = if solve_count == 0 {
        t0(MessageKey::SessionDeleteEmpty)
    } else {
        t(
            MessageKey::SessionDeleteBody,
            &[("count", Param::Number(solve_count as f64))],
        )
    };
    let dialog = adw::AlertDialog::builder()
        .heading(t(
            MessageKey::SessionDeleteTitle,
            &[("name", Param::Text(name))],
        ))
        .body(body)
        .build();
    dialog.add_response("cancel", &t0(MessageKey::CommonCancel));
    dialog.add_response("delete", &t0(MessageKey::CommonDelete));
    dialog.set_response_appearance("delete", adw::ResponseAppearance::Destructive);
    dialog.set_default_response(Some("cancel"));
    dialog.set_close_response("cancel");

    let on_accept = Rc::new(on_accept);
    dialog.connect_response(None, move |dialog: &adw::AlertDialog, response: &str| {
        if response == "delete" {
            on_accept();
        }
        dialog.close();
    });
    dialog.present(Some(parent));
}
