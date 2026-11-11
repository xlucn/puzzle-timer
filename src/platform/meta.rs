//! App metadata.
//!
//! The version has one home: `Cargo.toml`, read back at compile time. The
//! changelog is embedded too, because the About dialog parses its release
//! notes from it and a packaged binary should not depend on a data file for
//! that.

/// The application id; the desktop file and icon names derive from it.
pub const APP_ID: &str = "io.github.xlucn.PuzzleTimer";

/// The version from `Cargo.toml`, never a literal.
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// The changelog, embedded at build time.
pub const CHANGELOG: &str = include_str!("../../CHANGELOG.md");

#[cfg(test)]
mod tests {
    use super::APP_VERSION;

    #[test]
    fn version_is_semver() {
        let parts: Vec<&str> = APP_VERSION.split('.').collect();
        assert_eq!(parts.len(), 3, "version must be X.Y.Z: {APP_VERSION}");
        assert!(
            parts.iter().all(|part| part.parse::<u32>().is_ok()),
            "version must be numeric: {APP_VERSION}"
        );
    }

    #[test]
    fn changelog_is_embedded() {
        assert!(super::CHANGELOG.contains("# Changelog"));
    }
}
