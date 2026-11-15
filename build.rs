//! The two build steps outside Cargo: Blueprint templates and gettext catalogs.
//!
//! `blueprint-compiler` and `msgfmt` (gettext) must be on `PATH` — Arch:
//! `blueprint-compiler` and `gettext`. Both write into `OUT_DIR`, so the
//! source tree never carries a generated file and `cargo build` alone stays
//! enough to run the app.

use std::path::{Path, PathBuf};
use std::process::Command;

/// Every `.blp` a widget loads, relative to the crate root.
const BLUEPRINTS: &[(&str, &str)] = &[("src/ui/solve_editor.blp", "solve_editor.ui")];

/// The text domain, which is also the name of each `.mo`.
const DOMAIN: &str = "puzzle-timer";

fn main() {
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR is set by Cargo"));
    compile_blueprints(&out_dir);
    compile_catalogs(&out_dir);
}

fn compile_blueprints(out_dir: &Path) {
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

/// Compiles every `po/<language>.po` into `OUT_DIR/locale`, the directory
/// `platform::i18n` reads when the app was not installed by Meson.
fn compile_catalogs(out_dir: &Path) {
    println!("cargo:rerun-if-changed=po/LINGUAS");
    for language in languages() {
        let source = format!("po/{language}.po");
        println!("cargo:rerun-if-changed={source}");

        let directory = out_dir.join("locale").join(&language).join("LC_MESSAGES");
        std::fs::create_dir_all(&directory).expect("could not create the locale directory");

        let status = Command::new("msgfmt")
            .args(["--check", "--output-file"])
            .arg(directory.join(format!("{DOMAIN}.mo")))
            .arg(&source)
            .status()
            .unwrap_or_else(|error| {
                panic!(
                    "could not run msgfmt ({error}).\n\
                     It compiles {source}; install gettext to build, e.g. `pacman -S gettext`."
                )
            });
        assert!(status.success(), "msgfmt failed on {source}");
    }
}

/// The languages in `po/LINGUAS`, one per line, `#` for comments.
fn languages() -> Vec<String> {
    std::fs::read_to_string("po/LINGUAS")
        .expect("po/LINGUAS lists the catalogs to compile")
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(str::to_string)
        .collect()
}
