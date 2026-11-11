//! Keeps the next scramble one step ahead of the solver.
//!
//! Pure data and rules: the actual generation is a request the caller hands to
//! the scramble worker (`src/scramble/`), so a 1.2 s 4x4 scramble never blocks
//! the UI. Everything about *when* to generate, what to display and what to do
//! with a late result is decided here and can be tested by settling requests by
//! hand.
//!
//! Two scrambles exist at any time:
//!
//! ```text
//!   scramble  what the panel shows — the scramble to solve next
//!   warm      pre-generated for the moment the solve finishes
//!
//!   start() / set_type() / refresh() ──▶ scramble = None, generating…
//!        …generation lands ──▶ scramble = text, then warm starts generating
//!   advance()  (a solve finished) ──▶ scramble = warm, warm regenerates
//! ```
//!
//! Results arrive out of order whenever the type changes mid-generation: a
//! request is stamped with a sequence number and dropped unless it is still the
//! newest request for the type that is now selected.

pub const EMPTY_SCRAMBLE: &str = "the scrambler returned an empty scramble";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FeedState {
    /// Scramble type currently selected.
    pub type_id: String,
    /// The scramble to solve, or `None` while one is being generated.
    pub scramble: Option<String>,
    /// Why no scramble is available (or why the warm one failed), if known.
    pub error: Option<String>,
}

/// A job the caller must start on the scramble worker.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Request {
    /// Stamp the result with this so [`ScrambleFeed::settle`] can accept it.
    pub seq: u64,
    pub type_id: String,
    pub length: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Role {
    Current,
    Warm,
}

#[derive(Clone, Copy, Debug)]
struct Inflight {
    seq: u64,
    role: Role,
}

type Listener = Box<dyn FnMut(&FeedState)>;
pub type ListenerId = u64;

pub struct ScrambleFeed {
    type_id: String,
    length: u32,
    scramble: Option<String>,
    warm: Option<String>,
    inflight: Option<Inflight>,
    failure: Option<String>,
    seq: u64,
    listeners: Vec<(ListenerId, Listener)>,
    next_listener_id: ListenerId,
}

impl ScrambleFeed {
    pub fn new(type_id: impl Into<String>, length: u32) -> Self {
        Self {
            type_id: type_id.into(),
            length,
            scramble: None,
            warm: None,
            inflight: None,
            failure: None,
            seq: 0,
            listeners: Vec::new(),
            next_listener_id: 1,
        }
    }

    pub fn state(&self) -> FeedState {
        FeedState {
            type_id: self.type_id.clone(),
            scramble: self.scramble.clone(),
            error: self.failure.clone(),
        }
    }

    pub fn subscribe(&mut self, listener: impl FnMut(&FeedState) + 'static) -> ListenerId {
        let id = self.next_listener_id;
        self.next_listener_id += 1;
        self.listeners.push((id, Box::new(listener)));
        id
    }

    pub fn unsubscribe(&mut self, id: ListenerId) {
        self.listeners.retain(|(each, _)| *each != id);
    }

    /// Ask for the first scramble. Does nothing if one is under way already.
    pub fn start(&mut self) -> Option<Request> {
        if self.inflight.is_some() || self.scramble.is_some() {
            return None;
        }
        Some(self.begin(Role::Current))
    }

    /// A solve finished: show the scramble that was kept warm, and start
    /// warming the one after it. If the warm one is still being generated it is
    /// promoted rather than thrown away; if generation failed, retry once.
    pub fn advance(&mut self) -> Option<Request> {
        if let Some(inflight) = &mut self.inflight {
            if inflight.role == Role::Warm {
                inflight.role = Role::Current;
                self.scramble = None;
                self.failure = None;
                self.emit();
                return None;
            }
            return None; // the displayed scramble is still coming
        }

        if let Some(warm) = self.warm.take() {
            // A failure would have left warm empty, so this carries on clean.
            self.scramble = Some(warm);
            self.emit();
            return self.ensure_warm();
        }

        Some(self.begin(Role::Current))
    }

    /// Switch the scramble type (and the length that belongs with it);
    /// anything in flight for the old pair is dropped.
    pub fn set_type(&mut self, type_id: &str, length: u32) -> Option<Request> {
        if type_id == self.type_id && length == self.length {
            return None;
        }
        self.type_id = type_id.to_string();
        self.length = length;
        Some(self.restart())
    }

    /// A new length for the type already selected — the visible and the
    /// prefetched scramble both described the old length, so both go.
    pub fn set_length(&mut self, length: u32) -> Option<Request> {
        if length == self.length {
            return None;
        }
        self.length = length;
        Some(self.restart())
    }

