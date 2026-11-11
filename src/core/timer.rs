//! The timing state machine.
//!
//! Pure Rust: all time arrives as milliseconds from a monotonic clock, so
//! every transition is deterministic and testable. This mirrors the v0.3.0
//! `core/timer.ts`, including the auto-repeat dedup and WCA inspection:
//!
//! ```text
//! idle/stopped ──keydown(startKey)──▶ holding ──hold ≥ threshold──▶ ready
//!      ▲                               │                              │
//!      └──release too early────────────┘ (inspection off)            │
//!                                                                     │
//! ready ──release(startKey)──▶ running ──any keydown──▶ stopped
//! ```
//!
//! With inspection on, the first press is `inspection-ready` (no hold), its
//! release starts the countdown, and the hold/release dance happens again
//! inside it; the release that starts the run carries the age's grade.

use std::collections::HashSet;

use super::time::Penalty;

/// WCA inspection limits (ms of inspection elapsed).
pub const INSPECTION_MS: f64 = 15_000.0;
pub const INSPECTION_DNF_MS: f64 = 17_000.0;
/// Acoustic signals: one sound at 8 s, two at 12 s.
pub const INSPECTION_CUE_8S: f64 = 8_000.0;
pub const INSPECTION_CUE_12S: f64 = 12_000.0;

