use super::*;

impl App {
    pub(super) fn layout_now(&self) {
        self.layout_in_band(None);
    }

    /// `layout_now` with the width band that just applied. The band is stored
    /// first, so later passes in the same resize keep clamping the measured
    /// width even after the content's old, wider allocation comes back
    /// through a surface layout event: the band is what the bin was actually
    /// given, and it may not be overruled by a rectangle that has not caught
    /// up. Without the clamp the old width re-docks the sidebar for a frame,
    /// and the next allocation is measured against a minimum that no longer
    /// fits.
    pub(super) fn layout_in_band(&self, band: Option<(Option<f64>, Option<f64>)>) {
        if let Some((min, max)) = band {
            self.layout_band
                .set((min.unwrap_or(0.0), max.unwrap_or(f64::MAX)));
        }
        // The rectangle the app lives in is `window.content()`'s allocation,
        // not the `Gtk.Window`'s size. `content` is the child of the
        // `Adw.BreakpointBin` the window's own adaptive pass works on, so a
        // tier decided here and a band condition always share one rectangle:
        // in a normal window the bin fills the window, under libadwaita's
        // Adaptive Preview it sits inside the emulated screen (measured there:
        // 360x670 inside a 1000x700 window). Deciding from the window instead
        // kept the desktop layout on a phone-sized preview.
        //
        // It is the whole app, sidebar included — deliberately not the
        // post-sidebar `main_content`, or docking the sidebar would shrink the
        // readout and feed on its own decision.
        let app_area = self.window.content();
        let mut width = app_area.as_ref().map_or(0.0, |area| area.width() as f64);
        let mut height = app_area.as_ref().map_or(0.0, |area| area.height() as f64);
        if width <= 0.0 || height <= 0.0 {
            // Before the first allocation the size we *asked* for is the size
            // that frame is given, so it stands in: laying out at the minimum
            // would draw the timer small and jump once the window is mapped.
            width = self.window.default_width() as f64;
            height = self.window.default_height() as f64;
        }
        if width <= 0.0 || height <= 0.0 {
            return;
        }
        let (band_min, band_max) = self.layout_band.get();
        width = width.clamp(band_min, band_max);
        let prefs = self.preferences.borrow();
        let content = {
            let main_width = self.main_content.width() as f64;
            let main_height = self.main_content.height() as f64;
            if main_width > 0.0 && main_height > 0.0 {
                let docked = width > BREAKPOINTS.drawer_max && self.split.shows_sidebar();
                let gap = if docked {
                    (self.split.width() as f64 - main_width).max(0.0)
                } else {
                    0.0
                };
                Some(ContentSize::with_sidebar(main_width, main_height, gap))
            } else {
                None
            }
        };
        let plan = layout_for(
            width,
            height,
            content,
            SizeScales {
                timer: prefs.timer_scale,
                scramble: prefs.scramble_scale,
                diagram: prefs.diagram_scale,
            },
        );
        drop(prefs);

        if self.split.is_collapsed() != plan.drawer {
            self.split.set_collapsed(plan.drawer);
        }
        if (self.split.max_sidebar_width() - plan.sidebar_max).abs() > f64::EPSILON {
            self.split.set_max_sidebar_width(plan.sidebar_max);
        }
        self.timer_view.set_font_size(plan.timer_px);
        self.panel.set_font_size(plan.scramble_px);
        self.panel
            .set_limits(plan.scramble_chars as i32, plan.scramble_max_height);
        self.panel
            .set_diagram_max(plan.diagram_max_width, plan.diagram_max_height);
        self.place_selectors(plan.selector_row);
        self.apply_diagram_placement(plan.diagram_placement);
        self.sync_start_area();
        // libadwaita re-shows a collapsed split view's sidebar when it
        // uncollapses; the distraction-free view still owns the screen.
        if self.chrome_hidden.get() && self.split.shows_sidebar() {
            self.split.set_show_sidebar(false);
        }
    }

