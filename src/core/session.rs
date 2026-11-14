//! The solve list: record, delete, restore.
//!
//! Pure Rust — persistence lives in `src/platform/store.rs`; this module only
//! knows about vectors, so every rule below is unit-testable.
//!
//! Ordering and identity:
//!   - solves are stored oldest → newest, and that order *is* the solve
//!     numbering (#1 is the first solve of the session);
//!   - `id` is a small integer assigned here and persisted as-is, so a solve
//!     keeps its identity through deletes and restarts (the list view keys its
//!     rows on it, which is what makes delete/restore trivial);
//!   - ids are never reused while the session lives: `next_id` only climbs.
//!
//! Deletion is always two-step — `remove()` hands back the solve *and* the
//! position it had, and `restore()` puts it back exactly there. That is what
//! makes the undo toast work without keeping a second copy of history.

use serde::{Deserialize, Serialize};

use super::time::Penalty;

/// Longest comment accepted, shared by the editor dialog and the loader: a
/// solve's note is a short aside, not a document, and a file that exceeds it
/// is skipped (with a notice) rather than truncated.
pub const MAX_COMMENT_LENGTH: usize = 500;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Solve {
    /// Stable identity, unique within the session; never reused.
    pub id: u64,
    /// Measured time in milliseconds.
    #[serde(serialize_with = "crate::core::json_number::serialize")]
    pub time_ms: f64,
    /// The scramble this solve was performed on (`""` if none was ready).
    pub scramble: String,
    /// Scramble type id, e.g. `"333"` (see `scramble_types`).
    pub scramble_type: String,
    /// Wall-clock time the solve finished, in ms since the epoch.
    #[serde(serialize_with = "crate::core::json_number::serialize")]
    pub created_at_ms: f64,
    /// WCA-style result penalty; `None` means OK. Optional so session files
    /// written before penalties existed still load unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub penalty: Option<Penalty>,
    /// Free-text note shown next to the time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

impl Solve {
    /// The id-less shape the timer hands over; the session assigns the id.
    pub fn into_new(self) -> NewSolve {
        NewSolve {
            time_ms: self.time_ms,
            scramble: self.scramble,
            scramble_type: self.scramble_type,
            created_at_ms: self.created_at_ms,
            penalty: self.penalty,
            comment: self.comment,
        }
    }
}

/// What the timer hands over when a solve finishes.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct NewSolve {
    pub time_ms: f64,
    pub scramble: String,
    pub scramble_type: String,
    pub created_at_ms: f64,
    pub penalty: Option<Penalty>,
    pub comment: Option<String>,
}

impl NewSolve {
    pub fn new(
        time_ms: f64,
        scramble: impl Into<String>,
        scramble_type: impl Into<String>,
        created_at_ms: f64,
    ) -> Self {
        Self {
            time_ms,
            scramble: scramble.into(),
            scramble_type: scramble_type.into(),
            created_at_ms,
            penalty: None,
            comment: None,
        }
    }
}

/// A removed solve plus where it belongs, so `restore()` can undo the removal.
#[derive(Clone, Debug, PartialEq)]
pub struct RemovedSolve {
    pub solve: Solve,
    /// Chronological index the solve occupied when it was removed.
    pub position: usize,
}

/// Every mutation the session announces.
#[derive(Clone, Debug, PartialEq)]
pub enum SessionChange {
    Added {
        solve: Solve,
        position: usize,
    },
    Removed {
        removed: RemovedSolve,
    },
    Restored {
        solve: Solve,
        position: usize,
    },
    /// A penalty was set (`Some`) or cleared back to OK (`None`).
    Penalty {
        solve: Solve,
        position: usize,
    },
    /// A comment was set or replaced.
    Comment {
        solve: Solve,
        position: usize,
    },
}

impl SessionChange {
    /// The solve the change is about.
    pub fn solve(&self) -> &Solve {
        match self {
            SessionChange::Added { solve, .. }
            | SessionChange::Restored { solve, .. }
            | SessionChange::Penalty { solve, .. }
            | SessionChange::Comment { solve, .. } => solve,
            SessionChange::Removed { removed } => &removed.solve,
        }
    }

    /// The chronological index the solve now has (or had, for a removal).
    pub fn position(&self) -> usize {
        match self {
            SessionChange::Added { position, .. }
            | SessionChange::Restored { position, .. }
            | SessionChange::Penalty { position, .. }
            | SessionChange::Comment { position, .. } => *position,
            SessionChange::Removed { removed } => removed.position,
        }
    }
}

pub type ListenerId = u64;
type Listener = Box<dyn FnMut(&SessionChange, &[Solve])>;

