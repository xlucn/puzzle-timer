use super::*;

impl App {
    pub(super) fn refresh_solves(&self) {
        let session = self.state.active_session();
        let session = session.borrow();
        self.times.rebuild(session.solves());
        self.strip.refresh(session.solves());
    }

    pub(super) fn delete_solves(&self, solves: Vec<Solve>) {
        let session = self.state.active_session();
        let removed: Vec<RemovedSolve> = {
            let mut session = session.borrow_mut();
            solves
                .iter()
                .filter_map(|solve| session.remove(solve.id))
                .collect()
        };
        if removed.is_empty() {
            return;
        }
        self.refresh_solves();

        let count = removed.len();
        let toast = adw::Toast::builder()
            .title(t(
                MessageKey::ToastSolvesDeleted,
                &[("count", Param::Number(count as f64))],
            ))
            .button_label(t0(MessageKey::CommonUndo))
            .build();
        let slot = self.slot.clone();
        toast.connect_button_clicked(move |toast| {
            toast.dismiss();
            with_app(&slot, |app| app.restore_solves(removed.clone()));
        });
        self.toast_overlay.add_toast(toast);
    }

    pub(super) fn restore_solves(&self, removed: Vec<RemovedSolve>) {
        let session = self.state.active_session();
        {
            let mut session = session.borrow_mut();
            for removed in removed {
                session.restore(removed);
            }
        }
        self.refresh_solves();
    }

    pub(super) fn delete_selected(&self) {
        if self.timer.borrow().state() == TimerState::Running {
            return;
        }
        let solves = self.times.selected_solves();
        if !solves.is_empty() {
            self.delete_solves(solves);
        }
    }

    pub(super) fn set_selected_penalty(&self, penalty: Option<crate::core::time::Penalty>) {
        if self.timer.borrow().state() == TimerState::Running {
            return;
        }
        let solves = self.times.selected_solves();
        if solves.is_empty() {
            return;
        }
        {
            let session = self.state.active_session();
            let mut session = session.borrow_mut();
            for solve in &solves {
                session.set_penalty(solve.id, penalty);
            }
        }
        self.refresh_solves();
    }

    /// The selection when exactly one row is on it, else the newest solve: the
    /// dialog is one record wide, and the newest is the one being read.
    pub(super) fn edit_selected(&self) {
        if self.timer.borrow().state() == TimerState::Running {
            return;
        }
        let mut solves = self.times.selected_solves();
        if solves.len() != 1 {
            solves = self
                .state
                .active_session()
                .borrow()
                .solves()
                .last()
                .cloned()
                .map(|solve| vec![solve])
                .unwrap_or_default();
        }
        if !solves.is_empty() {
            self.edit_solves(solves);
        }
    }

    pub(super) fn edit_solves(&self, solves: Vec<Solve>) {
        let Some(solve) = solves.first().cloned() else {
            return;
        };
        let session = self.state.active_session();
        let number = session
            .borrow()
            .index_of(solve.id)
            .map_or(0, |index| index + 1);
        solve_editor::open(&self.window, &solve, number, {
            let session = Rc::clone(&session);
            let slot = self.slot.clone();
            move |penalty, comment| {
                {
                    let mut session = session.borrow_mut();
                    session.set_penalty(solve.id, penalty);
                    session.set_comment(solve.id, comment);
                }
                with_app(&slot, |app| app.refresh_solves());
            }
        });
    }
}
