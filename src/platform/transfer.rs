//! Reading and writing a file the user picked in a file dialog.
//!
//! Import and export need one plain read and one plain write; they live here
//! rather than in `ui/` because only `platform/` touches the filesystem.
//! Unlike the store, these are not atomic: the user named the destination and
//! a half-written export is theirs to delete.

use std::io;
use std::path::Path;

/// Read a whole text file. csTimer exports are UTF-8 JSON.
pub fn read_text(path: &Path) -> io::Result<String> {
    std::fs::read_to_string(path)
}

/// Write a whole text file, truncating whatever was there.
pub fn write_text(path: &Path, text: &str) -> io::Result<()> {
    std::fs::write(path, text)
}
