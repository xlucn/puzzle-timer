use super::*;

impl App {
    pub(super) fn on_solved(&self, elapsed_ms: f64, penalty: Option<crate::core::time::Penalty>) {
        let scramble = self.feed.borrow().state().scramble.unwrap_or_default();
        let active_id = self.state.active_id();
        let session = self.state.session(&active_id);
        session.borrow_mut().add(NewSolve {
            time_ms: elapsed_ms,
            scramble,
            scramble_type: self.scramble_type.borrow().clone(),
            created_at_ms: wall_now_ms(),
            penalty,
            comment: None,
        });

        let request = self.feed.borrow_mut().advance();
        self.dispatch(request);
        self.render_feed();
        self.refresh_solves();
    }

    pub(super) fn tick(&self) {
        let now = now_ms();
        self.timer.borrow_mut().update(now);
        self.render_frame();
    }

    /// What one frame shows: the readout, and whether the chrome hides.
    pub(super) fn render_frame(&self) {
        let snapshot = self.timer.borrow().snapshot(now_ms());
        self.timer_view.render(&snapshot);
        self.apply_timer_focus(&snapshot);
    }

    /// The 16 ms frame only runs while it has something to animate: a hold in
    /// progress, an inspection counting down, or a solve being timed. Every
    /// other state is static — a cleared readout, an armed timer waiting for
    /// the release — and does not need a frame.
    pub(super) fn needs_tick(&self) -> bool {
        let snapshot = self.timer.borrow().snapshot(now_ms());
        matches!(
            snapshot.state,
            TimerState::Holding | TimerState::Inspecting | TimerState::Running
        ) || (snapshot.state == TimerState::Ready && snapshot.inspection_ms > 0.0)
    }

    /// Repaint once and keep the frame running only while it is needed.
    pub(super) fn ensure_ticking(&self) {
        self.render_frame();
        if self.tick_source.borrow().is_some() || !self.needs_tick() {
            return;
        }
        let slot = self.slot.clone();
        let id = glib::timeout_add_local(std::time::Duration::from_millis(TICK_MS), move || {
            let Some(app) = slot.borrow().clone() else {
                return glib::ControlFlow::Break;
            };
            app.tick();
            if app.needs_tick() {
                glib::ControlFlow::Continue
            } else {
                *app.tick_source.borrow_mut() = None;
                glib::ControlFlow::Break
            }
        });
        *self.tick_source.borrow_mut() = Some(id);
    }

    /// Arming, inspection and solving are the timer's own view: hide the
    /// scramble, its diagram, the hint/averages, the selector bar and the
    /// solve list, and grey out the list and diagram toggles. The header
    /// stays — it carries Cancel and the app's controls — and everything
    /// returns when the timer is idle or stopped.
    pub(super) fn apply_timer_focus(&self, snapshot: &TimerSnapshot) {
        let focused = !matches!(snapshot.state, TimerState::Idle | TimerState::Stopped);
        self.cancel_inspection
            .set_visible(snapshot.state == TimerState::Inspecting);
        if focused == self.chrome_hidden.get() {
            return;
        }
        self.chrome_hidden.set(focused);
        self.panel.set_chrome_visible(!focused);
        self.timer_view.set_chrome_visible(!focused);
        // The diagram is hidden, so its toggle would only turn on a picture
        // nobody can see.
        self.image_toggle.set_sensitive(!focused);
        self.apply_sidebar_focus(focused);
        self.sync_bottom_bar();
        self.sync_start_area();
    }

    pub(super) fn key_down(&self, id: &str) {
        self.timer.borrow_mut().key_down(id, now_ms());
        if id == "escape" {
            let inspecting = self.timer.borrow().snapshot(now_ms()).state == TimerState::Inspecting;
            if !inspecting && self.split.is_collapsed() {
                self.split.set_show_sidebar(false);
            }
        }
        self.ensure_ticking();
    }

    pub(super) fn key_up(&self, id: &str) {
        self.timer.borrow_mut().key_up(id, now_ms());
        self.ensure_ticking();
    }

    /// The inspection toggle, from Preferences: the countdown may be running,
    /// so this repaints and starts or stops the frame with it.
    pub(super) fn set_inspection(&self, enabled: bool) {
        self.timer.borrow_mut().set_inspection(enabled, now_ms());
        self.ensure_ticking();
    }

    /// A press on the start target. Touch always starts the timer; the mouse
    /// is opt-in so a stray click cannot arm a solve.
    pub(super) fn start_press(&self, touch: bool) {
        if touch || self.preferences.borrow().mouse_start {
            self.key_down(START_KEY);
        }
    }

    pub(super) fn end_press(&self, touch: bool) {
        if touch || self.preferences.borrow().mouse_start {
            self.key_up(START_KEY);
        }
    }
}