/// The hold threshold range the preferences normaliser enforces.
pub const MIN_HOLD_THRESHOLD_MS: f64 = 0.0;
pub const MAX_HOLD_THRESHOLD_MS: f64 = 2_000.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TimerState {
    Idle,
    Holding,
    Ready,
    InspectionReady,
    Inspecting,
    Running,
    Stopped,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TimerConfig {
    /// How long the start key must be held to arm a solve.
    pub hold_threshold_ms: f64,
    /// Identity of the key that starts the timer.
    pub start_key: String,
    /// Initial state of the WCA inspection toggle.
    pub inspection: bool,
}

impl Default for TimerConfig {
    fn default() -> Self {
        Self {
            hold_threshold_ms: 300.0,
            start_key: "space".into(),
            inspection: true,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TimerSnapshot {
    pub state: TimerState,
    /// Time currently displayed, in milliseconds.
    pub elapsed_ms: f64,
    /// 0..1 through the hold threshold while holding; 1 when armed.
    pub hold_progress: f64,
    /// Elapsed ms of the active inspection; 0 when none is running.
    pub inspection_ms: f64,
    /// The grade the current run carries, kept while stopped.
    pub penalty: Option<Penalty>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InspectionCue {
    Cue8s,
    Cue12s,
}

pub type ListenerId = u64;

type SnapshotListener = Box<dyn FnMut(&TimerSnapshot)>;
type SolvedListener = Box<dyn FnMut(f64, Option<Penalty>)>;
type CueListener = Box<dyn FnMut(InspectionCue)>;

pub struct Timer {
    config: TimerConfig,
    state: TimerState,
    pressed: HashSet<String>,
    hold_started_at: f64,
    started_at: f64,
    result_ms: Option<f64>,

    inspection_on: bool,
    inspection_started_at: f64,
    hold_from_inspection: bool,
    cue8_fired: bool,
    cue12_fired: bool,
    pending_penalty: Option<Penalty>,

    snapshot_listeners: Vec<(ListenerId, SnapshotListener)>,
    solved_listeners: Vec<(ListenerId, SolvedListener)>,
    cue_listeners: Vec<(ListenerId, CueListener)>,
    next_listener_id: ListenerId,
}

impl Default for Timer {
    fn default() -> Self {
        Self::new()
    }
}

impl Timer {
    pub fn new() -> Self {
        Self::with_config(TimerConfig::default())
    }

    pub fn with_config(config: TimerConfig) -> Self {
        Self {
            inspection_on: config.inspection,
            config,
            state: TimerState::Idle,
            pressed: HashSet::new(),
            hold_started_at: 0.0,
            started_at: 0.0,
            result_ms: None,
            inspection_started_at: 0.0,
            hold_from_inspection: false,
            cue8_fired: false,
            cue12_fired: false,
            pending_penalty: None,
            snapshot_listeners: Vec::new(),
            solved_listeners: Vec::new(),
            cue_listeners: Vec::new(),
            next_listener_id: 1,
        }
    }

    pub fn state(&self) -> TimerState {
        self.state
    }

    /// The most recently completed solve, or `None` if there is none yet.
    pub fn last_result_ms(&self) -> Option<f64> {
        self.result_ms
    }

    pub fn start_key(&self) -> &str {
        &self.config.start_key
    }

    pub fn inspection_enabled(&self) -> bool {
        self.inspection_on
    }

    pub fn subscribe(&mut self, listener: impl FnMut(&TimerSnapshot) + 'static) -> ListenerId {
        let id = self.take_id();
        self.snapshot_listeners.push((id, Box::new(listener)));
        id
    }

    pub fn on_solved(
        &mut self,
        listener: impl FnMut(f64, Option<Penalty>) + 'static,
    ) -> ListenerId {
        let id = self.take_id();
        self.solved_listeners.push((id, Box::new(listener)));
        id
    }

    pub fn on_cue(&mut self, listener: impl FnMut(InspectionCue) + 'static) -> ListenerId {
        let id = self.take_id();
        self.cue_listeners.push((id, Box::new(listener)));
        id
    }

    pub fn unsubscribe(&mut self, id: ListenerId) {
        self.snapshot_listeners.retain(|(each, _)| *each != id);
        self.solved_listeners.retain(|(each, _)| *each != id);
        self.cue_listeners.retain(|(each, _)| *each != id);
    }

    /// Live-update the hold threshold; clamped like the preferences field.
    pub fn set_hold_threshold(&mut self, ms: f64) {
        self.config.hold_threshold_ms = if ms.is_finite() {
            ms.clamp(MIN_HOLD_THRESHOLD_MS, MAX_HOLD_THRESHOLD_MS)
        } else {
            TimerConfig::default().hold_threshold_ms
        };
    }

    /// Toggle WCA inspection. Turning it off mid-countdown cancels it;
    /// during a hold it means the release starts an ungraded run.
    pub fn set_inspection(&mut self, enabled: bool, now: f64) {
        if self.inspection_on == enabled {
            return;
        }
        self.inspection_on = enabled;

        if !enabled && self.state == TimerState::InspectionReady {
            self.transition(TimerState::Idle, now);
            return;
        }

        if !enabled && self.inspection_started_at > 0.0 {
            self.inspection_started_at = 0.0;
            self.cue8_fired = false;
            self.cue12_fired = false;
            if self.state == TimerState::Inspecting {
                self.transition(TimerState::Idle, now);
                return;
            }
        }
        self.emit(now);
    }

    pub fn snapshot(&self, now: f64) -> TimerSnapshot {
        TimerSnapshot {
            state: self.state,
            elapsed_ms: self.display_ms(now),
            hold_progress: self.progress(now),
            inspection_ms: if self.inspection_started_at > 0.0 {
                (now - self.inspection_started_at).max(0.0)
            } else {
                0.0
            },
            penalty: self.pending_penalty,
        }
    }

    pub fn key_down(&mut self, key: &str, now: f64) {
        // GTK does not report auto-repeat; dedup a key that is still held.
        if !self.pressed.insert(key.to_string()) {
            return;
        }

        match self.state {
            TimerState::Idle | TimerState::Stopped => {
                if key == self.config.start_key {
                    if self.inspection_on {
                        self.pending_penalty = None;
                        self.hold_from_inspection = false;
                        self.transition(TimerState::InspectionReady, now);
                    } else {
                        self.begin_hold(now);
                    }
                }
            }
            TimerState::Inspecting => {
                if key == self.config.start_key {
                    self.begin_hold(now);
                } else if key == "escape" {
                    self.cancel_inspection(now);
                }
            }
            TimerState::Running => self.stop(now),
            TimerState::InspectionReady | TimerState::Holding | TimerState::Ready => {}
        }
    }

    pub fn key_up(&mut self, key: &str, now: f64) {
        if !self.pressed.remove(key) {
            return;
        }
        if key != self.config.start_key {
            return;
        }

        match self.state {
            TimerState::InspectionReady => {
                if self.inspection_on {
                    self.begin_inspection(now);
                } else {
                    self.transition(TimerState::Idle, now);
                }
            }
            TimerState::Ready => self.release(now),
            TimerState::Holding => {
                if now - self.hold_started_at >= self.config.hold_threshold_ms {
                    self.release(now);
                } else if self.hold_from_inspection && self.inspection_on {
                    // The countdown is still running; only the attempt is cancelled.
                    self.transition(TimerState::Inspecting, now);
                } else if self.inspection_on && self.inspection_started_at == 0.0 {
                    // Inspection starts on release, not on a completed hold.
                    self.begin_inspection(now);
                } else {
                    self.transition(TimerState::Idle, now);
                }
            }
            _ => {}
        }
    }

    /// Abandon a press without treating it as a release.
    pub fn cancel_press(&mut self, key: &str, now: f64) {
        if !self.pressed.remove(key) {
            return;
        }
        if key != self.config.start_key {
            return;
        }

        if self.state == TimerState::InspectionReady {
            self.transition(TimerState::Idle, now);
            return;
        }
        if self.state != TimerState::Holding && self.state != TimerState::Ready {
            return;
        }

        let next = if self.inspection_on && self.hold_from_inspection {
            TimerState::Inspecting
        } else {
            TimerState::Idle
        };
        self.transition(next, now);
    }

    /// Drive time-based transitions and refresh the displayed value.
    pub fn update(&mut self, now: f64) {
        if self.inspection_started_at > 0.0 {
            self.fire_cues(now);
        }

        if self.state == TimerState::Holding {
            if now - self.hold_started_at >= self.config.hold_threshold_ms {
                self.state = TimerState::Ready;
            }
            self.emit(now);
        } else if self.state == TimerState::Running
            || self.state == TimerState::Inspecting
            || (self.state == TimerState::Ready && self.inspection_started_at > 0.0)
        {
            self.emit(now);
        }
    }

    /// Back to a clean idle state; clears the last result.
    pub fn reset(&mut self, now: f64) {
        self.pressed.clear();
        self.state = TimerState::Idle;
        self.hold_started_at = 0.0;
        self.started_at = 0.0;
        self.result_ms = None;
        self.inspection_started_at = 0.0;
        self.hold_from_inspection = false;
        self.cue8_fired = false;
        self.cue12_fired = false;
        self.pending_penalty = None;
        self.emit(now);
    }

    fn take_id(&mut self) -> ListenerId {
        let id = self.next_listener_id;
        self.next_listener_id += 1;
        id
    }

    fn display_ms(&self, now: f64) -> f64 {
        if self.state == TimerState::Running {
            (now - self.started_at).max(0.0)
        } else {
            self.result_ms.unwrap_or(0.0)
        }
    }

    fn progress(&self, now: f64) -> f64 {
        if self.state == TimerState::Ready || self.state == TimerState::InspectionReady {
            return 1.0;
        }
        if self.state != TimerState::Holding {
            return 0.0;
        }
        let held = now - self.hold_started_at;
        if held <= 0.0 {
            return 0.0;
        }
        (held / self.config.hold_threshold_ms).min(1.0)
    }

    fn begin_hold(&mut self, now: f64) {
        self.hold_from_inspection = self.state == TimerState::Inspecting;
        self.pending_penalty = None;
        self.hold_started_at = now;
        self.transition(TimerState::Holding, now);
    }

    /// The release moment: begin the inspection, or start the run.
    fn release(&mut self, now: f64) {
        if self.inspection_on && self.inspection_started_at == 0.0 {
            self.begin_inspection(now);
        } else {
            self.start(now);
        }
    }

    fn begin_inspection(&mut self, now: f64) {
        self.inspection_started_at = now;
        self.hold_from_inspection = false;
        self.cue8_fired = false;
        self.cue12_fired = false;
        self.transition(TimerState::Inspecting, now);
    }

    fn cancel_inspection(&mut self, now: f64) {
        self.inspection_started_at = 0.0;
        self.hold_from_inspection = false;
        self.cue8_fired = false;
        self.cue12_fired = false;
        self.transition(TimerState::Idle, now);
    }

    fn fire_cues(&mut self, now: f64) {
        let elapsed = now - self.inspection_started_at;
        if !self.cue8_fired && elapsed >= INSPECTION_CUE_8S {
            self.cue8_fired = true;
            for (_, listener) in &mut self.cue_listeners {
                listener(InspectionCue::Cue8s);
            }
        }
        if !self.cue12_fired && elapsed >= INSPECTION_CUE_12S {
            self.cue12_fired = true;
            for (_, listener) in &mut self.cue_listeners {
                listener(InspectionCue::Cue12s);
            }
        }
    }

    fn start(&mut self, now: f64) {
        if self.inspection_started_at > 0.0 {
            let elapsed = now - self.inspection_started_at;
            self.pending_penalty = if elapsed >= INSPECTION_DNF_MS {
                Some(Penalty::Dnf)
            } else if elapsed >= INSPECTION_MS {
                Some(Penalty::Plus2)
            } else {
                None
            };
        }
        self.inspection_started_at = 0.0;
        self.hold_from_inspection = false;
        self.cue8_fired = false;
        self.cue12_fired = false;
        self.started_at = now;
        self.transition(TimerState::Running, now);
    }

    fn stop(&mut self, now: f64) {
        self.result_ms = Some((now - self.started_at).max(0.0));
        self.inspection_started_at = 0.0;
        self.hold_from_inspection = false;
        self.cue8_fired = false;
        self.cue12_fired = false;
        self.transition(TimerState::Stopped, now);

        let result = self.result_ms.unwrap_or(0.0);
        let penalty = self.pending_penalty;
        for (_, listener) in &mut self.solved_listeners {
            listener(result, penalty);
        }
    }

    fn transition(&mut self, state: TimerState, now: f64) {
        self.state = state;
        self.emit(now);
    }

    fn emit(&mut self, now: f64) {
        let snapshot = self.snapshot(now);
        for (_, listener) in &mut self.snapshot_listeners {
            listener(&snapshot);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::rc::Rc;

    use super::*;

    const T0: f64 = 1_000.0;

    fn no_inspection() -> Timer {
        Timer::with_config(TimerConfig {
            inspection: false,
            ..TimerConfig::default()
        })
    }

    fn start_inspection(timer: &mut Timer, at: f64) -> f64 {
        timer.key_down("space", at);
        timer.key_up("space", at + 400.0);
        assert_eq!(timer.state(), TimerState::Inspecting);
        at + 400.0
    }

    #[test]
    fn starts_idle_with_no_result() {
        let timer = Timer::new();
        assert_eq!(timer.state(), TimerState::Idle);
        assert_eq!(timer.last_result_ms(), None);
        assert_eq!(
            timer.snapshot(T0),
            TimerSnapshot {
                state: TimerState::Idle,
                elapsed_ms: 0.0,
                hold_progress: 0.0,
                inspection_ms: 0.0,
                penalty: None,
            }
        );
    }

    #[test]
    fn full_hold_ready_release_stop_cycle() {
        let mut timer = no_inspection();
        let solved = Rc::new(RefCell::new(Vec::new()));
        let seen = solved.clone();
        timer.on_solved(move |ms, penalty| seen.borrow_mut().push((ms, penalty)));

        timer.key_down("space", T0);
        assert_eq!(timer.state(), TimerState::Holding);
        assert_eq!(timer.snapshot(T0).elapsed_ms, 0.0);

        timer.update(T0 + 150.0);
        assert_eq!(timer.state(), TimerState::Holding);
        assert!((timer.snapshot(T0 + 150.0).hold_progress - 0.5).abs() < 1e-9);

        timer.update(T0 + 300.0);
        assert_eq!(timer.state(), TimerState::Ready);
        assert_eq!(timer.snapshot(T0 + 300.0).hold_progress, 1.0);

        timer.key_up("space", T0 + 320.0);
        assert_eq!(timer.state(), TimerState::Running);

        timer.update(T0 + 1_320.0);
        assert_eq!(timer.snapshot(T0 + 1_320.0).elapsed_ms, 1_000.0);

        timer.key_down("x", T0 + 2_320.0);
        assert_eq!(timer.state(), TimerState::Stopped);
        assert_eq!(timer.last_result_ms(), Some(2_000.0));
        let calls = solved.borrow();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0], (2_000.0, None));
        assert_eq!(timer.snapshot(T0 + 2_320.0).elapsed_ms, 2_000.0);
    }

    #[test]
    fn releases_before_the_threshold_cancel_the_hold() {
        let mut timer = no_inspection();
        let solved = Rc::new(RefCell::new(Vec::new()));
        let seen = solved.clone();
        timer.on_solved(move |ms, penalty| seen.borrow_mut().push((ms, penalty)));

        timer.key_down("space", T0);
        timer.key_up("space", T0 + 100.0);

        assert_eq!(timer.state(), TimerState::Idle);
        assert_eq!(timer.snapshot(T0 + 100.0).elapsed_ms, 0.0);
        assert!(solved.borrow().is_empty());
    }

    #[test]
    fn releases_just_after_the_threshold_start_without_a_tick() {
        let mut timer = no_inspection();
        timer.key_down("space", T0);
        timer.key_up("space", T0 + 450.0);
        assert_eq!(timer.state(), TimerState::Running);
        assert_eq!(timer.snapshot(T0 + 450.0).elapsed_ms, 0.0);
    }

    #[test]
    fn update_moves_holding_to_ready_at_the_threshold() {
        let mut timer = no_inspection();
        timer.key_down("space", T0);
        timer.update(T0 + 299.0);
        assert_eq!(timer.state(), TimerState::Holding);
        timer.update(T0 + 301.0);
        assert_eq!(timer.state(), TimerState::Ready);
    }

    #[test]
    fn auto_repeat_does_not_restart_the_hold() {
        let mut timer = no_inspection();
        timer.key_down("space", T0);
        timer.key_down("space", T0 + 50.0);
        timer.key_down("space", T0 + 100.0);
        assert!((timer.snapshot(T0 + 100.0).hold_progress - 100.0 / 300.0).abs() < 1e-9);

        timer.update(T0 + 300.0);
        assert_eq!(timer.state(), TimerState::Ready);
    }

    #[test]
    fn auto_repeat_does_not_stop_a_run_twice() {
        let mut timer = no_inspection();
        let solved = Rc::new(RefCell::new(Vec::new()));
        let seen = solved.clone();
        timer.on_solved(move |ms, _| seen.borrow_mut().push(ms));

        timer.key_down("space", T0);
        timer.update(T0 + 300.0);
        timer.key_up("space", T0 + 320.0);
        assert_eq!(timer.state(), TimerState::Running);

        timer.key_down("x", T0 + 1_320.0);
        timer.key_down("x", T0 + 1_350.0);
        timer.key_down("x", T0 + 1_380.0);
        assert_eq!(timer.state(), TimerState::Stopped);
        assert_eq!(solved.borrow().len(), 1);
        assert_eq!(timer.last_result_ms(), Some(1_000.0));
    }

    #[test]
    fn a_fresh_press_of_the_same_key_arms_again() {
        let mut timer = no_inspection();
        timer.key_down("space", T0);
        timer.key_up("space", T0 + 350.0);
        timer.key_down("space", T0 + 900.0);
        assert_eq!(timer.state(), TimerState::Stopped);

        timer.key_up("space", T0 + 950.0);
        timer.key_down("space", T0 + 1_000.0);
        assert_eq!(timer.state(), TimerState::Holding);
    }

    #[test]
    fn only_the_start_key_arms_the_timer() {
        let mut timer = no_inspection();
        timer.key_down("a", T0);
        assert_eq!(timer.state(), TimerState::Idle);
        timer.key_down("Control_L", T0);
        assert_eq!(timer.state(), TimerState::Idle);
    }

    #[test]
    fn any_fresh_key_stops_a_running_solve() {
        let mut timer = no_inspection();
        timer.key_down("space", T0);
        timer.update(T0 + 300.0);
        timer.key_up("space", T0 + 320.0);

        timer.key_down("Escape", T0 + 520.0);
        assert_eq!(timer.state(), TimerState::Stopped);
        assert_eq!(timer.last_result_ms(), Some(200.0));
    }

    #[test]
    fn arming_ignores_other_keys_and_their_releases() {
        let mut timer = no_inspection();
        timer.key_down("space", T0);
        timer.key_down("a", T0 + 50.0);
        assert_eq!(timer.state(), TimerState::Holding);
        timer.key_up("a", T0 + 60.0);
        assert_eq!(timer.state(), TimerState::Holding);
        timer.update(T0 + 300.0);
        assert_eq!(timer.state(), TimerState::Ready);
    }

    #[test]
    fn a_release_without_a_press_does_nothing() {
        let mut timer = no_inspection();
        timer.key_up("space", T0 + 10.0);
        assert_eq!(timer.state(), TimerState::Idle);
    }

    #[test]
    fn keeps_the_previous_result_visible_while_arming() {
        let mut timer = no_inspection();
        timer.key_down("space", T0);
        timer.update(T0 + 300.0);
        timer.key_up("space", T0 + 320.0);
        timer.key_down("x", T0 + 2_320.0);
        assert_eq!(timer.last_result_ms(), Some(2_000.0));

        timer.key_up("x", T0 + 2_400.0);
        timer.key_down("space", T0 + 2_500.0);
        assert_eq!(timer.state(), TimerState::Holding);
        assert_eq!(timer.snapshot(T0 + 2_500.0).elapsed_ms, 2_000.0);
    }

    #[test]
    fn reports_each_solve_exactly_once() {
        let mut timer = no_inspection();
        let solved = Rc::new(RefCell::new(Vec::new()));
        let seen = solved.clone();
        timer.on_solved(move |ms, penalty| seen.borrow_mut().push((ms, penalty)));

        timer.key_down("space", 0.0);
        timer.update(300.0);
        timer.key_up("space", 320.0);
        timer.key_down("x", 1_320.0);
        assert_eq!(solved.borrow().len(), 1);

        timer.key_up("space", 1_400.0);
        timer.key_down("space", 1_500.0);
        timer.update(1_800.0);
        timer.key_up("space", 1_820.0);
        timer.key_down("y", 2_820.0);
        assert_eq!(solved.borrow().len(), 2);
        assert_eq!(solved.borrow()[1], (1_000.0, None));
    }

    #[test]
    fn emits_on_transitions_but_not_on_idle_updates() {
        let mut timer = no_inspection();
        let seen = Rc::new(RefCell::new(Vec::new()));
        let sink = seen.clone();
        timer.subscribe(move |snapshot| sink.borrow_mut().push(*snapshot));

        timer.update(T0);
        assert!(seen.borrow().is_empty());

        timer.key_down("space", T0);
        assert_eq!(seen.borrow().len(), 1);
        assert_eq!(seen.borrow()[0].state, TimerState::Holding);

        timer.update(T0 + 100.0);
        assert_eq!(seen.borrow().len(), 2);
    }

    #[test]
    fn unsubscribes_cleanly() {
        let mut timer = Timer::new();
        let count = Rc::new(RefCell::new(0));
        let sink = count.clone();
        let id = timer.subscribe(move |_| *sink.borrow_mut() += 1);

        timer.key_down("space", T0);
        assert_eq!(*count.borrow(), 1);
        let before = *count.borrow();

        timer.unsubscribe(id);
        timer.key_down("a", T0 + 10.0);
        assert_eq!(*count.borrow(), before);
    }

    #[test]
    fn reset_clears_the_result_and_held_keys() {
        let mut timer = no_inspection();
        timer.key_down("space", T0);
        timer.update(T0 + 300.0);
        timer.key_up("space", T0 + 320.0);
        timer.key_down("x", T0 + 1_320.0);
        assert_eq!(timer.last_result_ms(), Some(1_000.0));

        timer.reset(T0 + 2_000.0);
        assert_eq!(timer.state(), TimerState::Idle);
        assert_eq!(timer.last_result_ms(), None);
        assert_eq!(timer.snapshot(T0 + 2_000.0).elapsed_ms, 0.0);

        timer.key_up("space", T0 + 2_100.0);
        assert_eq!(timer.state(), TimerState::Idle);
    }

    #[test]
    fn the_first_release_begins_an_inspection() {
        let mut timer = Timer::new();
        let t0 = start_inspection(&mut timer, T0);
        assert_eq!(timer.snapshot(t0).inspection_ms, 0.0);
        assert_eq!(timer.snapshot(t0 + 2_500.0).inspection_ms, 2_500.0);
        assert_eq!(timer.snapshot(t0 + 2_500.0).penalty, None);
    }

    #[test]
    fn the_countdown_stays_live_while_the_solve_is_armed() {
        let mut timer = Timer::new();
        let t0 = start_inspection(&mut timer, T0);
        timer.key_down("space", t0 + 1_000.0);
        assert_eq!(timer.state(), TimerState::Holding);

        let seen = Rc::new(RefCell::new(Vec::new()));
        let sink = seen.clone();
        timer.subscribe(move |snapshot| sink.borrow_mut().push(snapshot.inspection_ms));
        timer.update(t0 + 1_100.0);
        assert_eq!(*seen.borrow().last().unwrap(), 1_100.0);

        timer.update(t0 + 1_400.0);
        assert_eq!(timer.state(), TimerState::Ready);
        assert_eq!(*seen.borrow().last().unwrap(), 1_400.0);

        timer.update(t0 + 2_000.0);
        assert_eq!(*seen.borrow().last().unwrap(), 2_000.0);
    }

    #[test]
    fn a_tap_starts_the_inspection_without_the_hold_threshold() {
        let mut timer = Timer::new();
        timer.key_down("space", T0);
        assert_eq!(timer.state(), TimerState::InspectionReady);
        assert_eq!(timer.snapshot(T0).hold_progress, 1.0);

        timer.key_up("space", T0 + 50.0);
        assert_eq!(timer.state(), TimerState::Inspecting);
        assert_eq!(timer.snapshot(T0 + 50.0).inspection_ms, 0.0);
    }

    #[test]
    fn a_long_press_stays_inspection_ready() {
        let mut timer = Timer::new();
        timer.key_down("space", T0);
        timer.update(T0 + 5_000.0);
        assert_eq!(timer.state(), TimerState::InspectionReady);
        timer.key_up("space", T0 + 5_050.0);
        assert_eq!(timer.state(), TimerState::Inspecting);
    }

    #[test]
    fn the_release_that_stopped_a_solve_does_not_inspect() {
        let mut timer = Timer::new();
        let t0 = start_inspection(&mut timer, T0);

        timer.key_down("space", t0 + 1_000.0);
        timer.key_up("space", t0 + 1_400.0);
        timer.key_down("space", t0 + 2_000.0);
        assert_eq!(timer.state(), TimerState::Stopped);

        timer.key_up("space", t0 + 2_050.0);
        assert_eq!(timer.state(), TimerState::Stopped);
    }

    #[test]
    fn escape_cancels_the_inspection_and_the_next_hold_starts_from_zero() {
        let mut timer = Timer::new();
        let t0 = start_inspection(&mut timer, T0);

        timer.key_down("q", t0 + 1_000.0);
        assert_eq!(timer.state(), TimerState::Inspecting);

        timer.key_down("escape", t0 + 9_000.0);
        assert_eq!(timer.state(), TimerState::Idle);
        assert_eq!(timer.snapshot(t0 + 9_000.0).inspection_ms, 0.0);

        let t1 = start_inspection(&mut timer, t0 + 10_000.0);
        assert_eq!(timer.snapshot(t1).inspection_ms, 0.0);
    }

    #[test]
    fn fires_the_8s_and_12s_cues_once_each_in_order() {
        let mut timer = Timer::new();
        let cues = Rc::new(RefCell::new(Vec::new()));
        let sink = cues.clone();
        timer.on_cue(move |cue| sink.borrow_mut().push(cue));
        let t0 = start_inspection(&mut timer, T0);

        timer.update(t0 + 7_999.0);
        assert!(cues.borrow().is_empty());
        timer.update(t0 + 8_000.0);
        assert_eq!(*cues.borrow(), vec![InspectionCue::Cue8s]);
        timer.update(t0 + 11_999.0);
        assert_eq!(*cues.borrow(), vec![InspectionCue::Cue8s]);
        timer.update(t0 + 12_000.0);
        assert_eq!(
            *cues.borrow(),
            vec![InspectionCue::Cue8s, InspectionCue::Cue12s]
        );
        timer.update(t0 + 40_000.0);
        assert_eq!(
            *cues.borrow(),
            vec![InspectionCue::Cue8s, InspectionCue::Cue12s]
        );
    }

    #[test]
    fn a_jump_past_both_thresholds_fires_both_cues() {
        let mut timer = Timer::new();
        let cues = Rc::new(RefCell::new(Vec::new()));
        let sink = cues.clone();
        timer.on_cue(move |cue| sink.borrow_mut().push(cue));
        let t0 = start_inspection(&mut timer, T0);

        timer.update(t0 + 13_000.0);
        assert_eq!(
            *cues.borrow(),
            vec![InspectionCue::Cue8s, InspectionCue::Cue12s]
        );
    }

    #[test]
    fn an_early_release_cancels_the_pending_cues() {
        let mut timer = Timer::new();
        let cues = Rc::new(RefCell::new(Vec::new()));
        let sink = cues.clone();
        timer.on_cue(move |cue| sink.borrow_mut().push(cue));
        let t0 = start_inspection(&mut timer, T0);

        timer.update(t0 + 4_000.0);
        timer.key_down("space", t0 + 5_000.0);
        timer.key_up("space", t0 + 5_400.0);
        assert_eq!(timer.state(), TimerState::Running);

        timer.update(t0 + 8_000.0);
        timer.update(t0 + 12_500.0);
        timer.update(t0 + 40_000.0);
        assert!(cues.borrow().is_empty());
        assert_eq!(timer.snapshot(t0 + 40_000.0).inspection_ms, 0.0);
    }

    #[test]
    fn cancels_only_the_cue_that_has_not_rung() {
        let mut timer = Timer::new();
        let cues = Rc::new(RefCell::new(Vec::new()));
        let sink = cues.clone();
        timer.on_cue(move |cue| sink.borrow_mut().push(cue));
        let t0 = start_inspection(&mut timer, T0);

        timer.update(t0 + 8_500.0);
        assert_eq!(*cues.borrow(), vec![InspectionCue::Cue8s]);

        timer.key_down("space", t0 + 9_000.0);
        timer.key_up("space", t0 + 9_400.0);
        assert_eq!(timer.state(), TimerState::Running);

        timer.update(t0 + 12_000.0);
        timer.update(t0 + 30_000.0);
        assert_eq!(*cues.borrow(), vec![InspectionCue::Cue8s]);
    }

    #[test]
    fn grades_a_run_by_the_inspection_age_at_start() {
        for (elapsed, expected) in [
            (14_999.0, None),
            (15_000.0, Some(Penalty::Plus2)),
            (16_999.0, Some(Penalty::Plus2)),
            (17_000.0, Some(Penalty::Dnf)),
        ] {
            let mut timer = Timer::new();
            let solved = Rc::new(RefCell::new(Vec::new()));
            let sink = solved.clone();
            timer.on_solved(move |ms, penalty| sink.borrow_mut().push((ms, penalty)));
            let t0 = start_inspection(&mut timer, T0);
            let release_at = t0 + elapsed;

            timer.key_down("space", release_at - 350.0);
            timer.key_up("space", release_at);
            assert_eq!(timer.state(), TimerState::Running);
            assert_eq!(timer.snapshot(release_at).penalty, expected);

            timer.key_down("q", release_at + 2_000.0);
            assert_eq!(solved.borrow()[0], (2_000.0, expected));
        }
    }

    #[test]
    fn the_stopped_readout_keeps_the_grade_until_the_next_hold() {
        let mut timer = Timer::new();
        let t0 = start_inspection(&mut timer, T0);
        let release_at = t0 + 15_000.0;
        timer.key_down("space", release_at - 350.0);
        timer.key_up("space", release_at);
        timer.key_down("q", release_at + 1_500.0);

        assert_eq!(timer.state(), TimerState::Stopped);
        assert_eq!(
            timer.snapshot(release_at + 1_500.0).penalty,
            Some(Penalty::Plus2)
        );

        timer.key_down("space", release_at + 2_000.0);
        assert_eq!(timer.snapshot(release_at + 2_000.0).penalty, None);

        timer.reset(release_at + 3_000.0);
        assert_eq!(
            timer.snapshot(release_at + 3_000.0),
            TimerSnapshot {
                state: TimerState::Idle,
                elapsed_ms: 0.0,
                hold_progress: 0.0,
                inspection_ms: 0.0,
                penalty: None,
            }
        );
    }

    #[test]
    fn an_early_release_during_the_inspection_hold_returns_to_the_countdown() {
        let mut timer = Timer::new();
        let t0 = start_inspection(&mut timer, T0);

        timer.key_down("space", t0 + 5_000.0);
        timer.key_up("space", t0 + 5_100.0);
        assert_eq!(timer.state(), TimerState::Inspecting);
        assert_eq!(timer.snapshot(t0 + 5_100.0).inspection_ms, 5_100.0);
    }

    #[test]
    fn cancel_press_abandons_a_hold_without_inspecting() {
        let mut timer = Timer::new();
        timer.key_down("space", T0);
        assert_eq!(timer.state(), TimerState::InspectionReady);

        timer.cancel_press("space", T0 + 50.0);
        assert_eq!(timer.state(), TimerState::Idle);
        timer.key_up("space", T0 + 60.0);
        assert_eq!(timer.state(), TimerState::Idle);
    }

    #[test]
    fn cancel_press_during_an_inspection_hold_returns_to_the_countdown() {
        let mut timer = Timer::new();
        let t0 = start_inspection(&mut timer, T0);

        timer.key_down("space", t0 + 1_000.0);
        timer.cancel_press("space", t0 + 1_100.0);
        assert_eq!(timer.state(), TimerState::Inspecting);
        assert_eq!(timer.snapshot(t0 + 1_100.0).inspection_ms, 1_100.0);
    }

    #[test]
    fn inspection_off_starts_the_run_directly() {
        let mut timer = Timer::with_config(TimerConfig {
            inspection: false,
            ..TimerConfig::default()
        });
        assert!(!timer.inspection_enabled());

        timer.key_down("space", T0);
        timer.key_up("space", T0 + 400.0);
        assert_eq!(timer.state(), TimerState::Running);
        assert_eq!(timer.snapshot(T0 + 400.0).inspection_ms, 0.0);
        assert_eq!(timer.snapshot(T0 + 400.0).penalty, None);
    }

    #[test]
    fn toggling_off_mid_countdown_cancels_it_and_mid_hold_drops_the_grade() {
        let mut timer = Timer::new();
        let t0 = start_inspection(&mut timer, T0);

        timer.set_inspection(false, t0 + 5_000.0);
        assert_eq!(timer.state(), TimerState::Idle);
        assert_eq!(timer.snapshot(t0 + 5_000.0).inspection_ms, 0.0);

        timer.set_inspection(true, t0 + 6_000.0);
        let t1 = start_inspection(&mut timer, t0 + 7_000.0);

        timer.key_down("space", t1 + 1_000.0);
        timer.set_inspection(false, t1 + 1_100.0);
        assert_eq!(timer.state(), TimerState::Holding);
        timer.key_up("space", t1 + 1_500.0);
        assert_eq!(timer.state(), TimerState::Running);
        assert_eq!(timer.snapshot(t1 + 1_500.0).penalty, None);
    }

    #[test]
    fn toggling_off_mid_hold_and_releasing_early_returns_to_idle() {
        let mut timer = Timer::new();
        let t0 = start_inspection(&mut timer, T0);

        timer.key_down("space", t0 + 1_000.0);
        timer.set_inspection(false, t0 + 1_100.0);
        timer.key_up("space", t0 + 1_200.0);

        assert_eq!(timer.state(), TimerState::Idle);
        assert_eq!(timer.snapshot(t0 + 1_200.0).inspection_ms, 0.0);
    }

    #[test]
    fn turning_inspection_off_while_inspection_ready_cancels_it() {
        let mut timer = Timer::new();
        timer.key_down("space", T0);
        assert_eq!(timer.state(), TimerState::InspectionReady);

        timer.set_inspection(false, T0 + 50.0);
        assert_eq!(timer.state(), TimerState::Idle);
        timer.key_up("space", T0 + 60.0);
        assert_eq!(timer.state(), TimerState::Idle);
    }

    #[test]
    fn a_new_threshold_applies_to_the_next_hold() {
        let mut timer = no_inspection();
        timer.set_hold_threshold(50.0);

        timer.key_down("space", T0);
        timer.update(T0 + 60.0);
        assert_eq!(timer.state(), TimerState::Ready);
    }

    #[test]
    fn out_of_range_thresholds_are_clamped() {
        let mut timer = no_inspection();
        timer.set_hold_threshold(99_999.0);
        timer.key_down("space", T0);
        timer.update(T0 + 2_001.0);
        assert_eq!(timer.state(), TimerState::Ready);

        let mut timer2 = no_inspection();
        timer2.set_hold_threshold(-50.0);
        timer2.key_down("space", T0);
        timer2.update(T0);
        assert_eq!(timer2.state(), TimerState::Ready);
    }

    #[test]
    fn an_unusable_threshold_falls_back_to_the_default() {
        let mut timer = no_inspection();
        timer.set_hold_threshold(f64::NAN);

        timer.key_down("space", T0);
        timer.update(T0 + 250.0);
        assert_eq!(timer.state(), TimerState::Holding);
        timer.update(T0 + 300.0);
        assert_eq!(timer.state(), TimerState::Ready);
    }
}
