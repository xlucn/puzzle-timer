//! The keyboard reference.
//!
//! An `Adw.ShortcutsDialog` listing the app's bindings, grouped by area.
//! Keep it in sync with the accelerators in `ui/mod.rs` — an accelerator the
//! dialog does not list is a binding nobody can discover.

use gtk4 as gtk;
use libadwaita as adw;
use libadwaita::prelude::*;

use crate::core::i18n::{MessageKey, t0};

pub fn open(parent: &impl IsA<gtk::Widget>) {
    let dialog = adw::ShortcutsDialog::builder()
        .title(t0(MessageKey::ShortcutsTitle))
        .build();

    let section = |title: MessageKey, entries: &[(MessageKey, &str)]| {
        let group = adw::ShortcutsSection::new(Some(&t0(title)));
        for (description, accelerator) in entries {
            group.add(adw::ShortcutsItem::new(&t0(*description), accelerator));
        }
        dialog.add(group);
    };

    section(
        MessageKey::ShortcutsGroupTimer,
        &[
            (MessageKey::ShortcutsStartStop, "space"),
            (MessageKey::ShortcutsCancelInspection, "Escape"),
        ],
    );
    section(
        MessageKey::ShortcutsGroupScramble,
        &[
            (MessageKey::ShortcutsCopyScramble, "<Control>c"),
            (MessageKey::ShortcutsSidebar, "<Control>b"),
        ],
    );
    section(
        MessageKey::ShortcutsGroupList,
        &[
            (MessageKey::ShortcutsDeleteSolves, "Delete"),
            (MessageKey::ShortcutsEditSolve, "<Control>e"),
            (MessageKey::ShortcutsClearPenalty, "<Control>1"),
            (MessageKey::ShortcutsPlus2, "<Control>2"),
            (MessageKey::ShortcutsDnf, "<Control>3"),
        ],
    );
    section(
        MessageKey::ShortcutsGroupSessions,
        &[
            (MessageKey::ShortcutsNewSession, "<Control>n"),
            (MessageKey::ShortcutsRenameSession, "F2"),
            (MessageKey::ShortcutsSessionMenu, "<Control>s"),
            (MessageKey::ShortcutsSessionManager, "<Control>m"),
            (MessageKey::ShortcutsDeleteSession, "<Control>Delete"),
        ],
    );
    section(
        MessageKey::ShortcutsGroupData,
        &[
            (MessageKey::ShortcutsImportData, "<Control>o"),
            (MessageKey::ShortcutsExportData, "<Control><Shift>s"),
        ],
    );
    section(
        MessageKey::ShortcutsGroupGeneral,
        &[
            (MessageKey::ShortcutsStatistics, "<Control>t"),
            (MessageKey::ShortcutsPreferences, "<Control>comma"),
            (MessageKey::ShortcutsFullscreen, "F11"),
            (MessageKey::ShortcutsKeyboard, "<Control>question"),
            (MessageKey::ShortcutsQuit, "<Control>q"),
        ],
    );

    dialog.present(Some(parent));
}
