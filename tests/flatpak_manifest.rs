//! The Flatpak manifest names the app the same way the app names itself.
//!
//! A Flatpak's application id is what the window exports and what the
//! launcher entry is matched against, so a manifest with a different id
//! installs a second, unrelated application that no running window pairs
//! with. The binary is `command`, which has to be the name Cargo installs.

use std::path::{Path, PathBuf};

use puzzle_timer::platform::meta::APP_ID;

fn manifest() -> serde_json::Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("packaging/flatpak")
        .join(format!("{APP_ID}.json"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!(
            "{}: {error} — the Flatpak manifest is named after the application id",
            path.display()
        )
    });
    serde_json::from_str(&text).expect("the Flatpak manifest is JSON")
}

#[test]
fn the_manifest_is_named_and_identified_by_the_application_id() {
    assert_eq!(manifest()["app-id"], APP_ID);
    assert!(data_file_exists(format!("{APP_ID}.json")));
}

#[test]
fn the_manifest_runs_the_binary_we_install() {
    assert_eq!(manifest()["command"], env!("CARGO_PKG_NAME"));
}

#[test]
fn the_manifest_builds_the_tree_it_ships() {
    let modules = manifest()["modules"].as_array().expect("modules").clone();
    let app = modules
        .iter()
        .find(|module| module["name"] == env!("CARGO_PKG_NAME"))
        .expect("the app module");
    assert_eq!(
        app["sources"][0]["type"], "dir",
        "a local build packages the tree"
    );
}

fn data_file_exists(name: String) -> bool {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("packaging/flatpak")
        .join(name)
        .is_file()
}
