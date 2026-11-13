//! The sidebar's header: which session is on show, and how to change it.
//!
//! One widget does both jobs: a `Gtk.MenuButton` whose label is the *current*
//! session's name — the sidebar header's title — with a `Gio.Menu` underneath
//! that lists every session as a radio item, followed by a second section
//! holding Rename / Delete. The menu items are stateful actions, so GTK
//! checks the active session itself. New is the header's own `+` button,
//! which drives the same action.
//!
//! Everything here is UI only: the dialogs live in `mod.rs` and mutate the
//! library; persistence belongs to whoever owns the store.

use std::rc::Rc;

use gtk4 as gtk;
use gtk4::prelude::*;
use libadwaita as adw;

use crate::core::i18n::{MessageKey, t0};
use crate::core::session_library::SessionEntry;

/// Longest session name shown in the sidebar title before it ellipsizes.
const SIDEBAR_NAME_CHARS: i32 = 20;

pub struct SessionMenu {
    pub session_button: gtk::MenuButton,
    pub new_button: gtk::Button,
    pub manager_button: gtk::Button,
    label: gtk::Label,
    switch_action: gtk::gio::SimpleAction,
    delete_action: gtk::gio::SimpleAction,
}

impl SessionMenu {
    pub fn new(
        application: &adw::Application,
        on_switch: impl Fn(&str) + 'static,
        on_new: impl Fn() + 'static,
        on_rename: impl Fn() + 'static,
        on_delete: impl Fn() + 'static,
        on_manage: impl Fn() + 'static,
    ) -> Rc<Self> {
        // The current session's name *is* the label: an icon would say "a menu
        // is here" but not "you are solving in Meet weekly". It is the
        // sidebar header's title, so it stays compact and ellipsizes at 20
        // characters instead of crowding the arrow.
        let label = gtk::Label::builder()
            .label("")
            .ellipsize(gtk::pango::EllipsizeMode::End)
            .max_width_chars(SIDEBAR_NAME_CHARS)
            .hexpand(true)
            .xalign(0.0)
            .build();

        let switch_action = gtk::gio::SimpleAction::new_stateful(
            "session-switch",
            Some(glib::VariantTy::STRING),
            &"".to_variant(),
        );
        {
            let on_switch = Rc::new(on_switch);
            switch_action.connect_activate(move |_, parameter| {
                if let Some(id) = parameter.and_then(|value| value.str()) {
                    on_switch(id);
                }
            });
        }
        application.add_action(&switch_action);

        let session_button = gtk::MenuButton::builder()
            .child(&label)
            // The child is custom, so the dropdown arrow has to be asked for.
            .always_show_arrow(true)
            .tooltip_text(t0(MessageKey::SessionTooltip))
            .css_classes(["flat"])
            .hexpand(true)
            .build();

        let new_action = gtk::gio::SimpleAction::new("session-new", None);
        new_action.connect_activate(move |_, _| on_new());
        application.add_action(&new_action);

        // The header's `+`: the menu's New item, moved out because the title
        // slot left the header nearly empty. Same action, so the button, the
        // accelerator and any future entry point cannot drift.
        let new_button = gtk::Button::builder()
            .icon_name("list-add-symbolic")
            .tooltip_text(t0(MessageKey::SessionNewTooltip))
            .css_classes(["flat"])
            .action_name("app.session-new")
            .build();

        // Rename and Delete act on the active session, so they need no
        // parameter; applying the action from the menu is the whole path.
        let rename_action = gtk::gio::SimpleAction::new("session-rename", None);
        rename_action.connect_activate(move |_, _| on_rename());
        application.add_action(&rename_action);

        let delete_action = gtk::gio::SimpleAction::new("session-delete", None);
        delete_action.connect_activate(move |_, _| on_delete());
        application.add_action(&delete_action);

        let manager_button = gtk::Button::builder()
            .icon_name("view-more-symbolic")
            .tooltip_text(t0(MessageKey::SessionManagerTooltip))
            .css_classes(["flat"])
            .build();
        manager_button.connect_clicked(move |_| on_manage());

        Rc::new(Self {
            session_button,
            new_button,
            manager_button,
            label,
            switch_action,
            delete_action,
        })
    }

    /// One idempotent pass: label, menu, radio state and availability.
    pub fn rebuild(&self, entries: &[SessionEntry], active_id: &str) {
        let active = entries
            .iter()
            .find(|entry| entry.id == active_id)
            .map(|entry| entry.name.clone())
            .unwrap_or_else(|| active_id.to_string());
        self.label.set_label(&active);

        // Two sections, so GTK draws the separator between the list and the
        // commands without any custom row machinery.
        let sessions = gtk::gio::Menu::new();
        for entry in entries {
            let item = gtk::gio::MenuItem::new(Some(&entry.name), None);
            // The target is the session id; the action is stateful, so both
            // the radio check and the switch read the same string.
            item.set_action_and_target_value(
                Some("app.session-switch"),
                Some(&entry.id.to_variant()),
            );
            sessions.append_item(&item);
        }

        let management = gtk::gio::Menu::new();
        management.append(
            Some(&t0(MessageKey::SessionRenameMenu)),
            Some("app.session-rename"),
        );
        management.append(
            Some(&t0(MessageKey::SessionDeleteMenu)),
            Some("app.session-delete"),
        );

        let menu = gtk::gio::Menu::new();
        menu.append_section(None, &sessions);
        menu.append_section(None, &management);
        self.session_button.set_menu_model(Some(&menu));

        self.switch_action.set_state(&active_id.to_variant());
        // The library refuses to empty itself — mirror that rather than
        // letting a dead Delete item sit in the menu.
        self.delete_action.set_enabled(entries.len() > 1);
    }
}