    /// Throw the current scramble away and make a new one of the same type.
    pub fn refresh(&mut self) -> Option<Request> {
        Some(self.restart())
    }

    /// Land a result. Ignored unless `seq` is still the newest request for the
    /// type that is now selected. Returns the warm-up request when a current
    /// scramble landed.
    pub fn settle(
        &mut self,
        seq: u64,
        type_id: &str,
        result: Result<String, String>,
    ) -> Option<Request> {
        let inflight = self.inflight?;
        if inflight.seq != seq || self.type_id != type_id {
            return None;
        }
        self.inflight = None;

        let text = match result {
            Err(message) => {
                self.failure = Some(message);
                self.emit();
                return None;
            }
            Ok(text) if text.is_empty() => {
                self.failure = Some(EMPTY_SCRAMBLE.to_string());
                self.emit();
                return None;
            }
            Ok(text) => text,
        };

        match inflight.role {
            Role::Current => {
                self.scramble = Some(text);
                self.failure = None;
                self.emit();
                self.ensure_warm()
            }
            Role::Warm => {
                self.warm = Some(text); // not part of the visible state
                None
            }
        }
    }

    fn restart(&mut self) -> Request {
        self.seq += 1; // in-flight results now belong to a scramble we no longer want
        self.inflight = None;
        self.warm = None;
        self.begin(Role::Current)
    }

    fn ensure_warm(&mut self) -> Option<Request> {
        if self.scramble.is_none() || self.warm.is_some() || self.inflight.is_some() {
            return None;
        }
        if self.failure.is_some() {
            return None; // a type that just failed: don't hammer it
        }
        Some(self.begin(Role::Warm))
    }

    fn begin(&mut self, role: Role) -> Request {
        self.seq += 1;
        let seq = self.seq;
        self.inflight = Some(Inflight { seq, role });
        if role == Role::Current {
            self.scramble = None;
            self.failure = None;
            self.emit(); // warming up changes no visible state, so it stays quiet
        }
        Request {
            seq,
            type_id: self.type_id.clone(),
            length: self.length,
        }
    }

