//! The sidebar's header: which session is on show, and how to change it.

use std::cell::RefCell;
use std::rc::Rc;

use gtk4 as gtk;
use gtk4::prelude::*;

use crate::core::i18n::MessageKey;
use crate::core::i18n::t0;
use crate::core::session_library::SessionEntry;

pub struct SessionMenu {
    pub session_button: gtk::MenuButton,
    pub new_button: gtk::Button,
    pub manager_button: gtk::Button,
    list: gtk::ListBox,
    /// Ids in the same order as the list's rows.
    ids: RefCell<Vec<String>>,
    on_switch: Rc<dyn Fn(&str)>,
}

impl SessionMenu {
    pub fn new(
        on_switch: impl Fn(&str) + 'static,
        on_new: impl Fn() + 'static,
        on_manage: impl Fn() + 'static,
    ) -> Rc<Self> {
        let list = gtk::ListBox::builder()
            .selection_mode(gtk::SelectionMode::None)
            .css_classes(["navigation-sidebar"])
            .build();

        let popover = gtk::Popover::new();
        popover.set_child(Some(&list));

        let session_button = gtk::MenuButton::builder()
            .label("")
            .tooltip_text(t0(MessageKey::SessionTooltip))
            .popover(&popover)
            .css_classes(["flat"])
            .build();

        let new_button = gtk::Button::builder()
            .icon_name("list-add-symbolic")
            .tooltip_text(t0(MessageKey::SessionNewTooltip))
            .css_classes(["flat"])
            .build();
        let manager_button = gtk::Button::builder()
            .icon_name("view-more-symbolic")
            .tooltip_text(t0(MessageKey::SessionManagerTooltip))
            .css_classes(["flat"])
            .build();

        let menu = Rc::new(Self {
            session_button: session_button.clone(),
            new_button: new_button.clone(),
            manager_button: manager_button.clone(),
            list,
            ids: RefCell::new(Vec::new()),
            on_switch: Rc::new(on_switch),
        });

        new_button.connect_clicked(move |_| on_new());
        manager_button.connect_clicked(move |_| on_manage());

        {
            // Clone the list out of the struct: `connect_row_activated`
            // borrows it for the duration of the call, and the handler needs
            // the whole menu.
            let list = menu.list.clone();
            let menu = Rc::clone(&menu);
            list.connect_row_activated(move |_, row| {
                if let Some(id) = menu.ids.borrow().get(row.index() as usize) {
                    (menu.on_switch)(id);
                }
                menu.session_button.popdown();
            });
        }

        menu
    }

    /// Rebuild the popover from the library's current entries.
    pub fn rebuild(&self, entries: &[SessionEntry], active_id: &str) {
        while let Some(child) = self.list.first_child() {
            self.list.remove(&child);
        }

        let mut ids = Vec::with_capacity(entries.len());
        for entry in entries {
            let row = gtk::ListBoxRow::new();
            let label = gtk::Label::builder()
                .label(&entry.name)
                .xalign(0.0)
                .margin_top(8)
                .margin_bottom(8)
                .margin_start(12)
                .margin_end(12)
                .build();
            row.set_child(Some(&label));
            row.set_activatable(true);
            self.list.append(&row);
            ids.push(entry.id.clone());
        }
        *self.ids.borrow_mut() = ids;

        let active = entries
            .iter()
            .find(|entry| entry.id == active_id)
            .map(|entry| entry.name.clone())
            .unwrap_or_else(|| active_id.to_string());
        self.session_button.set_label(&active);
    }
}