    /// Move the scramble controls between the header and the bottom bar. All
    /// three travel together and the type title stays the header's title
    /// widget at every width, so no widget ever changes parents twice.
    pub(super) fn place_selectors(&self, in_row: bool) {
        if in_row == self.selectors_in_row.get() {
            return;
        }
        self.selectors_in_row.set(in_row);
        if in_row {
            for control in [
                self.refresh_button.clone().upcast::<gtk::Widget>(),
                self.copy_button.clone().upcast(),
                self.type_control.clone().upcast(),
            ] {
                control.unparent();
                self.selector_bar.append(&control);
            }
            self.image_toggle.unparent();
            // The bar's only expanding child, so the toggle sits right.
            self.image_toggle.set_hexpand(true);
            self.selector_bar.append(&self.image_toggle);
        } else {
            self.image_toggle.unparent();
            self.image_toggle.set_hexpand(false);
            // `pack_end` prepends: the toggle lands in front of Cancel and
            // the menu, the order the initial build gives it.
            self.header.pack_end(&self.image_toggle);
            for control in [
                self.refresh_button.clone().upcast::<gtk::Widget>(),
                self.copy_button.clone().upcast(),
                self.type_control.clone().upcast(),
            ] {
                self.selector_bar.remove(&control);
                self.header.pack_start(&control);
            }
        }
        self.sync_bottom_bar();
    }

    /// The bottom bar is only on screen in the narrow layout, and never while
    /// the timer owns the view.
    pub(super) fn sync_bottom_bar(&self) {
        let reveal = self.selectors_in_row.get() && !self.chrome_hidden.get();
        if self.content.reveals_bottom_bars() != reveal {
            self.content.set_reveal_bottom_bars(reveal);
        }
    }

    /// Inset the start target by the drawer's swipe strip while the list is a
    /// drawer, so the gesture that opens it can never arm the timer. The
    /// dashed outline is drawn exactly where the inset applies.
    pub(super) fn sync_start_area(&self) {
        let inset = if self.split.is_collapsed() && !self.chrome_hidden.get() {
            START_AREA_INSET_PX as i32
        } else {
            0
        };
        if inset == self.start_area_inset.get() {
            return;
        }
        self.start_area_inset.set(inset);
        self.start_target.set_margin_start(inset);
        self.start_target.set_margin_end(inset);
        self.start_target.set_margin_top(inset);
        self.start_target.set_margin_bottom(inset);
        if inset > 0 {
            self.start_target.add_css_class("timer-start-area");
        } else {
            self.start_target.remove_css_class("timer-start-area");
        }
    }

    /// The sidebar is part of the distraction-free view too: remember whether
    /// it was open, hide it, and grey out its toggle and Ctrl+B. The drawer's
    /// swipe is off meanwhile, since the start target covers that strip.
    pub(super) fn apply_sidebar_focus(&self, focused: bool) {
        self.split.set_enable_show_gesture(!focused);
        if focused {
            self.sidebar_was_shown.set(self.split.shows_sidebar());
            self.sidebar_toggle.set_sensitive(false);
            self.sidebar_action.set_enabled(false);
            self.split.set_show_sidebar(false);
        } else {
            self.split.set_show_sidebar(self.sidebar_was_shown.get());
            self.sidebar_toggle.set_sensitive(true);
            self.sidebar_action.set_enabled(true);
        }
    }

    pub(super) fn apply_diagram_placement(&self, placement: DiagramPlacement) {
        if self.placed_diagram.get() == Some(placement) {
            return;
        }
        self.placed_diagram.set(Some(placement));

        // Only a child still in the grid may be removed from it: the narrow
        // short layout leaves the dock unparented, and asking the grid to
        // remove it again trips gtk_grid_remove's assertion.
        for child in [
            self.timer_view.widget.clone().upcast::<gtk::Widget>(),
            self.diagram_dock.clone().upcast(),
        ] {
            if child
                .parent()
                .is_some_and(|parent| parent == self.lower_area)
            {
                self.lower_area.remove(&child);
            }
        }
        self.lower_area.set_row_spacing(0);
        if placement == DiagramPlacement::Wide {
            self.lower_area.attach(&self.timer_view.widget, 0, 0, 1, 1);
            self.lower_area.attach(&self.diagram_dock, 1, 0, 1, 1);
        } else if placement == DiagramPlacement::TallNarrow {
            self.lower_area.set_row_spacing(8);
            self.lower_area.attach(&self.timer_view.widget, 0, 0, 1, 1);
            self.lower_area.attach(&self.diagram_dock, 0, 1, 1, 1);
        } else {
            self.lower_area.attach(&self.timer_view.widget, 0, 0, 1, 1);
        }
        self.diagram_dock
            .set_visible(placement != DiagramPlacement::None);
    }
}
