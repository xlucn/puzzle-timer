//! The launcher entry, checked against the application id.
//!
//! A window exports the application id — `_GTK_APPLICATION_ID` on X11, the
//! xdg-toplevel app id on Wayland — and the shell pairs it with the `.desktop`
//! file of the same basename. With a different name the dash, the taskbar and
//! the About icon area fall back to a generic icon, which is what M16's first
//! install showed. The entry's `Icon=` has to name an icon we ship for the
//! same reason.
//!
//! `data/` is not part of the crate, so this is an integration test: it reads
//! the source tree rather than installed files.

use std::path::{Path, PathBuf};

use puzzle_timer::platform::meta::APP_ID;

fn data() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("data")
}

fn entry() -> String {
    let path = data().join(format!("{APP_ID}.desktop"));
    std::fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!(
            "{}: {error} — the shell matches a window to a .desktop file by the application id, \
             so the entry has to carry that name",
            path.display()
        )
    })
}

#[test]
fn the_entry_is_named_after_the_application_id() {
    assert!(data().join(format!("{APP_ID}.desktop")).is_file());
}

#[test]
fn the_entry_starts_the_binary_we_install() {
    let text = entry();
    let exec = format!("Exec={}", env!("CARGO_PKG_NAME"));
    assert!(
        text.lines().any(|line| line == exec),
        "the entry runs {exec}: Cargo's package name is the installed binary"
    );
}

#[test]
fn the_entry_names_the_icons_we_ship() {
    let text = entry();
    let icon = text
        .lines()
        .find_map(|line| line.strip_prefix("Icon="))
        .expect("the entry has no Icon=");

    for (directory, suffix) in [("scalable/apps", ""), ("symbolic/apps", "-symbolic")] {
        let path = data()
            .join("icons/hicolor")
            .join(directory)
            .join(format!("{icon}{suffix}.svg"));
        assert!(
            path.is_file(),
            "Icon={icon} needs {}, because that is what the shell draws",
            path.display()
        );
    }
}
