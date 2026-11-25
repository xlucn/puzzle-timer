use super::*;

impl App {
    /// Report the store's notices: each source has its own headline toast,
    /// and the detail has already gone to stderr. The sink makes every later
    /// one — a session file opened for the first time — toast when it happens.
    pub(super) fn toast_notices(&self) {
        let slot = self.slot.clone();
        self.state.set_notice_sink(Rc::new(move |kind| {
            with_app(&slot, |app| app.toast_notice(kind));
        }));
        for kind in self.state.take_notices() {
            self.toast_notice(kind);
        }
    }

    pub(super) fn toast_notice(&self, kind: NoticeKind) {
        let key = match kind {
            NoticeKind::SessionList => MessageKey::ToastSessionListUnreadable,
            NoticeKind::SessionFile => MessageKey::ToastSessionFileUnreadable,
            NoticeKind::Settings => MessageKey::ToastSettingsUnreadable,
        };
        let toast = adw::Toast::builder().title(t0(key)).timeout(10).build();
        self.toast_overlay.add_toast(toast);
    }

    pub(super) fn about(&self) {
        let dialog = adw::AboutDialog::builder()
            .application_name(t0(MessageKey::AppName))
            .application_icon(meta::APP_ID)
            .developer_name("Lu Xu")
            .version(meta::APP_VERSION)
            .website(meta::APP_REPOSITORY)
            .issue_url(meta::APP_ISSUES)
            .comments(t0(MessageKey::AppAboutComments))
            .copyright("© 2026 Lu Xu")
            .license_type(gtk::License::Gpl30)
            .build();
        if let Some(notes) = meta::release_notes_html() {
            dialog.set_release_notes(&notes);
            // The notes describe the released version, not the nightly label a
            // development build carries.
            dialog.set_release_notes_version(meta::CARGO_VERSION);
        }
        dialog.add_acknowledgement_section(
            Some(&t0(MessageKey::AppAboutBuiltWith)),
            &[
                "csTimer and cstimer_module by Shuang Chen",
                "GTK and libadwaita",
                "JavaScriptCore",
            ],
        );
        dialog.present(Some(&self.window));
    }
}
