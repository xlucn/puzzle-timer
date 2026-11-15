use super::*;

impl App {
    pub(super) fn after_session_change(&self) {
        let (entries, active) = self.state.library_snapshot();
        self.sidebar.rebuild(&entries, &active);
        self.refresh_solves();

        let scramble_type = entries
            .iter()
            .find(|entry| entry.id == active)
            .and_then(|entry| entry.scramble_type.clone())
            .unwrap_or_else(|| SCRAMBLE_DEFAULT_TYPE.to_string());
        // An id the catalogue does not have (a hand-edited index) leaves the
        // type in force alone, exactly like the silent picker contract.
        if is_scramble_type(&scramble_type) {
            self.set_type(&scramble_type);
        }
        // `set_type` is a no-op when the type did not change, but the header
        // still has to name it on the first run and after a rename.
        self.update_type_title();
    }

    pub(super) fn switch_session(&self, id: &str) {
        let changed = self.state.with_library(|library| library.switch_to(id));
        if !changed {
            return;
        }
        self.state.save_library_index();
        self.after_session_change();
    }

    pub(super) fn new_session(&self) {
        let state = Rc::clone(&self.state);
        let validate =
            Rc::new(move |name: &str| state.with_library(|library| library.name_error(name, None)));
        let slot = self.slot.clone();
        prompt_name(
            &self.window,
            &t0(MessageKey::SessionNew),
            &t0(MessageKey::CommonCreate),
            &t0(MessageKey::SessionNewDescription),
            "",
            validate,
            move |name| {
                with_app(&slot, |app| app.create_session(&name));
            },
        );
    }

    pub(super) fn create_session(&self, name: &str) {
        let created = self
            .state
            .with_library(|library| library.create(name, None, true).map(|entry| entry.id));
        if created.is_none() {
            return;
        }
        self.state.save_library_index();
        // A brand-new session has no file yet: seed the cache so the list
        // reads it immediately instead of an empty file on disk.
        self.after_session_change();
    }

    pub(super) fn manage_sessions(&self) {
        super::session_manager::open(&self.window, self);
    }

    pub(super) fn rename_session(&self, id: &str, current: &str) {
        let state = Rc::clone(&self.state);
        let id = id.to_string();
        let validate = {
            let id = id.clone();
            Rc::new(move |name: &str| {
                state.with_library(|library| library.name_error(name, Some(&id)))
            })
        };
        let slot = self.slot.clone();
        prompt_name(
            &self.window,
            &t0(MessageKey::SessionRename),
            &t0(MessageKey::CommonRename),
            "",
            current,
            validate,
            move |name| {
                with_app(&slot, |app| app.apply_rename(&id, &name));
            },
        );
    }

    pub(super) fn apply_rename(&self, id: &str, name: &str) {
        if self.state.with_library(|library| library.rename(id, name)) {
            self.state.save_library_index();
            let (entries, active) = self.state.library_snapshot();
            self.sidebar.rebuild(&entries, &active);
        }
    }

    pub(super) fn apply_delete_session(&self, id: &str) {
        if self.state.with_library(|library| library.remove(id)) {
            self.state.forget_session(id);
            self.state.store().borrow_mut().delete_session_file(id);
            self.state.save_library_index();
            self.after_session_change();
        }
    }

    pub(super) fn move_session(&self, id: &str, to_index: isize) {
        if self
            .state
            .with_library(|library| library.move_entry(id, to_index))
        {
            self.state.save_library_index();
            let (entries, active) = self.state.library_snapshot();
            self.sidebar.rebuild(&entries, &active);
        }
    }

    /// Ctrl+S and the popover button share one path: close it if open, pop it
    /// if the button is on screen, and otherwise reveal the sidebar and pop it
    /// on the frame the button maps.
    pub(super) fn show_session_menu(&self) {
        if self.chrome_hidden.get() {
            return;
        }
        let button = &self.sidebar.session_button;
        if button.is_active() {
            button.popdown();
            return;
        }
        if button.is_mapped() {
            button.popup();
            return;
        }
        self.pending_menu_popup.set(true);
        self.sidebar_toggle.set_active(true);
    }

    pub(super) fn delete_active_session(&self) {
        let (entries, active) = self.state.library_snapshot();
        if entries.len() <= 1 {
            return;
        }
        let Some(entry) = entries.iter().find(|entry| entry.id == active) else {
            return;
        };
        let name = entry.name.clone();
        let id = entry.id.clone();
        let solve_count = self.state.session(&id).borrow().len();
        let slot = self.slot.clone();
        session_dialogs::confirm_delete(&self.window, &name, solve_count, move || {
            with_app(&slot, |app| app.apply_delete_session(&id));
        });
    }

    pub(super) fn rename_active(&self) {
        let (entries, active) = self.state.library_snapshot();
        if let Some(entry) = entries.iter().find(|entry| entry.id == active) {
            self.rename_session(&entry.id, &entry.name);
        }
    }
}
