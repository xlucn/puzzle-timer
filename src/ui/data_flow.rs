use super::*;

impl App {
    pub(super) fn import_data(&self) {
        let dialog = gtk::FileDialog::builder()
            .title(t0(MessageKey::TransferImportTitle))
            .build();
        let slot = self.slot.clone();
        dialog.open(
            Some(&self.window),
            None::<&gtk::gio::Cancellable>,
            move |result| {
                let Ok(file) = result else {
                    return;
                };
                let Some(path) = file.path() else {
                    return;
                };
                let text = match crate::platform::transfer::read_text(&path) {
                    Ok(text) => text,
                    Err(error) => {
                        eprintln!("[import] {}: {error}", path.display());
                        with_app(&slot, |app| {
                            app.toast_overlay
                                .add_toast(adw::Toast::new(&t0(MessageKey::TransferImportFailed)))
                        });
                        return;
                    }
                };
                with_app(&slot, |app| app.apply_import(&text));
            },
        );
    }

    pub(super) fn apply_import(&self, text: &str) {
        let parsed = match crate::core::cs_timer_format::parse_cs_timer_data(text) {
            Ok(parsed) => parsed,
            Err(error) => {
                eprintln!("[import] {error}");
                self.toast_overlay
                    .add_toast(adw::Toast::new(&t0(MessageKey::TransferImportFailed)));
                return;
            }
        };
        for warning in &parsed.warnings {
            eprintln!("[import] {warning}");
        }
        let state = Rc::clone(&self.state);
        let summary = self.state.with_library(|library| {
            crate::core::session_import::import_into_library(
                library,
                &parsed.sessions,
                &mut |entry, solves| state.seed_session(&entry.id, solves.to_vec()),
            )
        });
        if summary.session_count == 0 {
            self.toast_overlay
                .add_toast(adw::Toast::new(&t0(MessageKey::TransferImportFailed)));
            return;
        }
        self.state.save_library_index();
        self.after_session_change();
        self.state.flush();
        let sessions = t(
            MessageKey::TransferImportSessions,
            &[("count", Param::Number(summary.session_count as f64))],
        );
        let solves = t(
            MessageKey::TransferImportSolves,
            &[("count", Param::Number(summary.solve_count as f64))],
        );
        self.toast_overlay.add_toast(adw::Toast::new(&t(
            MessageKey::TransferImportDone,
            &[
                ("sessions", Param::Text(&sessions)),
                ("solves", Param::Text(&solves)),
            ],
        )));
    }

    pub(super) fn export_data(&self) {
        let dialog = gtk::FileDialog::builder()
            .title(t0(MessageKey::TransferExportTitle))
            .initial_name("puzzle-timer.json")
            .build();
        let slot = self.slot.clone();
        dialog.save(
            Some(&self.window),
            None::<&gtk::gio::Cancellable>,
            move |result| {
                let Ok(file) = result else {
                    return;
                };
                let Some(path) = file.path() else {
                    return;
                };
                with_app(&slot, |app| app.write_export(&path));
            },
        );
    }

    pub(super) fn write_export(&self, path: &std::path::Path) {
        let (entries, _) = self.state.library_snapshot();
        let sessions: Vec<_> = entries
            .iter()
            .map(|entry| {
                (
                    entry.clone(),
                    self.state.session(&entry.id).borrow().solves().to_vec(),
                )
            })
            .collect();
        let exports: Vec<crate::core::cs_timer_format::ExportSession<'_>> = sessions
            .iter()
            .map(
                |(entry, solves)| crate::core::cs_timer_format::ExportSession {
                    name: &entry.name,
                    scramble_type: entry.scramble_type.as_deref(),
                    solves,
                },
            )
            .collect();
        let data = crate::core::cs_timer_format::format_cs_timer_data(&exports);
        match crate::platform::transfer::write_text(path, &data) {
            Ok(()) => {
                let name = path
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_default();
                self.toast_overlay.add_toast(adw::Toast::new(&t(
                    MessageKey::TransferExportDone,
                    &[("name", Param::Text(&name))],
                )));
            }
            Err(error) => {
                eprintln!("[export] {}: {error}", path.display());
                self.toast_overlay
                    .add_toast(adw::Toast::new(&t0(MessageKey::TransferExportFailed)));
            }
        }
    }
}
