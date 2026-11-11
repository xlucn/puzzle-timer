//! The list of sessions *around* the solve lists.
//!
//! The library owns only metadata (`id` + `name` + the session's scramble
//! type) and which entry is active; the solves themselves stay in [`Session`]
//! and on disk (`src/platform/store.rs`), so everything below is
//! unit-testable.
//!
//! Identity vs. display:
//!   - `id` is the file name (`sessions/<id>.json`), so it is stable forever:
//!     renaming a session changes `name` only, and the file is never touched.
//!     It is derived from the name, lowercase and hyphenated ('Meet weekly' →
//!     'meet-weekly'), with a numeric suffix when that collides.
//!   - `name` is what the UI shows. Names are unique case-insensitively — the
//!     header lists them as a radio group, and two "Practice" rows would make
//!     that list useless.
//!
//! Invariant: the library is never empty. A fresh install constructs it with
//! no entries at all and gets a 'Default' session, so callers can always read
//! `active` without an `Option`; the last session cannot be deleted.
//!
//! Every mutation emits — `create()` emits created *and* switched, because a
//! new session also becomes the active one — and listeners are expected to do
//! one idempotent re-render per change rather than branching on the kind.
//!
//! [`Session`]: crate::core::session::Session

use unicode_normalization::UnicodeNormalization;
use unicode_normalization::char::is_combining_mark;

/// One session as the index on disk knows it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionEntry {
    /// File id: lowercase, hyphenated, unique, never changes.
    pub id: String,
    /// Display name: trimmed, non-empty, unique case-insensitively.
    pub name: String,
    /// The scramble type this session solves (e.g. `"444wca"`); `None` means
    /// the app default ([`SCRAMBLE_DEFAULT_TYPE`]). Remembered per session so
    /// switching restores the type dropdown.
    ///
    /// [`SCRAMBLE_DEFAULT_TYPE`]: crate::core::scramble_types::SCRAMBLE_DEFAULT_TYPE
    pub scramble_type: Option<String>,
}

impl SessionEntry {
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            scramble_type: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LibraryChange {
    Created(SessionEntry),
    Renamed(SessionEntry),
    Deleted(SessionEntry),
    Switched {
        id: String,
        previous_id: String,
    },
    /// The session's scramble type changed (the index save persists it).
    Retyped(SessionEntry),
    /// The entries were reordered; the index save persists the new order.
    Reordered,
}

/// Why a display name cannot be used (`except_id` aside).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NameError {
    Empty,
    Long,
    Duplicate,
}

type Listener = Box<dyn FnMut(&LibraryChange)>;
pub type ListenerId = u64;

/// Long enough for a real name, short enough for the header button.
pub const MAX_NAME_LENGTH: usize = 40;

/// Used when a name slugifies to nothing (e.g. a purely non-Latin name).
const FALLBACK_SLUG: &str = "session";

/// The file id for a name: lowercase, accents folded, everything that is not
/// a letter or digit collapsed into single hyphens. Empty result → the
/// fallback, which `unique_id()` then disambiguates like any other collision.
fn slugify(name: &str) -> String {
    let decomposed: String = name.nfkd().filter(|ch| !is_combining_mark(*ch)).collect();
    let mut slug = String::new();
    let mut pending_dash = false;
    for ch in decomposed.chars() {
        for lower in ch.to_lowercase() {
            if lower.is_ascii_lowercase() || lower.is_ascii_digit() {
                if pending_dash && !slug.is_empty() {
                    slug.push('-');
                }
                pending_dash = false;
                slug.push(lower);
            } else {
                pending_dash = true;
            }
        }
    }
    if slug.is_empty() {
        FALLBACK_SLUG.into()
    } else {
        slug
    }
}

pub struct SessionLibrary {
    items: Vec<SessionEntry>,
    current_id: String,
    listeners: Vec<(ListenerId, Listener)>,
    next_listener_id: ListenerId,
}

impl Default for SessionLibrary {
    fn default() -> Self {
        Self::new(Vec::new(), None)
    }
}

