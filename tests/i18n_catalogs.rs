//! The catalogs, checked as data.
//!
//! Typed catalogs made a missing translation a compile error; gettext falls
//! back to the English msgid instead, so this file is what now proves that
//! every key is translated, that no translation lost a placeholder, and that
//! the template still matches `src/locales/en.rs` (the msgid table). It also
//! checks that `t()` reads the installed catalog — with a stand-in, so it needs
//! no locale and no `.mo`.

use std::collections::HashSet;

use puzzle_timer::core::i18n::{Message, MessageKey, Param, Translator, install, t, t0};
use puzzle_timer::core::scramble_types::{scramble_groups, scramble_sections};
use puzzle_timer::locales::en;

/// The Chinese catalog, as translators edit it.
const PO: &str = include_str!("../po/zh_CN.po");

/// The template `cargo run --bin i18n_pot` writes from the English catalog.
const POT: &str = include_str!("../po/puzzle-timer.pot");

/// One message of a PO file.
#[derive(Debug, Default)]
struct Entry {
    msgid: String,
    msgid_plural: Option<String>,
    msgstr: Vec<String>,
    /// Set by the first `msgid`, so the header (which starts at `msgid ""`)
    /// and the rest are told apart.
    started: bool,
}

impl Entry {
    fn translation(&self) -> &str {
        self.msgstr.first().map_or("", String::as_str)
    }
}

/// The English msgid (and `msgid_plural`) a key answers.
fn english(key: MessageKey) -> (&'static str, Option<&'static str>) {
    match en::message(key) {
        Message::Text(text) => (text, None),
        Message::Plural {
            one: Some(one),
            other,
        } => (one, Some(other)),
        Message::Plural { one: None, other } => (other, None),
    }
}

/// Every message of a PO file, header included.
fn parse_po(text: &str) -> Vec<Entry> {
    let mut messages: Vec<Entry> = Vec::new();
    let mut field = Field::Msgid;
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(rest) = line.strip_prefix("msgid_plural ") {
            messages
                .last_mut()
                .expect("msgid_plural before msgid")
                .msgid_plural = Some(unquote(rest));
            field = Field::Plural;
        } else if let Some(rest) = line.strip_prefix("msgstr[") {
            let (index, rest) = rest.split_once(']').expect("msgstr[n]");
            let index: usize = index.parse().expect("a plural index");
            field = Field::Str(index);
            let entry = messages.last_mut().expect("msgstr before msgid");
            entry.msgstr.resize(index + 1, String::new());
            entry.msgstr[index] = unquote(rest.trim());
        } else if let Some(rest) = line.strip_prefix("msgstr ") {
            messages.last_mut().expect("msgstr before msgid").msgstr = vec![unquote(rest)];
            field = Field::Str(0);
        } else if let Some(rest) = line.strip_prefix("msgid ") {
            messages.push(Entry {
                msgid: unquote(rest),
                started: true,
                ..Entry::default()
            });
            field = Field::Msgid;
        } else if line.starts_with('"') {
            let more = unquote(line);
            let entry = messages.last_mut().expect("continuation before msgid");
            match field {
                Field::Msgid => entry.msgid.push_str(&more),
                Field::Plural => entry
                    .msgid_plural
                    .as_mut()
                    .expect("plural continuation without msgid_plural")
                    .push_str(&more),
                Field::Str(index) => entry.msgstr[index].push_str(&more),
            }
        } else {
            panic!("unexpected line in a PO file: {line}");
        }
    }
    messages
}

enum Field {
    Msgid,
    Plural,
    Str(usize),
}

/// The body of a quoted PO string, with its escapes resolved.
fn unquote(text: &str) -> String {
    let text = text.trim();
    let inner = text
        .strip_prefix('"')
        .and_then(|text| text.strip_suffix('"'))
        .unwrap_or_else(|| panic!("not a quoted string: {text}"));
    let mut out = String::with_capacity(inner.len());
    let mut characters = inner.chars();
    while let Some(character) = characters.next() {
        if character != '\\' {
            out.push(character);
            continue;
        }
        match characters.next().expect("trailing backslash") {
            'n' => out.push('\n'),
            't' => out.push('\t'),
            'r' => out.push('\r'),
            '"' => out.push('"'),
            '\\' => out.push('\\'),
            other => panic!("unsupported escape \\{other}"),
        }
    }
    out
}

/// A PO file's real messages, without the header.
fn messages(text: &str) -> Vec<Entry> {
    parse_po(text)
        .into_iter()
        .filter(|entry| entry.started && !entry.msgid.is_empty())
        .collect()
}

