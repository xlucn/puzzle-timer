use super::*;

impl App {
    pub(super) fn dispatch(&self, request: Option<ScrambleRequest>) {
        let Some(request) = request else {
            return;
        };
        let prefs = self.preferences.borrow();
        self.worker.borrow().submit(Job {
            seq: request.seq,
            type_id: request.type_id,
            length: request.length,
            pre_scramble: prefs.pre_scramble.clone(),
            with_image: prefs.scramble_image,
            fast: self.fast_scramble.get(),
        });
    }

    pub(super) fn render_feed(&self) {
        let state = self.feed.borrow().state();
        let image = state
            .scramble
            .as_ref()
            .and_then(|text| self.images.borrow().get(text).cloned());
        self.panel.render(
            state.scramble.as_deref(),
            state.error.as_deref(),
            image.as_deref(),
        );
    }

    pub(super) fn settle(&self, answer: JobResult) {
        let JobResult {
            seq,
            type_id,
            result,
        } = answer;
        let text = result.as_ref().map(|payload| payload.scramble.clone());
        if let Ok(payload) = &result {
            if let Some(image) = &payload.image {
                self.images
                    .borrow_mut()
                    .insert(payload.scramble.clone(), image.clone());
            }
        }
        let warm =
            self.feed
                .borrow_mut()
                .settle(seq, &type_id, text.map_err(|error| error.clone()));
        self.render_feed();
        self.dispatch(warm);
    }

    pub(super) fn start_scramble(&self) {
        let request = self.feed.borrow_mut().start();
        self.dispatch(request);
        self.render_feed();
    }

    pub(super) fn refresh_scramble(&self) {
        let request = self.feed.borrow_mut().refresh();
        self.dispatch(request);
        self.render_feed();
    }

    pub(super) fn set_scramble_image(&self, enabled: bool) {
        {
            let mut prefs = self.preferences.borrow_mut();
            prefs.scramble_image = enabled;
        }
        self.state
            .set_preferences(self.preferences.borrow().clone());
        self.refresh_scramble();
    }

    pub(super) fn set_type(&self, type_id: &str) {
        if *self.scramble_type.borrow() == type_id {
            return;
        }
        *self.scramble_type.borrow_mut() = type_id.to_string();
        // The fast switch is per selection, like the length: a new type gets
        // its own generator rather than inheriting a stand-in.
        self.fast_scramble.set(false);
        // The length lands before the title pass, which mirrors both values
        // into the options popover: it has to see the new type's defaults.
        let length = scramble_length(type_id);
        self.scramble_length.set(length);
        self.update_type_title();
        let request = self.feed.borrow_mut().set_type(type_id, length);
        self.dispatch(request);
        self.render_feed();
    }

    pub(super) fn pick_type(&self, type_id: &str) {
        if *self.scramble_type.borrow() == type_id {
            return;
        }
        let active_id = self.state.active_id();
        self.state
            .with_library(|library| library.set_scramble_type(&active_id, type_id));
        self.state.save_library_index();
        self.set_type(type_id);
    }

    pub(super) fn update_type_title(&self) {
        let (category, name) = scramble_type_title(&self.scramble_type.borrow());
        // Category over name, the two levels csTimer's own menu shows.
        self.type_title.set_title(&t_group(&category));
        self.type_title.set_subtitle(&name);
        // A fixed-length type has no options: detaching the popover is how
        // `Adw.SplitButton` greys only the arrow and leaves the picker live.
        if scramble_length(&self.scramble_type.borrow()) > 0 {
            self.type_control.set_popover(Some(&self.options.popover));
        } else {
            self.options.popover.popdown();
            self.type_control.set_popover(None::<&gtk::Popover>);
        }
        self.sync_scramble_options();
    }

    pub(super) fn sync_scramble_options(&self) {
        self.options.sync(
            &self.scramble_type.borrow(),
            self.scramble_length.get(),
            self.fast_scramble.get(),
        );
    }

    pub(super) fn set_scramble_length(&self, length: u32) {
        self.scramble_length.set(length);
        let request = self.feed.borrow_mut().set_length(length);
        self.dispatch(request);
        self.render_feed();
    }

    pub(super) fn set_fast_scramble(&self, fast: bool) {
        if fast == self.fast_scramble.get() {
            return;
        }
        self.fast_scramble.set(fast);
        self.refresh_scramble();
    }

    pub(super) fn copy_scramble(&self) {
        let state = self.feed.borrow().state();
        if let Some(text) = state.scramble {
            self.window.clipboard().set_text(&text);
            self.toast_overlay
                .add_toast(adw::Toast::new(&t0(MessageKey::ScrambleCopied)));
        }
    }
}
