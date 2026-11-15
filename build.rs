//! Compiles the Blueprint sources into `.ui` files for `include_str!`.
//!
//! This is the one build step outside Cargo: `blueprint-compiler` must be on
//! `PATH` (Arch: `blueprint-compiler`). The `.ui` lands in `OUT_DIR`, so the
//! source tree never carries a generated file and `cargo build` alone stays
//! enough to run the app.

use std::path::PathBuf;
use std::process::Command;

/// Every `.blp` a widget loads, relative to the crate root.
const BLUEPRINTS: &[(&str, &str)] = &[("src/ui/solve_editor.blp", "solve_editor.ui")];

fn main() {
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR is set by Cargo"));

    for (source, target) in BLUEPRINTS {
        println!("cargo:rerun-if-changed={source}");
        let output = out_dir.join(target);
        let status = Command::new("blueprint-compiler")
            .args(["compile", source, "--output"])
            .arg(&output)
            .status()
            .unwrap_or_else(|error| {
                panic!(
                    "could not run blueprint-compiler ({error}).\n\
                     It compiles {source}; install it to build, e.g. `pacman -S blueprint-compiler`."
                )
            });
        assert!(status.success(), "blueprint-compiler failed on {source}");
    }
}