/// The `{name}` placeholders of a string, sorted.
fn placeholders(text: &str) -> Vec<&str> {
    let mut names = Vec::new();
    let mut rest = text;
    while let Some(open) = rest.find('{') {
        let after = &rest[open + 1..];
        let Some(close) = after.find('}') else {
            break;
        };
        names.push(&after[..close]);
        rest = &after[close + 1..];
    }
    names.sort_unstable();
    names
}

#[test]
fn every_key_has_a_translation() {
    let catalogue = messages(PO);
    for key in MessageKey::ALL {
        let (msgid, plural) = english(key);
        let entry = catalogue.iter().find(|entry| entry.msgid == msgid);
        let entry = entry.unwrap_or_else(|| {
            panic!("{key:?}: {msgid:?} is missing from po/zh_CN.po — run `cargo run --bin i18n_pot` and `msgmerge --update po/zh_CN.po po/puzzle-timer.pot`")
        });
        assert_eq!(
            entry.msgid_plural.as_deref(),
            plural,
            "{key:?}: the catalog and the English table disagree about the plural"
        );
        assert!(
            !entry.translation().trim().is_empty(),
            "{key:?}: {msgid:?} has no Chinese text in po/zh_CN.po"
        );
    }
}

#[test]
fn translations_keep_the_placeholders() {
    for entry in messages(PO) {
        let translated = placeholders(entry.translation());
        match &entry.msgid_plural {
            None => assert_eq!(
                placeholders(&entry.msgid),
                translated,
                "{:?}: the translation lost or added a placeholder",
                entry.msgid
            ),
            // A language with a single plural form answers both counts from
            // one msgstr, so it may carry a placeholder only the plural msgid
            // has (`{count} solves deleted` vs `Solve deleted`) — but nothing
            // beyond the two English forms.
            Some(plural) => {
                let expected: HashSet<&str> = placeholders(&entry.msgid)
                    .into_iter()
                    .chain(placeholders(plural))
                    .collect();
                let translated: HashSet<&str> = translated.iter().copied().collect();
                assert!(
                    translated.is_subset(&expected),
                    "{:?}: the translation invents a placeholder",
                    entry.msgid
                );
                for name in placeholders(plural) {
                    assert!(
                        translated.contains(name),
                        "{:?}: the plural translation lost {{{name}}}",
                        entry.msgid
                    );
                }
            }
        }
    }
}

#[test]
fn the_template_still_matches_the_english_table() {
    let template = messages(POT);
    for key in MessageKey::ALL {
        let (msgid, plural) = english(key);
        let entry = template.iter().find(|entry| entry.msgid == msgid);
        let entry = entry.unwrap_or_else(|| {
            panic!("{key:?}: {msgid:?} is missing from po/puzzle-timer.pot — run `cargo run --bin i18n_pot`")
        });
        assert_eq!(entry.msgid_plural.as_deref(), plural, "{key:?}");
    }

    let mut english_ids: HashSet<&str> = MessageKey::ALL
        .into_iter()
        .map(|key| english(key).0)
        .collect();
    english_ids.extend(scramble_groups().iter().map(|group| group.name));
    english_ids.extend(scramble_sections().iter().map(|section| section.name));
    for entry in template {
        assert!(
            english_ids.contains(entry.msgid.as_str()),
            "{:?} is in the template but no longer in the English table",
            entry.msgid
        );
    }
}

#[test]
fn catalogue_groups_and_sections_are_translated() {
    let catalogue = messages(PO);
    let translated = |name: &str| catalogue.iter().any(|entry| entry.msgid == name);

    for group in scramble_groups() {
        assert!(translated(group.name), "group {:?}", group.name);
    }
    for section in scramble_sections() {
        assert!(translated(section.name), "section {:?}", section.name);
    }
}

#[test]
fn lookups_go_through_the_installed_catalog() {
    install(Translator {
        text: |msgid| format!("T({msgid})"),
        plural: |_one, _other, count| format!("P({count})"),
    });

    assert_eq!(t0(MessageKey::CommonCancel), "T(Cancel)");
    assert_eq!(t0(MessageKey::AppName), "T(Puzzle Timer)");
    assert_eq!(
        t(MessageKey::StatsSolves, &[("count", Param::Number(2.0))]),
        "P(2)"
    );
    // A plural key with no count asks for the plural form with a count of 0,
    // and the placeholders are still filled after the translation.
    assert_eq!(t(MessageKey::StatsDnf, &[]), "P(0)");
    assert_eq!(
        t(MessageKey::ListEditTitle, &[("number", Param::Number(7.0))]),
        "T(Edit solve #7)"
    );
}
