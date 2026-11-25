//! The AppStream entry is what a software centre, Flatseal and the store read
//! for the app's name, developer and version. Flatpak only shows those when
//! the metainfo is shipped and its id matches the application, and the latest
//! release is what fills the version, so a stale release list is a version
//! nobody can see.
//!
//! `data/` is not part of the crate, like `tests/desktop_entry.rs`.

use std::path::{Path, PathBuf};

use puzzle_timer::platform::meta::{APP_ID, CARGO_VERSION};

fn metainfo() -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("data")
        .join(format!("{APP_ID}.metainfo.xml"));
    std::fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!(
            "{}: {error} — a Flatpak with no metainfo shows an unknown name, \
             developer and version in Flatseal and in software centres",
            path.display()
        )
    })
}

#[test]
fn the_metainfo_describes_this_application() {
    let text = metainfo();
    assert!(
        text.contains(&format!("<id>{APP_ID}</id>")),
        "the component id has to be the application id"
    );
    assert!(
        text.contains(&format!(
            "<launchable type=\"desktop-id\">{APP_ID}.desktop</launchable>"
        )),
        "the launchable has to name the entry we install"
    );
}

#[test]
fn the_newest_release_is_the_version_we_build() {
    let text = metainfo();
    let newest = text
        .split("<release version=\"")
        .nth(1)
        .and_then(|rest| rest.split('"').next())
        .expect("no <release> element");
    assert_eq!(
        newest, CARGO_VERSION,
        "the first <release> is what the store shows as the app version"
    );
}

#[test]
fn the_metainfo_ships_with_the_app() {
    let meson = Path::new(env!("CARGO_MANIFEST_DIR")).join("data/meson.build");
    let text = std::fs::read_to_string(&meson).expect("data/meson.build");
    assert!(
        text.contains("metainfo.xml"),
        "data/meson.build installs the metainfo"
    );
}
