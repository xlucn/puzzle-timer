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
/// accepted, so the dialog and the library can never disagree; the body shows
/// the dialog's own explanation until a validation message replaces it.
pub fn prompt_name(
    parent: &impl IsA<gtk::Widget>,
    heading: &str,
    accept_label: &str,
    body: &str,
    initial: &str,
    validate: NameValidator,
    on_accept: impl Fn(String) + 'static,
) {
    let entry = gtk::Entry::builder()
        .text(initial)
        .placeholder_text(t0(MessageKey::SessionName))
        // Enter submits: activates the dialog's default response instead of
        // needing a trip to the buttons.
        .activates_default(true)
        .max_length(MAX_NAME_LENGTH as i32)
        .build();

    let dialog = adw::AlertDialog::builder()
        .heading(heading)
        .body(body)
        .extra_child(&entry)
        .build();
    dialog.add_response("cancel", &t0(MessageKey::CommonCancel));
    dialog.add_response("accept", accept_label);
    dialog.set_response_appearance("accept", adw::ResponseAppearance::Suggested);
    dialog.set_default_response(Some("accept"));
    dialog.set_close_response("cancel");

    // Show why a name is unusable while it is typed — the library's own rule,
    // so the dialog cannot enable a value the library would refuse.
    let body = body.to_string();
    let sync = {
        let dialog = dialog.clone();
        let entry = entry.clone();
        move || match validate(entry.text().as_str()) {
            None => {
                dialog.set_response_enabled("accept", true);
                dialog.set_body(&body);
            }
            Some(reason) => {
                dialog.set_response_enabled("accept", false);
                dialog.set_body(&name_error_message(reason));
            }
        }
    };
    {
        let sync = sync.clone();
        entry.connect_changed(move |_| sync());
    }
    // The starting value needs the same pass: a new session opens empty, and
    // accepting that would ask the library for a name it refuses.
    sync();

    let on_accept: Rc<dyn Fn(String)> = Rc::new(on_accept);
    {
        let entry = entry.clone();
        let on_accept = Rc::clone(&on_accept);
        dialog.connect_response(None, move |_, response| {
            if response == "accept" {
                on_accept(entry.text().to_string());
            }
        });
    }

    dialog.present(Some(parent));
    // The default response button claims focus on map, so the caret would
    // land on the button instead of in the entry. Take it back after GTK's
    // own focus pass, with the current name selected so typing replaces it.
    let claim = {
        let entry = entry.clone();
        let initial = !initial.is_empty();
        move || {
            entry.grab_focus();
            if initial {
                entry.select_region(0, -1);
            }
        }
    };
    claim();
    glib::idle_add_local_once(claim);
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
