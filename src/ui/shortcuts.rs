//! The keyboard reference.
//!
//! An `Adw.ShortcutsDialog` listing the app's bindings, grouped by area.
//! Keep it in sync with the accelerators in `ui/mod.rs` and the timer/delete
//! keys there — an accelerator the dialog does not list is a binding nobody
//! can discover.
//!
//! Accelerators are GTK's parseable form, which `Adw.ShortcutLabel` renders
//! itself (e.g. `<Control>s` as "Ctrl+S"). GTK's key names are case-sensitive
//! gdk keyval names — `space`, not `Space`, and `<Control>question` for `?` —
//! and an unparsable accelerator silently renders as an empty chip.

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
        // The scramble is display-only, so this is how the text gets out —
        // beside refresh in the header, or here.
        &[(MessageKey::ShortcutsCopyScramble, "<Control>c")],
    );
    section(
        MessageKey::ShortcutsGroupList,
        &[
            // In a narrow window the list is a drawer over the content; Ctrl+B
            // is the way in and out at any size, and Escape is the drawer's way
            // out after anything else that wanted the key has had it.
            (MessageKey::ShortcutsSidebar, "<Control>b"),
            (MessageKey::ShortcutsHideDrawer, "Escape"),
            (MessageKey::ShortcutsDeleteSolves, "Delete"),
            (MessageKey::ShortcutsClearPenalty, "<Control>1"),
            (MessageKey::ShortcutsPlus2, "<Control>2"),
            (MessageKey::ShortcutsDnf, "<Control>3"),
            (MessageKey::ShortcutsEditSolve, "<Control>e"),
        ],
    );
    section(
        MessageKey::ShortcutsGroupSessions,
        &[
            (MessageKey::ShortcutsSessionMenu, "<Control>s"),
            (MessageKey::ShortcutsSessionManager, "<Control>m"),
            (MessageKey::ShortcutsNewSession, "<Control>n"),
            (MessageKey::ShortcutsRenameSession, "F2"),
            (MessageKey::ShortcutsDeleteSession, "<Control>Delete"),
        ],
    );
    section(
        MessageKey::StatsTitle,
        &[(MessageKey::ShortcutsStatistics, "<Control>t")],
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
            (MessageKey::ShortcutsKeyboard, "<Control>question"),
            (MessageKey::ShortcutsPreferences, "<Control>comma"),
            (MessageKey::ShortcutsFullscreen, "F11"),
            (MessageKey::ShortcutsQuit, "<Control>q"),
        ],
    );

    dialog.present(Some(parent));
}