pub struct Session {
    items: Vec<Solve>,
    next_id: u64,
    listeners: Vec<(ListenerId, Listener)>,
    next_listener_id: ListenerId,
}

impl Default for Session {
    fn default() -> Self {
        Self::new(Vec::new())
    }
}

impl Session {
    /// `initial` is copied — the caller may own that vector (the file loader
    /// does).
    pub fn new(initial: Vec<Solve>) -> Self {
        let next_id = initial.iter().map(|solve| solve.id).max().unwrap_or(0) + 1;
        Self {
            items: initial,
            next_id,
            listeners: Vec::new(),
            next_listener_id: 1,
        }
    }

    /// The solves, oldest first. Read-only by contract: mutate through the
    /// methods below so listeners (and the save that follows) always see a
    /// change event rather than a silently edited vector.
    pub fn solves(&self) -> &[Solve] {
        &self.items
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// The solve with this id, or `None` if it is not (or no longer) there.
    pub fn find(&self, id: u64) -> Option<&Solve> {
        self.items.iter().find(|solve| solve.id == id)
    }

    /// Chronological index of a solve, or `None`.
    pub fn index_of(&self, id: u64) -> Option<usize> {
        self.items.iter().position(|solve| solve.id == id)
    }

    /// Append a finished solve; returns it with its assigned id.
    pub fn add(&mut self, solve: NewSolve) -> Solve {
        let stored = Solve {
            id: self.next_id,
            time_ms: solve.time_ms,
            scramble: solve.scramble,
            scramble_type: solve.scramble_type,
            created_at_ms: solve.created_at_ms,
            penalty: solve.penalty,
            comment: solve.comment,
        };
        self.next_id += 1;
        self.items.push(stored.clone());
        self.emit(SessionChange::Added {
            solve: stored.clone(),
            position: self.items.len() - 1,
        });
        stored
    }

    /// Remove a solve by id. Returns what was removed, or `None` if unknown.
    pub fn remove(&mut self, id: u64) -> Option<RemovedSolve> {
        let position = self.index_of(id)?;
        let solve = self.items.remove(position);
        let removed = RemovedSolve { solve, position };
        self.emit(SessionChange::Removed {
            removed: removed.clone(),
        });
        Some(removed)
    }

    /// Put a removed solve back where it was. A position beyond the current
    /// end (someone deleted further solves in between) clamps to the end, and
    /// a solve that is already present is left alone — restore must be
    /// idempotent, because a toast can outlive the row it belongs to.
    pub fn restore(&mut self, removed: RemovedSolve) -> Option<Solve> {
        if self.find(removed.solve.id).is_some() {
            return None;
        }

        let position = removed.position.min(self.items.len());
        // An id from before a restart can exceed this run's counter.
        if removed.solve.id >= self.next_id {
            self.next_id = removed.solve.id + 1;
        }
        self.items.insert(position, removed.solve.clone());

        self.emit(SessionChange::Restored {
            solve: removed.solve.clone(),
            position,
        });
        Some(removed.solve)
    }

    /// Set (or, with `None`, clear) a solve's penalty. Returns the solve, or
    /// `None` if the id is unknown. Listeners get a `Penalty` change so the
    /// row, footer and statistics all refresh from one code path.
    pub fn set_penalty(&mut self, id: u64, penalty: Option<Penalty>) -> Option<Solve> {
        let position = self.index_of(id)?;
        let solve = &mut self.items[position];
        if solve.penalty == penalty {
            return Some(solve.clone());
        }
        solve.penalty = penalty;
        let solve = solve.clone();
        self.emit(SessionChange::Penalty {
            solve: solve.clone(),
            position,
        });
        Some(solve)
    }

    /// Set (or, with `None`, clear) a solve's comment. Same contract as
    /// `set_penalty` — a `Comment` change follows every real change.
    pub fn set_comment(&mut self, id: u64, comment: Option<String>) -> Option<Solve> {
        let position = self.index_of(id)?;
        let next = comment.filter(|text| !text.is_empty());
        let solve = &mut self.items[position];
        if solve.comment == next {
            return Some(solve.clone());
        }
        solve.comment = next;
        let solve = solve.clone();
        self.emit(SessionChange::Comment {
            solve: solve.clone(),
            position,
        });
        Some(solve)
    }

    /// Subscribe to every change. Returns an id for `unsubscribe`.
    pub fn subscribe(
        &mut self,
        listener: impl FnMut(&SessionChange, &[Solve]) + 'static,
    ) -> ListenerId {
        let id = self.next_listener_id;
        self.next_listener_id += 1;
        self.listeners.push((id, Box::new(listener)));
        id
    }

    pub fn unsubscribe(&mut self, id: ListenerId) {
        self.listeners.retain(|(each, _)| *each != id);
    }

    fn emit(&mut self, change: SessionChange) {
        // Take the listeners out for the duration, like the TS copy of the
        // set: a listener added by a listener does not see this event, and a
        // removed one still does.
        // The listeners are moved out first, so handing them the solve list
        // borrows `self` immutably while nothing else does: a listener can read
        // the session it is hearing about (the persistence save does exactly
        // that) without a second borrow of the session itself.
        let mut listeners = std::mem::take(&mut self.listeners);
        for (_, listener) in &mut listeners {
            listener(&change, &self.items);
        }
        self.listeners = listeners;
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::rc::Rc;

    use super::*;

    /// A stored solve, as the file loader would hand it over.
    fn stored(id: u64) -> Solve {
        Solve {
            id,
            time_ms: 1000.0 * id as f64,
            scramble: format!("scramble {id}"),
            scramble_type: "333".into(),
            created_at_ms: 1_700_000_000_000.0 + id as f64,
            penalty: None,
            comment: None,
        }
    }

    /// What the timer hands to `add()` — no id yet.
    fn fresh(time_ms: f64) -> NewSolve {
        NewSolve::new(time_ms, "R U R' U'", "333", 1_700_000_000_000.0)
    }

    fn ids(session: &Session) -> Vec<u64> {
        session.solves().iter().map(|solve| solve.id).collect()
    }

    #[test]
    fn appends_solves_in_order_and_numbers_them_from_one() {
        let mut session = Session::new(Vec::new());
        assert_eq!(session.len(), 0);

        let first = session.add(fresh(12_345.0));
        let second = session.add(fresh(9_876.0));

        assert_eq!([first.id, second.id], [1, 2]);
        assert_eq!(ids(&session), vec![1, 2]);
        assert_eq!(second.time_ms, 9_876.0); // the measurement survives intact
    }

    #[test]
    fn announces_every_addition_with_its_position() {
        let mut session = Session::new(Vec::new());
        let seen: Rc<RefCell<Vec<SessionChange>>> = Rc::default();
        let sink = seen.clone();
        session.subscribe(move |change, _solves| sink.borrow_mut().push(change.clone()));

        session.add(fresh(1_000.0));
        session.add(fresh(2_000.0));

        let seen = seen.borrow();
        assert_eq!(seen.len(), 2);
        assert!(matches!(seen[0], SessionChange::Added { position: 0, .. }));
        assert!(matches!(seen[1], SessionChange::Added { position: 1, .. }));
        assert_eq!(seen[1].solve().id, 2);
    }

    #[test]
    fn continues_numbering_above_the_ids_loaded_from_disk() {
        let mut session = Session::new(vec![stored(4), stored(9)]);
        assert_eq!(session.add(fresh(1_000.0)).id, 10);
    }

    #[test]
    fn copies_the_vector_it_is_constructed_from() {
        let from_file = vec![stored(1)];
        let mut session = Session::new(from_file.clone());
        session.add(fresh(1_000.0));
        assert_eq!(from_file.len(), 1); // the loader's vector is not our storage
    }

    #[test]
    fn finds_solves_by_id() {
        let session = Session::new(vec![stored(1), stored(2)]);
        assert_eq!(session.find(2).map(|solve| solve.time_ms), Some(2_000.0));
        assert!(session.find(99).is_none());
        assert_eq!(session.index_of(1), Some(0));
        assert!(session.index_of(99).is_none());
    }

    #[test]
    fn removes_a_solve_and_reports_where_it_was() {
        let mut session = Session::new(vec![stored(1), stored(2), stored(3)]);
        let seen: Rc<RefCell<Vec<SessionChange>>> = Rc::default();
        let sink = seen.clone();
        session.subscribe(move |change, _solves| sink.borrow_mut().push(change.clone()));

        let removed = session.remove(2).expect("solve 2 exists");

        assert_eq!(
            removed,
            RemovedSolve {
                solve: stored(2),
                position: 1
            }
        );
        assert_eq!(ids(&session), vec![1, 3]);
        assert_eq!(
            *seen.borrow(),
            vec![SessionChange::Removed {
                removed: removed.clone()
            }]
        );
    }

    #[test]
    fn refuses_to_remove_a_solve_it_does_not_have() {
        let mut session = Session::new(vec![stored(1)]);
        assert!(session.remove(7).is_none());
        assert_eq!(ids(&session), vec![1]);
    }

    #[test]
    fn does_not_reuse_an_id_after_a_deletion() {
        let mut session = Session::new(Vec::new());
        let added = session.add(fresh(1_000.0));
        session.remove(added.id);
        assert_eq!(session.add(fresh(2_000.0)).id, 2);
    }

    #[test]
    fn puts_a_deleted_solve_back_exactly_where_it_was() {
        let mut session = Session::new(vec![stored(1), stored(2), stored(3)]);
        let removed = session.remove(2).expect("solve 2 exists");
        let seen: Rc<RefCell<Vec<SessionChange>>> = Rc::default();
        let sink = seen.clone();
        session.subscribe(move |change, _solves| sink.borrow_mut().push(change.clone()));

        assert_eq!(session.restore(removed), Some(stored(2)));
        assert_eq!(ids(&session), vec![1, 2, 3]);
        assert_eq!(
            *seen.borrow(),
            vec![SessionChange::Restored {
                solve: stored(2),
                position: 1,
            }]
        );
    }

    #[test]
    fn restores_the_newest_solve_at_the_end_again() {
        let mut session = Session::new(vec![stored(1), stored(2)]);
        let removed = session.remove(2).expect("solve 2 exists");
        session.restore(removed);
        assert_eq!(ids(&session), vec![1, 2]);
    }

    #[test]
    fn clamps_to_the_end_when_later_solves_were_deleted_too() {
        let mut session = Session::new(vec![stored(1), stored(2), stored(3)]);
        let last = session.remove(3).expect("solve 3 exists"); // had position 2
        session.remove(1); // the list is now just #2, so position 2 no longer exists
        session.restore(last);
        assert_eq!(ids(&session), vec![2, 3]); // appended, not spliced past the end
    }

    #[test]
    fn restore_is_idempotent() {
        let mut session = Session::new(vec![stored(1)]);
        let removed = session.remove(1).expect("solve 1 exists");
        assert_eq!(session.restore(removed.clone()), Some(stored(1)));
        assert_eq!(session.restore(removed), None);
        assert_eq!(ids(&session), vec![1]);
    }

    #[test]
    fn keeps_numbering_above_a_restored_id_from_another_session() {
        let mut session = Session::new(Vec::new());
        session.restore(RemovedSolve {
            solve: stored(42),
            position: 0,
        });
        assert_eq!(ids(&session), vec![42]);
        assert_eq!(session.add(fresh(1_000.0)).id, 43);
    }

    #[test]
    fn round_trips_a_delete_restore_cycle() {
        let mut session = Session::new(vec![stored(1), stored(2), stored(3)]);
        let removed = session.remove(3).expect("solve 3 exists");
        session.restore(removed);
        assert_eq!(session.solves(), [stored(1), stored(2), stored(3)]);
        assert_eq!(session.add(fresh(4_000.0)).id, 4);
    }

    #[test]
    fn sets_a_penalty_and_reports_it_with_the_solve_position() {
        let mut session = Session::new(vec![stored(1), stored(2)]);
        let seen: Rc<RefCell<Vec<SessionChange>>> = Rc::default();
        let sink = seen.clone();
        session.subscribe(move |change, _solves| sink.borrow_mut().push(change.clone()));

        let solve = session
            .set_penalty(2, Some(Penalty::Plus2))
            .expect("solve 2");

        assert_eq!(solve.penalty, Some(Penalty::Plus2));
        let seen = seen.borrow();
        assert_eq!(seen.len(), 1);
        assert!(matches!(
            seen[0],
            SessionChange::Penalty { position: 1, .. }
        ));
        assert_eq!(seen[0].solve(), &solve);
    }

    #[test]
    fn replaces_one_penalty_with_another() {
        let mut session = Session::new(vec![stored(1)]);
        session.set_penalty(1, Some(Penalty::Plus2));
        session.set_penalty(1, Some(Penalty::Dnf));
        assert_eq!(
            session.find(1).and_then(|solve| solve.penalty),
            Some(Penalty::Dnf)
        );
    }

    #[test]
    fn clears_back_to_ok() {
        let mut session = Session::new(vec![stored(1)]);
        session.set_penalty(1, Some(Penalty::Dnf));
        session.set_penalty(1, None);
        assert_eq!(session.find(1).and_then(|solve| solve.penalty), None);
    }

    #[test]
    fn emits_nothing_when_the_penalty_does_not_actually_change() {
        let mut session = Session::new(vec![stored(1)]);
        let seen: Rc<RefCell<usize>> = Rc::default();
        let sink = seen.clone();
        session.subscribe(move |_, _| *sink.borrow_mut() += 1);

        session.set_penalty(1, Some(Penalty::Plus2));
        session.set_penalty(1, Some(Penalty::Plus2)); // no-op

        assert_eq!(*seen.borrow(), 1);
    }

    #[test]
    fn refuses_to_touch_a_solve_it_does_not_have() {
        let mut session = Session::new(vec![stored(1)]);
        assert!(session.set_penalty(99, Some(Penalty::Dnf)).is_none());
        assert!(session.set_penalty(99, None).is_none());
    }

    #[test]
    fn stores_a_penalty_that_arrives_with_the_solve_itself() {
        let mut session = Session::new(vec![stored(1)]);

        let mut with_penalty = NewSolve::new(4_790.0, "R U R'", "333", 1_700_000_000_000.0);
        with_penalty.penalty = Some(Penalty::Dnf);
        let solve = session.add(with_penalty);

        assert_eq!(solve.id, 2);
        assert_eq!(solve.penalty, Some(Penalty::Dnf));
        assert_eq!(
            session.find(2).and_then(|solve| solve.penalty),
            Some(Penalty::Dnf)
        );

        // OK is still "absent" — no penalty field for a clean solve.
        let clean = session.add(NewSolve::new(5_010.0, "U2 F'", "333", 1_700_000_001_000.0));
        assert_eq!(clean.penalty, None);
    }

    #[test]
    fn sets_a_comment_and_reports_it_with_the_solve_position() {
        let mut session = Session::new(vec![stored(1)]);
        let seen: Rc<RefCell<Vec<SessionChange>>> = Rc::default();
        let sink = seen.clone();
        session.subscribe(move |change, _solves| sink.borrow_mut().push(change.clone()));

        let solve = session
            .set_comment(1, Some("lockup on the last alg".into()))
            .expect("solve 1");

        assert_eq!(solve.comment.as_deref(), Some("lockup on the last alg"));
        let seen = seen.borrow();
        assert_eq!(seen.len(), 1);
        assert!(matches!(
            seen[0],
            SessionChange::Comment { position: 0, .. }
        ));
        assert_eq!(seen[0].solve(), &solve);
    }

    #[test]
    fn replaces_and_clears_a_comment() {
        let mut session = Session::new(vec![stored(1)]);
        session.set_comment(1, Some("first note".into()));
        session.set_comment(1, Some("second note".into()));
        assert_eq!(
            session.find(1).and_then(|s| s.comment.as_deref()),
            Some("second note")
        );

        session.set_comment(1, None);
        assert_eq!(session.find(1).and_then(|s| s.comment.clone()), None);
    }

    #[test]
    fn treats_an_empty_comment_as_no_comment() {
        let mut session = Session::new(vec![stored(1)]);
        session.set_comment(1, Some(String::new()));
        assert_eq!(session.find(1).and_then(|s| s.comment.clone()), None);
    }

    #[test]
    fn emits_nothing_when_the_comment_does_not_actually_change() {
        let mut session = Session::new(vec![stored(1)]);
        let seen: Rc<RefCell<usize>> = Rc::default();
        let sink = seen.clone();
        session.subscribe(move |_, _| *sink.borrow_mut() += 1);

        session.set_comment(1, Some("note".into()));
        session.set_comment(1, Some("note".into())); // no-op

        assert_eq!(*seen.borrow(), 1);
    }

    #[test]
    fn refuses_to_comment_on_a_solve_it_does_not_have() {
        let mut session = Session::new(vec![stored(1)]);
        assert!(session.set_comment(99, Some("note".into())).is_none());
    }

    #[test]
    fn lets_a_listener_read_the_solves_it_is_hearing_about() {
        // The persistence listener saves exactly this slice, so it must be the
        // state *after* the change and readable while the event is delivered.
        let mut session = Session::new(Vec::new());
        let seen: Rc<RefCell<Vec<Vec<u64>>>> = Rc::default();
        let sink = seen.clone();
        session.subscribe(move |_change, solves| {
            sink.borrow_mut()
                .push(solves.iter().map(|solve| solve.id).collect());
        });

        session.add(fresh(1_000.0));
        session.add(fresh(2_000.0));

        assert_eq!(*seen.borrow(), vec![vec![1], vec![1, 2]]);
    }

    #[test]
    fn unsubscribes_cleanly() {
        let mut session = Session::new(Vec::new());
        let count: Rc<RefCell<usize>> = Rc::default();
        let sink = count.clone();
        let id = session.subscribe(move |_, _| *sink.borrow_mut() += 1);

        session.add(fresh(1_000.0));
        assert_eq!(*count.borrow(), 1);

        session.unsubscribe(id);
        session.add(fresh(2_000.0));
        assert_eq!(*count.borrow(), 1);
    }
}