impl SessionLibrary {
    /// `active_id` is honoured only when it names one of `entries`; otherwise
    /// the first entry wins. Empty `entries` (fresh install) yields `Default`.
    pub fn new(entries: Vec<SessionEntry>, active_id: Option<&str>) -> Self {
        let mut items = entries;
        if items.is_empty() {
            items.push(SessionEntry::new("default", "Default"));
        }
        let current_id = active_id
            .filter(|id| items.iter().any(|entry| entry.id == *id))
            .unwrap_or(&items[0].id)
            .to_string();
        Self {
            items,
            current_id,
            listeners: Vec::new(),
            next_listener_id: 1,
        }
    }

    /// The sessions, in menu order (creation order, then the manager's
    /// reorder). Never empty.
    pub fn entries(&self) -> &[SessionEntry] {
        &self.items
    }

    /// The active session. Non-null by the invariant above.
    pub fn active(&self) -> &SessionEntry {
        self.find(&self.current_id).unwrap_or(&self.items[0])
    }

    pub fn active_id(&self) -> &str {
        &self.active().id
    }

    pub fn find(&self, id: &str) -> Option<&SessionEntry> {
        self.items.iter().find(|entry| entry.id == id)
    }

    pub fn is_active(&self, id: &str) -> bool {
        self.active_id() == id
    }

    /// Why `raw_name` cannot be used for a session (excluding `except_id` when
    /// renaming), or `None` when it is fine. The name dialog binds its own
    /// sensitivity and its message to this, so the UI and the library can
    /// never disagree about what is acceptable.
    pub fn name_error(&self, raw_name: &str, except_id: Option<&str>) -> Option<NameError> {
        let name = raw_name.trim();
        if name.is_empty() {
            return Some(NameError::Empty);
        }
        if name.chars().count() > MAX_NAME_LENGTH {
            return Some(NameError::Long);
        }
        let lowered = name.to_lowercase();
        let taken = self.items.iter().any(|entry| {
            Some(entry.id.as_str()) != except_id && entry.name.to_lowercase() == lowered
        });
        if taken {
            return Some(NameError::Duplicate);
        }
        None
    }

    /// Create a session, by default switching to it (a new session is what you
    /// wanted to work in). Returns the entry, or `None` when the name is
    /// unusable.
    ///
    /// `before_announce` runs after the entry is in the list but before any
    /// listener hears about it. The importer uses it to seed the new session
    /// in the caller's cache, so the first UI reaction already reads the
    /// imported solves rather than an empty file.
    ///
    /// `activate: false` creates without switching. An import uses it so a
    /// file with several sessions switches once at the end instead of once per
    /// session, which would queue a scramble for every type it passed through.
    pub fn create(
        &mut self,
        raw_name: &str,
        before_announce: Option<&mut dyn FnMut(&SessionEntry)>,
        activate: bool,
    ) -> Option<SessionEntry> {
        let name = raw_name.trim().to_string();
        if self.name_error(&name, None).is_some() {
            return None;
        }

        // A new session continues in the type you are solving right now —
        // creating "4x4 practice" from a 4x4 session must not snap the
        // dropdown back to the default.
        let id = self.unique_id(&name);
        let entry = SessionEntry {
            id,
            name,
            scramble_type: self.active().scramble_type.clone(),
        };
        self.items.push(entry.clone());
        if let Some(hook) = before_announce {
            hook(&entry);
        }
        self.emit(LibraryChange::Created(entry.clone()));
        if activate {
            self.switch_to(&entry.id);
        }
        Some(entry)
    }

    /// Give a session its own scramble type (the UI calls this when the user
    /// picks one). Emits `Retyped`; an unchanged value emits nothing — same
    /// rule as `Session::set_penalty`.
    pub fn set_scramble_type(&mut self, id: &str, scramble_type: &str) -> bool {
        let Some(index) = self.items.iter().position(|entry| entry.id == id) else {
            return false;
        };
        if self.items[index].scramble_type.as_deref() == Some(scramble_type) {
            return false;
        }
        let entry = SessionEntry {
            scramble_type: Some(scramble_type.to_string()),
            ..self.items[index].clone()
        };
        self.items[index] = entry.clone();
        self.emit(LibraryChange::Retyped(entry));
        true
    }

    /// Rename a session; the id (and so the file) is untouched.
    pub fn rename(&mut self, id: &str, raw_name: &str) -> bool {
        let Some(index) = self.items.iter().position(|entry| entry.id == id) else {
            return false;
        };
        let name = raw_name.trim().to_string();
        if self.name_error(&name, Some(id)).is_some() {
            return false;
        }

        // Replace, don't mutate: the caller handed us these values (the index
        // loader keeps its vector), and a shared half-renamed entry would leak.
        let entry = SessionEntry {
            name,
            ..self.items[index].clone()
        };
        self.items[index] = entry.clone();
        self.emit(LibraryChange::Renamed(entry));
        true
    }