    fn emit(&mut self) {
        let state = self.state();
        let mut listeners = std::mem::take(&mut self.listeners);
        for (_, listener) in &mut listeners {
            listener(&state);
        }
        self.listeners = listeners;
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::rc::Rc;

    use super::*;

    /// The requests the feed asked for, in order — the fake generator's log.
    type Calls = Rc<RefCell<Vec<Request>>>;

    fn start(feed: &mut ScrambleFeed, calls: &Calls) {
        if let Some(request) = feed.start() {
            calls.borrow_mut().push(request);
        }
    }

    fn advance(feed: &mut ScrambleFeed, calls: &Calls) {
        if let Some(request) = feed.advance() {
            calls.borrow_mut().push(request);
        }
    }

    fn set_type(feed: &mut ScrambleFeed, calls: &Calls, type_id: &str, length: u32) {
        if let Some(request) = feed.set_type(type_id, length) {
            calls.borrow_mut().push(request);
        }
    }

    fn set_length(feed: &mut ScrambleFeed, calls: &Calls, length: u32) {
        if let Some(request) = feed.set_length(length) {
            calls.borrow_mut().push(request);
        }
    }

    fn refresh(feed: &mut ScrambleFeed, calls: &Calls) {
        if let Some(request) = feed.refresh() {
            calls.borrow_mut().push(request);
        }
    }

    fn settle(feed: &mut ScrambleFeed, calls: &Calls, call: usize, text: &str) {
        let request = calls.borrow()[call].clone();
        if let Some(warm) = feed.settle(request.seq, &request.type_id, Ok(text.to_string())) {
            calls.borrow_mut().push(warm);
        }
    }

    fn fail(feed: &mut ScrambleFeed, calls: &Calls, call: usize, message: &str) {
        let request = calls.borrow()[call].clone();
        feed.settle(request.seq, &request.type_id, Err(message.to_string()));
    }

    fn feed() -> (ScrambleFeed, Calls) {
        (ScrambleFeed::new("333", 0), Rc::default())
    }

    #[test]
    fn generates_the_first_scramble_then_keeps_one_warm() {
        let (mut feed, calls) = feed();
        assert_eq!(
            feed.state(),
            FeedState {
                type_id: "333".into(),
                scramble: None,
                error: None,
            }
        );

        start(&mut feed, &calls);
        assert_eq!(feed.state().scramble, None); // nothing to show while it generates
        assert_eq!(calls.borrow().len(), 1);

        settle(&mut feed, &calls, 0, "scramble A");

        assert_eq!(feed.state().scramble.as_deref(), Some("scramble A"));
        assert_eq!(feed.state().error, None);
        let types: Vec<String> = calls
            .borrow()
            .iter()
            .map(|call| call.type_id.clone())
            .collect();
        assert_eq!(types, vec!["333", "333"]); // current + warm

        settle(&mut feed, &calls, 1, "scramble B");
        assert_eq!(feed.state().scramble.as_deref(), Some("scramble A")); // warm stays out of sight
    }

    #[test]
    fn start_is_a_no_op_once_a_scramble_is_under_way_or_displayed() {
        let (mut feed, calls) = feed();

        start(&mut feed, &calls);
        start(&mut feed, &calls);
        assert_eq!(calls.borrow().len(), 1);

        settle(&mut feed, &calls, 0, "scramble A");
        start(&mut feed, &calls);
        assert_eq!(calls.borrow().len(), 2); // only the warm-up, no third
    }

    #[test]
    fn advance_swaps_in_the_warm_scramble_without_generating_again() {
        let (mut feed, calls) = feed();

        start(&mut feed, &calls);
        settle(&mut feed, &calls, 0, "scramble A");
        settle(&mut feed, &calls, 1, "scramble B");

        advance(&mut feed, &calls);
        assert_eq!(feed.state().scramble.as_deref(), Some("scramble B"));
        assert_eq!(calls.borrow().len(), 3); // B shown → C warmed

        settle(&mut feed, &calls, 2, "scramble C");
        assert_eq!(feed.state().scramble.as_deref(), Some("scramble B"));
    }

    #[test]
    fn advance_during_warm_up_keeps_that_generation_instead_of_duplicating_it() {
        let (mut feed, calls) = feed();

        start(&mut feed, &calls);
        settle(&mut feed, &calls, 0, "scramble A");
        assert_eq!(calls.borrow().len(), 2); // warm in flight

        advance(&mut feed, &calls); // solve finished before the warm scramble was ready
        assert_eq!(feed.state().scramble, None);
        assert_eq!(calls.borrow().len(), 2); // not thrown away, not duplicated

        settle(&mut feed, &calls, 1, "scramble B");
        assert_eq!(feed.state().scramble.as_deref(), Some("scramble B"));
        assert_eq!(calls.borrow().len(), 3); // only now does a new warm-up start

        settle(&mut feed, &calls, 1, "scramble B"); // settling twice is harmless
        assert_eq!(feed.state().scramble.as_deref(), Some("scramble B"));
    }

    #[test]
    fn set_type_drops_a_result_generated_for_the_previous_type() {
        let (mut feed, calls) = feed();

        start(&mut feed, &calls); // generating a 3x3 scramble
        set_type(&mut feed, &calls, "444wca", 40);
        assert_eq!(feed.state().type_id, "444wca");
        assert_eq!(feed.state().scramble, None);

        settle(&mut feed, &calls, 0, "stale 3x3 scramble");
        assert_eq!(feed.state().scramble, None); // discarded, not displayed

        settle(&mut feed, &calls, 1, "4x4 scramble");
        assert_eq!(feed.state().scramble.as_deref(), Some("4x4 scramble"));
        let types: Vec<String> = calls
            .borrow()
            .iter()
            .map(|call| call.type_id.clone())
            .collect();
        assert_eq!(types, vec!["333", "444wca", "444wca"]);
    }

    #[test]
    fn set_type_to_the_type_already_selected_does_nothing() {
        let (mut feed, calls) = feed();
        start(&mut feed, &calls);
        set_type(&mut feed, &calls, "333", 0);
        assert_eq!(calls.borrow().len(), 1);
    }

    #[test]
    fn set_length_drops_the_displayed_and_the_prefetched_scramble() {
        let (mut feed, calls) = (ScrambleFeed::new("333o", 25), Calls::default());

        start(&mut feed, &calls);
        settle(&mut feed, &calls, 0, "25-move scramble");
        settle(&mut feed, &calls, 1, "25-move warm");

        set_length(&mut feed, &calls, 10);
        assert_eq!(feed.state().scramble, None);
        assert_eq!(calls.borrow()[2].length, 10); // the old pair is gone
        settle(&mut feed, &calls, 2, "10-move scramble");

        assert_eq!(feed.state().scramble.as_deref(), Some("10-move scramble"));
        assert_eq!(calls.borrow()[3].length, 10); // the warm one uses it too
        let types: Vec<String> = calls
            .borrow()
            .iter()
            .map(|call| call.type_id.clone())
            .collect();
        assert_eq!(types, vec!["333o", "333o", "333o", "333o"]);
    }

    #[test]
    fn set_length_drops_a_result_generated_for_the_old_length() {
        let (mut feed, calls) = (ScrambleFeed::new("333o", 25), Calls::default());

        start(&mut feed, &calls); // generating 25 moves
        set_length(&mut feed, &calls, 10);
        settle(&mut feed, &calls, 0, "stale 25-move scramble");
        assert_eq!(feed.state().scramble, None); // discarded, not displayed

        settle(&mut feed, &calls, 1, "10-move scramble");
        assert_eq!(feed.state().scramble.as_deref(), Some("10-move scramble"));
    }

    #[test]
    fn set_length_to_the_length_already_selected_does_nothing() {
        let (mut feed, calls) = (ScrambleFeed::new("333o", 25), Calls::default());
        start(&mut feed, &calls);
        set_length(&mut feed, &calls, 25);
        assert_eq!(calls.borrow().len(), 1);
    }

    #[test]
    fn set_type_with_the_same_type_but_a_new_length_regenerates() {
        let (mut feed, calls) = (ScrambleFeed::new("333o", 25), Calls::default());
        start(&mut feed, &calls);
        set_type(&mut feed, &calls, "333o", 10);
        assert_eq!(feed.state().type_id, "333o");
        assert_eq!(feed.state().scramble, None);
        assert_eq!(calls.borrow()[1].length, 10);
    }

    #[test]
    fn refresh_replaces_the_displayed_scramble_and_the_warm_one() {
        let (mut feed, calls) = feed();

        start(&mut feed, &calls);
        settle(&mut feed, &calls, 0, "scramble A");
        settle(&mut feed, &calls, 1, "scramble B");

        refresh(&mut feed, &calls);
        assert_eq!(feed.state().scramble, None);

        settle(&mut feed, &calls, 2, "scramble C");
        assert_eq!(feed.state().scramble.as_deref(), Some("scramble C"));
        assert_eq!(calls.borrow().len(), 4); // and a fresh warm-up
    }

    #[test]
    fn reports_a_failed_current_scramble_and_retries_on_refresh() {
        let (mut feed, calls) = feed();

        start(&mut feed, &calls);
        fail(&mut feed, &calls, 0, "subscript out of range");

        assert_eq!(feed.state().scramble, None);
        assert_eq!(
            feed.state().error.as_deref(),
            Some("subscript out of range")
        );

        refresh(&mut feed, &calls); // the user asks for another try
        assert_eq!(feed.state().error, None); // showing the attempt, not the old failure
        settle(&mut feed, &calls, 1, "scramble A");
        assert_eq!(feed.state().scramble.as_deref(), Some("scramble A"));
        assert_eq!(feed.state().error, None);
    }

    #[test]
    fn keeps_showing_the_current_scramble_when_only_the_warm_one_fails() {
        let (mut feed, calls) = feed();

        start(&mut feed, &calls);
        settle(&mut feed, &calls, 0, "scramble A");
        fail(&mut feed, &calls, 1, "boom");

        assert_eq!(feed.state().scramble.as_deref(), Some("scramble A")); // still solvable
        assert_eq!(feed.state().error.as_deref(), Some("boom"));

        advance(&mut feed, &calls); // no warm scramble → back to an error state, one retry
        assert_eq!(feed.state().scramble, None);
        assert_eq!(feed.state().error, None);

        fail(&mut feed, &calls, 2, "boom again");
        assert_eq!(feed.state().error.as_deref(), Some("boom again"));
    }

    #[test]
    fn treats_an_empty_scramble_as_a_failure() {
        let (mut feed, calls) = feed();
        start(&mut feed, &calls);
        settle(&mut feed, &calls, 0, "");
        assert_eq!(feed.state().scramble, None);
        assert_eq!(feed.state().error.as_deref(), Some(EMPTY_SCRAMBLE));
    }

    #[test]
    fn announces_exactly_the_visible_changes_and_stops_after_unsubscribe() {
        let (mut feed, calls) = feed();
        let seen: Rc<RefCell<Vec<Option<String>>>> = Rc::default();
        let sink = seen.clone();
        let id = feed.subscribe(move |state| sink.borrow_mut().push(state.scramble.clone()));

        start(&mut feed, &calls); // nothing visible yet, but "generating" is announced
        settle(&mut feed, &calls, 0, "scramble A"); // lands, then quietly warms the next
        assert_eq!(*seen.borrow(), vec![None, Some("scramble A".into())]);

        advance(&mut feed, &calls); // warm still in flight → promoted
        assert_eq!(*seen.borrow(), vec![None, Some("scramble A".into()), None]);

        feed.unsubscribe(id);
        settle(&mut feed, &calls, 1, "scramble B");
        assert_eq!(*seen.borrow(), vec![None, Some("scramble A".into()), None]); // no more events
    }
}
