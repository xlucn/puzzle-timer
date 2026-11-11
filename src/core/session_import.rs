//! Turn parsed csTimer sessions into library entries.
//!
//! The codec answers "what is in the file"; this module answers "how does it
//! become sessions here": one new session per file session, names deduped by
//! the library's own rules, the file's scramble type attached before the
//! single final switch, and the imported solves handed to a callback that
//! seeds the caller's session cache before any listener hears about the new
//! id.
//!
//! The callback runs inside `SessionLibrary::create`'s before-announce hook.
//! That ordering is load-bearing: the list subscribes to library changes, and
//! if it loaded the new id from disk first it would bind to an empty file that
//! the seed then replaces.

use super::cs_timer_format::ImportedSession;
use super::session::Solve;
use super::session_library::{MAX_NAME_LENGTH, SessionEntry, SessionLibrary};

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SessionImportSummary {
    pub session_count: usize,
    pub solve_count: usize,
    /// The first created session, made active at the end; `None` for an empty
    /// file.
    pub first_id: Option<String>,
}

/// A name the library will accept: trimmed, capped, and unique with a suffix.
fn unique_session_name(library: &SessionLibrary, raw: &str) -> String {
    let base: String = raw.trim().chars().take(MAX_NAME_LENGTH).collect();
    let base = if base.is_empty() {
        "Imported session".to_string()
    } else {
        base
    };
    if library.name_error(&base, None).is_none() {
        return base;
    }
    for suffix in 2.. {
        let tail = format!(" ({suffix})");
        let head: String = base
            .chars()
            .take(MAX_NAME_LENGTH.saturating_sub(tail.chars().count()))
            .collect();
        let candidate = format!("{head}{tail}");
        if library.name_error(&candidate, None).is_none() {
            return candidate;
        }
    }
    unreachable!("an unbounded suffix always finds a free name")
}

/// The parsed solves as this app's `Solve` records; ids start at 1.
fn imported_solves(imported: &ImportedSession) -> Vec<Solve> {
    imported
        .solves
        .iter()
        .enumerate()
        .map(|(index, solve)| Solve {
            id: index as u64 + 1,
            time_ms: solve.time_ms,
            scramble: solve.scramble.clone(),
            scramble_type: imported.scramble_type.clone(),
            created_at_ms: solve.created_at_ms,
            penalty: solve.penalty,
            comment: solve.comment.clone(),
        })
        .collect()
}