    /// Move `id` to `to_index` in the menu order. The index is clamped to the
    /// list's bounds; moving a session to where it already is returns false and
    /// emits nothing. The active session stays active — reordering is display
    /// order, not a switch.
    pub fn move_entry(&mut self, id: &str, to_index: isize) -> bool {
        let Some(from) = self.items.iter().position(|entry| entry.id == id) else {
            return false;
        };
        let to = to_index.clamp(0, self.items.len() as isize - 1) as usize;
        if to == from {
            return false;
        }

        let entry = self.items.remove(from);
        self.items.insert(to, entry);
        self.emit(LibraryChange::Reordered);
        true
    }

    /// Delete a session. The last one is refused — an empty library would leave
    /// the timer with nowhere to record. Removing the active session moves the
    /// active flag to its neighbour (the next one, else the previous), so the
    /// caller always has a valid session to show afterwards.
    pub fn remove(&mut self, id: &str) -> bool {
        let Some(index) = self.items.iter().position(|entry| entry.id == id) else {
            return false;
        };
        if self.items.len() == 1 {
            return false;
        }

        let entry = self.items.remove(index);
        self.emit(LibraryChange::Deleted(entry));

        if self.current_id == id {
            let previous_id = id.to_string();
            self.current_id = self.items[index.min(self.items.len() - 1)].id.clone();
            self.emit(LibraryChange::Switched {
                id: self.current_id.clone(),
                previous_id,
            });
        }
        true
    }

    /// Make `id` active. Unknown id or no change → false, and no event.
    pub fn switch_to(&mut self, id: &str) -> bool {
        if self.is_active(id) || self.find(id).is_none() {
            return false;
        }
        let previous_id = std::mem::replace(&mut self.current_id, id.to_string());
        self.emit(LibraryChange::Switched {
            id: id.to_string(),
            previous_id,
        });
        true
    }

    pub fn subscribe(&mut self, listener: impl FnMut(&LibraryChange) + 'static) -> ListenerId {
        let id = self.next_listener_id;
        self.next_listener_id += 1;
        self.listeners.push((id, Box::new(listener)));
        id
    }

    pub fn unsubscribe(&mut self, id: ListenerId) {
        self.listeners.retain(|(each, _)| *each != id);
    }

    /// A file id for `name` that no entry is using.
    fn unique_id(&self, name: &str) -> String {
        let base = slugify(name);
        if self.find(&base).is_none() {
            return base;
        }
        for suffix in 2.. {
            let candidate = format!("{base}-{suffix}");
            if self.find(&candidate).is_none() {
                return candidate;
            }
        }
        unreachable!("an unbounded suffix always finds a free id")
    }

