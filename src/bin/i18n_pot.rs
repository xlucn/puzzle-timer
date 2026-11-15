//! Writes the gettext template from the English catalog.
//!
//! This is the project's `xgettext`: the msgids are `src/locales/en.rs`'s
//! values, so the template is generated from the same table the app reads
//! instead of scraped out of call sites. Run it after touching that table, then
//! fold the result into every translation:
//!
//! ```text
//! cargo run --bin i18n_pot
//! msgmerge --update po/zh_CN.po po/puzzle-timer.pot
//! ```
//!
//! Nothing runs this during a build: the `.po` files are source, and `msgfmt`
//! compiles them.

use std::fmt::Write as _;

use puzzle_timer::core::i18n::{Message, MessageKey};
use puzzle_timer::core::scramble_types::{scramble_groups, scramble_sections};
use puzzle_timer::locales::en;

/// The template's header. `POT-Creation-Date` is left out on purpose: a
/// checked-in template should not change just because it was regenerated.
const HEADER: &str = "\
# The message template for Puzzle Timer.
#
# Generated from the English catalog: `cargo run --bin i18n_pot`.
# Edit the English values in src/locales/en.rs, not this file, and merge the
# result into a translation with
# `msgmerge --update po/<language>.po po/puzzle-timer.pot`.
msgid \"\"
msgstr \"\"
\"Project-Id-Version: puzzle-timer\\n\"
\"MIME-Version: 1.0\\n\"
\"Content-Type: text/plain; charset=UTF-8\\n\"
\"Content-Transfer-Encoding: 8bit\\n\"

";

/// One message: a msgid, its plural if it has one, and where it is written.
struct Entry {
    msgid: String,
    plural: Option<String>,
    references: Vec<String>,
}

fn main() {
    let target = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "po/puzzle-timer.pot".to_string());
    let english = std::fs::read_to_string("src/locales/en.rs")
        .expect("run this from the crate root, where src/locales/en.rs lives");

    let mut entries: Vec<Entry> = Vec::new();
    for key in MessageKey::ALL {
        let (msgid, plural) = match en::message(key) {
            Message::Text(text) => (text, None),
            Message::Plural {
                one: Some(one),
                other,
            } => (one, Some(other)),
            Message::Plural { one: None, other } => (other, None),
        };
        let reference = reference_of(&english, key);

        // gettext identifies a message by its text: two keys that say the same
        // thing are one message, with two references.
        match entries.iter_mut().find(|entry| entry.msgid == msgid) {
            Some(entry) => {
                assert_eq!(
                    entry.plural.as_deref(),
                    plural,
                    "{msgid:?} is a plural in one place and not in another"
                );
                entry.references.push(reference);
            }
            None => entries.push(Entry {
                msgid: msgid.to_string(),
                plural: plural.map(str::to_string),
                references: vec![reference],
            }),
        }
    }

    // The picker's category and section names are msgids too: they are
    // catalogue identifiers that the UI reads through `t_group`/`t_section`,
    // and they are not part of the key table.
    for name in scramble_groups()
        .iter()
        .map(|group| group.name)
        .chain(scramble_sections().iter().map(|section| section.name))
    {
        match entries.iter_mut().find(|entry| entry.msgid == name) {
            Some(entry) => entry
                .references
                .push("src/core/scramble_types.rs".to_string()),
            None => entries.push(Entry {
                msgid: name.to_string(),
                plural: None,
                references: vec!["src/core/scramble_types.rs".to_string()],
            }),
        }
    }

    let mut out = String::from(HEADER);
    for entry in &entries {
        for reference in &entry.references {
            let _ = writeln!(out, "#: {reference}");
        }
        let _ = writeln!(out, "msgid {}", quoted(&entry.msgid));
        if let Some(plural) = &entry.plural {
            let _ = writeln!(out, "msgid_plural {}", quoted(plural));
            out.push_str("msgstr[0] \"\"\nmsgstr[1] \"\"\n");
        } else {
            out.push_str("msgstr \"\"\n");
        }
        out.push('\n');
    }

    std::fs::write(&target, out)
        .unwrap_or_else(|error| panic!("could not write {target}: {error}"));
    println!("{target}: {} messages", entries.len());
}

/// `src/locales/en.rs:<line>` for the arm that answers `key`.
fn reference_of(english: &str, key: MessageKey) -> String {
    let pattern = format!("MessageKey::{key:?} =>");
    let line = english
        .lines()
        .position(|line| line.trim_start().starts_with(&pattern))
        .map_or(0, |index| index + 1);
    format!("src/locales/en.rs:{line}")
}

/// A PO string literal: quotes, backslashes and line breaks escaped.
fn quoted(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for character in text.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            '\r' => out.push_str("\\r"),
            other => out.push(other),
        }
    }
    out.push('"');
    out
}