/// Create one session per imported session and make the first one active.
/// Returns what was created so the caller can report a summary.
///
/// `on_session` seeds the caller's cache; it runs before the library announces
/// each new entry.
pub fn import_into_library(
    library: &mut SessionLibrary,
    sessions: &[ImportedSession],
    on_session: &mut dyn FnMut(&SessionEntry, &[Solve]),
) -> SessionImportSummary {
    let mut first_id: Option<String> = None;
    let mut session_count = 0;
    let mut solve_count = 0;

    for imported in sessions {
        let solves = imported_solves(imported);
        let name = unique_session_name(library, &imported.name);
        let entry = library.create(
            &name,
            Some(&mut |created: &SessionEntry| on_session(created, &solves)),
            false,
        );
        let Some(entry) = entry else {
            continue;
        };
        // Attach the file's type before the final switch; a pre-type session
        // then opens on the type it was imported with.
        library.set_scramble_type(&entry.id, &imported.scramble_type);
        session_count += 1;
        solve_count += solves.len();
        if first_id.is_none() {
            first_id = Some(entry.id);
        }
    }

    if let Some(id) = &first_id {
        library.switch_to(id);
    }
    SessionImportSummary {
        session_count,
        solve_count,
        first_id,
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::rc::Rc;

    use super::*;
    use crate::core::cs_timer_format::ImportedSolve;
    use crate::core::session_library::LibraryChange;
    use crate::core::time::Penalty;

    fn imported() -> ImportedSession {
        ImportedSession {
            name: "Weekly".into(),
            scramble_type: "333".into(),
            rank: 1.0,
            solves: vec![ImportedSolve {
                time_ms: 12_345.0,
                scramble: "R U R'".into(),
                comment: Some("note".into()),
                created_at_ms: 1_700_000_000_000.0,
                penalty: Some(Penalty::Plus2),
            }],
        }
    }

    #[test]
    fn creates_one_session_per_file_session_in_order_and_activates_the_first() {
        let mut library = SessionLibrary::default();
        let seeds: Rc<RefCell<Vec<(String, usize)>>> = Rc::default();
        let sink = seeds.clone();

        let summary = import_into_library(
            &mut library,
            &[
                imported(),
                ImportedSession {
                    name: "4x4".into(),
                    scramble_type: "444wca".into(),
                    rank: 2.0,
                    solves: vec![
                        ImportedSolve {
                            time_ms: 60_000.0,
                            scramble: "Uw".into(),
                            comment: None,
                            created_at_ms: 1_700_000_100_000.0,
                            penalty: None,
                        },
                        ImportedSolve {
                            time_ms: 61_000.0,
                            scramble: "Fw".into(),
                            comment: None,
                            created_at_ms: 1_700_000_200_000.0,
                            penalty: None,
                        },
                    ],
                },
            ],
            &mut |entry, solves| sink.borrow_mut().push((entry.id.clone(), solves.len())),
        );

        assert_eq!(
            summary,
            SessionImportSummary {
                session_count: 2,
                solve_count: 3,
                first_id: Some("weekly".into()),
            }
        );
        assert_eq!(library.active_id(), "weekly");
        let names: Vec<&str> = library
            .entries()
            .iter()
            .map(|entry| entry.name.as_str())
            .collect();
        assert_eq!(names, vec!["Default", "Weekly", "4x4"]);
        assert_eq!(
            library
                .find("weekly")
                .and_then(|entry| entry.scramble_type.as_deref()),
            Some("333")
        );
        assert_eq!(
            library
                .find("4x4")
                .and_then(|entry| entry.scramble_type.as_deref()),
            Some("444wca")
        );
        assert_eq!(
            *seeds.borrow(),
            vec![("weekly".to_string(), 1), ("4x4".to_string(), 2)]
        );
    }

    #[test]
    fn seeds_the_session_before_the_library_announces_it() {
        let mut library = SessionLibrary::default();
        let seen: Rc<RefCell<usize>> = Rc::default();
        let sink = seen.clone();
        library.subscribe(move |_| *sink.borrow_mut() += 1);
        let hooked = Rc::new(RefCell::new(false));
        let hook_flag = hooked.clone();
        let announce_count = seen.clone();

        import_into_library(&mut library, &[imported()], &mut |_, _| {
            assert_eq!(*announce_count.borrow(), 0);
            *hook_flag.borrow_mut() = true;
        });

        assert!(*hooked.borrow());
        assert!(*seen.borrow() > 0);
    }

    #[test]
    fn switches_once_to_the_first_created_session() {
        let mut library = SessionLibrary::default();
        let changes: Rc<RefCell<Vec<LibraryChange>>> = Rc::default();
        let sink = changes.clone();
        library.subscribe(move |change| sink.borrow_mut().push(change.clone()));

        import_into_library(
            &mut library,
            &[
                imported(),
                ImportedSession {
                    name: "4x4".into(),
                    scramble_type: "444wca".into(),
                    rank: 2.0,
                    solves: Vec::new(),
                },
            ],
            &mut |_, _| {},
        );

        let switches = changes
            .borrow()
            .iter()
            .filter(|change| matches!(change, LibraryChange::Switched { .. }))
            .count();
        assert_eq!(switches, 1);
        assert_eq!(library.active_id(), "weekly");
    }

    #[test]
    fn dedupes_names_with_a_suffix_and_caps_them_at_the_library_limit() {
        let mut library = SessionLibrary::new(vec![SessionEntry::new("default", "Weekly")], None);
        let long = "n".repeat(MAX_NAME_LENGTH + 20);

        import_into_library(
            &mut library,
            &[
                imported(),
                imported(),
                ImportedSession {
                    name: long.clone(),
                    scramble_type: "333".into(),
                    rank: 3.0,
                    solves: Vec::new(),
                },
            ],
            &mut |_, _| {},
        );

        let capped = "n".repeat(MAX_NAME_LENGTH);
        let names: Vec<&str> = library
            .entries()
            .iter()
            .map(|entry| entry.name.as_str())
            .collect();
        assert_eq!(
            names,
            vec!["Weekly", "Weekly (2)", "Weekly (3)", capped.as_str()]
        );
    }

    #[test]
    fn copies_the_parsed_solves_with_ids_type_penalty_and_comment() {
        let mut library = SessionLibrary::default();
        let seen: Rc<RefCell<Vec<Solve>>> = Rc::default();
        let sink = seen.clone();

        import_into_library(&mut library, &[imported()], &mut |_, solves| {
            *sink.borrow_mut() = solves.to_vec();
        });

        assert_eq!(
            *seen.borrow(),
            vec![Solve {
                id: 1,
                time_ms: 12_345.0,
                scramble: "R U R'".into(),
                scramble_type: "333".into(),
                created_at_ms: 1_700_000_000_000.0,
                penalty: Some(Penalty::Plus2),
                comment: Some("note".into()),
            }]
        );
    }
}