    fn emit(&mut self, change: LibraryChange) {
        let mut listeners = std::mem::take(&mut self.listeners);
        for (_, listener) in &mut listeners {
            listener(&change);
        }
        self.listeners = listeners;
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::rc::Rc;

    use super::*;

    fn entry(id: &str, name: &str) -> SessionEntry {
        SessionEntry::new(id, name)
    }

    fn one(name: &str) -> SessionLibrary {
        SessionLibrary::new(vec![entry("default", name)], None)
    }

    fn collect(library: &mut SessionLibrary) -> Rc<RefCell<Vec<LibraryChange>>> {
        let seen: Rc<RefCell<Vec<LibraryChange>>> = Rc::default();
        let sink = seen.clone();
        library.subscribe(move |change| sink.borrow_mut().push(change.clone()));
        seen
    }

    #[test]
    fn never_comes_up_empty() {
        let library = SessionLibrary::new(Vec::new(), None);
        assert_eq!(library.entries(), &[entry("default", "Default")]);
        assert_eq!(library.active(), &entry("default", "Default"));
    }

    #[test]
    fn honours_the_entries_and_active_id_from_the_index() {
        let library = SessionLibrary::new(
            vec![
                entry("default", "Default"),
                entry("meet-weekly", "Meet weekly"),
            ],
            Some("meet-weekly"),
        );
        assert_eq!(library.active_id(), "meet-weekly");
        assert_eq!(library.entries().len(), 2);
    }

    #[test]
    fn falls_back_to_the_first_entry_when_the_stored_active_id_is_gone() {
        let library = SessionLibrary::new(vec![entry("default", "Default")], Some("deleted"));
        assert_eq!(library.active_id(), "default");
        assert_eq!(
            SessionLibrary::new(Vec::new(), Some("anything")).active_id(),
            "default"
        );
    }

    #[test]
    fn stores_a_scramble_type_announcing_the_change_once() {
        let mut library = one("Default");
        let seen = collect(&mut library);

        assert!(library.set_scramble_type("default", "444wca"));
        assert_eq!(
            library
                .find("default")
                .and_then(|entry| entry.scramble_type.as_deref()),
            Some("444wca")
        );
        assert_eq!(seen.borrow().len(), 1);
        assert_eq!(
            seen.borrow()[0],
            LibraryChange::Retyped(SessionEntry {
                id: "default".into(),
                name: "Default".into(),
                scramble_type: Some("444wca".into()),
            })
        );

        // No event when nothing changed, and nothing for unknown ids.
        assert!(!library.set_scramble_type("default", "444wca"));
        assert!(!library.set_scramble_type("gone", "333"));
        assert_eq!(seen.borrow().len(), 1);
    }

    #[test]
    fn leaves_a_session_without_a_type() {
        let library = one("Default");
        assert_eq!(
            library
                .find("default")
                .and_then(|entry| entry.scramble_type.clone()),
            None
        );
        assert_eq!(library.entries(), &[entry("default", "Default")]);
    }

    #[test]
    fn a_new_session_inherits_the_type_you_are_solving() {
        let mut library = one("Default");
        library.set_scramble_type("default", "444wca");
        assert_eq!(
            library
                .create("4x4 practice", None, true)
                .and_then(|entry| entry.scramble_type),
            Some("444wca".into())
        );

        // A session created from a typeless one stays typeless.
        let mut fresh = SessionLibrary::new(vec![entry("a", "A")], Some("a"));
        assert_eq!(
            fresh
                .create("B", None, true)
                .and_then(|entry| entry.scramble_type),
            None
        );
    }

    #[test]
    fn adds_a_session_makes_it_active_and_announces_both_steps() {
        let mut library = one("Default");
        let seen = collect(&mut library);

        let created = library
            .create("  Meet weekly  ", None, true)
            .expect("valid name");

        assert_eq!(created, entry("meet-weekly", "Meet weekly"));
        assert_eq!(library.active_id(), "meet-weekly");
        assert_eq!(seen.borrow().len(), 2);
        assert_eq!(seen.borrow()[0], LibraryChange::Created(created));
        assert_eq!(
            seen.borrow()[1],
            LibraryChange::Switched {
                id: "meet-weekly".into(),
                previous_id: "default".into(),
            }
        );
    }

    #[test]
    fn runs_the_before_announce_hook_before_any_listener() {
        let mut library = one("Default");
        let seen = collect(&mut library);
        let mut hook_saw_entry = false;

        let created = library
            .create(
                "Imported",
                Some(&mut |created: &SessionEntry| {
                    assert!(seen.borrow().is_empty());
                    assert_eq!(created.id, "imported");
                    hook_saw_entry = true;
                }),
                true,
            )
            .expect("valid name");

        assert!(hook_saw_entry);
        assert_eq!(created.id, "imported");
        assert_eq!(seen.borrow().len(), 2);
    }

    #[test]
    fn can_create_without_switching() {
        let mut library = one("Default");
        let seen = collect(&mut library);

        let created = library.create("Side", None, false).expect("valid name");

        assert_eq!(library.active_id(), "default");
        assert_eq!(seen.borrow().len(), 1);
        assert_eq!(seen.borrow()[0], LibraryChange::Created(created));
    }

    #[test]
    fn derives_a_file_id_from_the_name_folding_accents() {
        let mut library = one("Default");
        assert_eq!(
            library
                .create("Café practice", None, true)
                .map(|entry| entry.id),
            Some("cafe-practice".into())
        );
    }

    #[test]
    fn falls_back_for_names_with_no_latin_letters_and_stays_unique() {
        let mut library = one("Default");
        assert_eq!(
            library.create("三盲", None, true).map(|entry| entry.id),
            Some("session".into())
        );
        assert_eq!(
            library.create("練習", None, true).map(|entry| entry.id),
            Some("session-2".into())
        );
    }

    #[test]
    fn suffixes_a_colliding_id_rather_than_reusing_one() {
        let mut library = one("Default");
        library.create("Meet weekly", None, true);
        library.create("Meet Weekly!", None, true);
        let ids: Vec<&str> = library
            .entries()
            .iter()
            .map(|entry| entry.id.as_str())
            .collect();
        assert_eq!(ids, vec!["default", "meet-weekly", "meet-weekly-2"]);
    }

    #[test]
    fn refuses_names_the_dialog_would_have_blocked() {
        let mut library = one("Default");
        let seen = collect(&mut library);
        let long = "x".repeat(MAX_NAME_LENGTH + 1);

        assert!(library.create("   ", None, true).is_none());
        assert!(library.create(&long, None, true).is_none());
        assert!(library.create("default", None, true).is_none());
        assert!(library.create("DEFAULT ", None, true).is_none());
        assert_eq!(library.entries().len(), 1);
        assert!(seen.borrow().is_empty());
    }

    #[test]
    fn reports_why_a_name_is_unusable() {
        let library = SessionLibrary::new(vec![entry("default", "Meet weekly")], None);
        let long = "x".repeat(MAX_NAME_LENGTH + 1);
        assert_eq!(library.name_error("  ", None), Some(NameError::Empty));
        assert_eq!(library.name_error(&long, None), Some(NameError::Long));
        assert_eq!(
            library.name_error("meet WEEKLY", None),
            Some(NameError::Duplicate)
        );
        assert_eq!(library.name_error("Something else", None), None);
    }

    #[test]
    fn lets_a_session_keep_its_own_name_when_renaming() {
        let library = SessionLibrary::new(vec![entry("default", "Meet weekly")], None);
        assert_eq!(library.name_error("Meet weekly", Some("default")), None);
        assert_eq!(
            library.name_error("Meet weekly", Some("other")),
            Some(NameError::Duplicate)
        );
    }

    #[test]
    fn changes_the_display_name_and_keeps_the_id() {
        let mut library = one("Default");
        let seen = collect(&mut library);

        assert!(library.rename("default", "  Practice  "));

        assert_eq!(library.entries(), &[entry("default", "Practice")]);
        assert_eq!(
            seen.borrow().as_slice(),
            &[LibraryChange::Renamed(entry("default", "Practice"))]
        );
        assert_eq!(library.active_id(), "default");
    }

    #[test]
    fn does_not_hand_out_a_shared_entry_to_its_caller() {
        let source = vec![entry("default", "Default")];
        let mut library = SessionLibrary::new(source.clone(), None);
        library.rename("default", "Renamed");
        assert_eq!(source[0].name, "Default"); // the loader's vector is untouched
        assert_eq!(library.active().name, "Renamed");
    }

    #[test]
    fn refuses_a_duplicate_blank_or_unknown_rename() {
        let mut library = SessionLibrary::new(
            vec![entry("default", "Default"), entry("b", "Practice")],
            None,
        );
        assert!(!library.rename("b", "default"));
        assert!(!library.rename("b", "   "));
        assert!(!library.rename("nope", "Fine"));
        assert_eq!(
            library.entries(),
            &[entry("default", "Default"), entry("b", "Practice")]
        );
    }

    #[test]
    fn accepts_a_rename_to_its_own_current_name() {
        let mut library = SessionLibrary::new(vec![entry("default", "Default")], None);
        assert!(library.rename("default", "Default "));
        assert_eq!(library.active().name, "Default");
    }

    #[test]
    fn refuses_to_delete_the_last_session() {
        let mut library = one("Default");
        let seen = collect(&mut library);

        assert!(!library.remove("default"));
        assert_eq!(library.entries().len(), 1);
        assert!(seen.borrow().is_empty());
    }

    #[test]
    fn refuses_to_delete_an_unknown_id() {
        assert!(!one("Default").remove("nope"));
    }

    #[test]
    fn moves_the_active_flag_to_the_next_session() {
        let mut library = SessionLibrary::new(
            vec![entry("a", "A"), entry("b", "B"), entry("c", "C")],
            Some("b"),
        );
        let seen = collect(&mut library);

        assert!(library.remove("b"));
        assert_eq!(library.active_id(), "c"); // the entry that slid into b's slot
        let seen = seen.borrow();
        assert_eq!(seen.len(), 2);
        assert!(matches!(seen[0], LibraryChange::Deleted(_)));
        assert_eq!(
            seen[1],
            LibraryChange::Switched {
                id: "c".into(),
                previous_id: "b".into(),
            }
        );
    }

    #[test]
    fn falls_back_to_the_previous_session_when_the_active_one_was_last() {
        let mut library = SessionLibrary::new(vec![entry("a", "A"), entry("b", "B")], Some("b"));
        library.remove("b");
        assert_eq!(library.active_id(), "a");
    }

    #[test]
    fn leaves_the_active_session_alone_when_another_is_deleted() {
        let mut library = SessionLibrary::new(vec![entry("a", "A"), entry("b", "B")], Some("a"));
        let seen = collect(&mut library);

        library.remove("b");

        assert_eq!(library.active_id(), "a");
        assert!(matches!(
            seen.borrow().as_slice(),
            [LibraryChange::Deleted(_)]
        ));
    }

    #[test]
    fn switches_and_announces_old_to_new() {
        let mut library = SessionLibrary::new(vec![entry("a", "A"), entry("b", "B")], None);
        let seen = collect(&mut library);

        assert!(library.switch_to("b"));
        assert_eq!(
            seen.borrow().as_slice(),
            &[LibraryChange::Switched {
                id: "b".into(),
                previous_id: "a".into(),
            }]
        );
    }

    #[test]
    fn does_nothing_for_an_unknown_id_or_the_active_session() {
        let mut library = one("Default");
        let seen = collect(&mut library);

        assert!(!library.switch_to("nope"));
        assert!(!library.switch_to("default"));
        assert_eq!(library.active_id(), "default");
        assert!(seen.borrow().is_empty());
    }

    #[test]
    fn stops_announcing_after_unsubscribe() {
        let mut library = SessionLibrary::new(vec![entry("a", "A"), entry("b", "B")], None);
        let seen: Rc<RefCell<usize>> = Rc::default();
        let sink = seen.clone();
        let id = library.subscribe(move |_| *sink.borrow_mut() += 1);
        library.unsubscribe(id);
        library.switch_to("b");
        assert_eq!(*seen.borrow(), 0);
    }

    fn three() -> SessionLibrary {
        SessionLibrary::new(
            vec![entry("a", "A"), entry("b", "B"), entry("c", "C")],
            Some("b"),
        )
    }

    fn ids(library: &SessionLibrary) -> Vec<&str> {
        library
            .entries()
            .iter()
            .map(|entry| entry.id.as_str())
            .collect()
    }

    #[test]
    fn moves_a_session_to_the_front_the_end_and_the_middle() {
        let mut library = three();
        assert!(library.move_entry("c", 0));
        assert_eq!(ids(&library), vec!["c", "a", "b"]);
        assert!(library.move_entry("c", 2));
        assert_eq!(ids(&library), vec!["a", "b", "c"]);
        assert!(library.move_entry("c", 1));
        assert_eq!(ids(&library), vec!["a", "c", "b"]);
    }

    #[test]
    fn keeps_the_active_session_and_announces_the_reorder_once() {
        let mut library = three();
        let seen = collect(&mut library);

        library.move_entry("a", 2);

        assert_eq!(library.active_id(), "b");
        assert_eq!(seen.borrow().as_slice(), &[LibraryChange::Reordered]);
    }

    #[test]
    fn clamps_the_destination_to_the_list_bounds() {
        let mut library = three();
        assert!(library.move_entry("a", 99));
        assert_eq!(ids(&library), vec!["b", "c", "a"]);
        assert!(library.move_entry("a", -5));
        assert_eq!(ids(&library), vec!["a", "b", "c"]);
    }

    #[test]
    fn does_nothing_for_an_unknown_id_the_same_index_or_one_entry() {
        let mut library = three();
        let seen = collect(&mut library);

        assert!(!library.move_entry("nope", 0));
        assert!(!library.move_entry("b", 1));
        assert!(seen.borrow().is_empty());

        let mut single = one("Default");
        assert!(!single.move_entry("default", 0));
    }
}
