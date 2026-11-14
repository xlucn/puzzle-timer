//! The GTK/libadwaita layer. This is the only module allowed to import
//! `gtk4` or `libadwaita`.
//!
//! This file assembles the app: the sidebar is the solve list, its header the
//! session switch; the content header keeps the timer's controls (sidebar
//! toggle, type title, refresh, copy, image toggle, the app menu), and the
//! lower area holds the timer and the scramble diagram.

mod charts;
mod font_size;
#[path = "preferences.rs"]
mod preferences_dialog;
mod scramble_options;
mod scramble_panel;
mod scramble_type_picker;
mod session_dialogs;
mod shortcuts;
mod sidebar;
mod solve_editor;
mod state;
mod statistics;
mod stats_strip;
mod timer_view;
mod times_list;

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::{SystemTime, UNIX_EPOCH};

use gtk4 as gtk;
use gtk4::glib::translate::IntoGlib;
use gtk4::prelude::*;
use libadwaita as adw;
use libadwaita::prelude::*;

use crate::core::i18n::{MessageKey, Param, resolve_language, set_locale, t, t_group, t0};
use crate::core::layout::{
    BREAKPOINTS, ContentSize, DiagramPlacement, START_AREA_INSET_PX, SizeScales, layout_for,
};
use crate::core::preferences::{ColorScheme, Preferences};
use crate::core::scramble_feed::{Request as ScrambleRequest, ScrambleFeed};
use crate::core::scramble_types::{SCRAMBLE_DEFAULT_TYPE, scramble_length, scramble_type_title};
use crate::core::session::{NewSolve, RemovedSolve, Solve};
use crate::core::timer::{Timer, TimerConfig, TimerSnapshot, TimerState};
use crate::platform::{audio, meta, random};
use crate::scramble::worker::{Job, JobResult, ScrambleWorker};

use self::scramble_options::ScrambleOptions;
use self::scramble_panel::ScramblePanel;
use self::session_dialogs::prompt_name;
use self::sidebar::SessionMenu;
use self::state::{AppState, NoticeKind};
use self::stats_strip::StatsStrip;
use self::timer_view::TimerView;
use self::times_list::TimesList;

/// ~60 fps is plenty for a centisecond readout, and costs almost nothing.
const TICK_MS: u64 = 16;

/// Identity the core timer uses for the start key.
const START_KEY: &str = "space";

/// Keys carrying these modifiers are left alone entirely, so application
/// accelerators (Ctrl+Q, …) keep working.
fn command_mask() -> gtk::gdk::ModifierType {
    gtk::gdk::ModifierType::CONTROL_MASK
        | gtk::gdk::ModifierType::ALT_MASK
        | gtk::gdk::ModifierType::SUPER_MASK
}

/// The fullscreen menu item reads as an action, not a state: it names what
/// pressing it does.
fn fullscreen_menu_label(window: &impl IsA<gtk::Window>) -> String {
    if window.is_fullscreen() {
        t0(MessageKey::MenuExitFullscreen)
    } else {
        t0(MessageKey::MenuFullscreen)
    }
}

fn modifier_key(key: gtk::gdk::Key) -> bool {
    use gtk::gdk::Key;
    key == Key::Shift_L
        || key == Key::Shift_R
        || key == Key::Control_L
        || key == Key::Control_R
        || key == Key::Alt_L
        || key == Key::Alt_R
        || key == Key::Super_L
        || key == Key::Super_R
        || key == Key::Meta_L
        || key == Key::Meta_R
        || key == Key::Hyper_L
        || key == Key::Hyper_R
        || key == Key::Caps_Lock
        || key == Key::ISO_Level3_Shift
        || key == Key::Mode_switch
}

/// Map a GDK key to the key identity the core expects.
fn key_id(key: gtk::gdk::Key) -> Option<String> {
    if modifier_key(key) {
        return None;
    }
    if key == gtk::gdk::Key::Escape {
        return Some("escape".into());
    }
    if key == gtk::gdk::Key::space {
        return Some(START_KEY.into());
    }
    Some(key.into_glib().to_string())
}

/// Milliseconds on a monotonic clock — immune to wall-clock jumps.
fn now_ms() -> f64 {
    glib::monotonic_time() as f64 / 1000.0
}

/// Milliseconds since the epoch — a solve's wall-clock stamp.
fn wall_now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0.0, |elapsed| elapsed.as_millis() as f64)
}

fn apply_color_scheme(scheme: ColorScheme) {
    adw::StyleManager::default().set_color_scheme(match scheme {
        ColorScheme::Dark => adw::ColorScheme::ForceDark,
        ColorScheme::Light => adw::ColorScheme::ForceLight,
        ColorScheme::System => adw::ColorScheme::Default,
    });
}

type AppSlot = Rc<RefCell<Option<Rc<App>>>>;

fn with_app(slot: &AppSlot, f: impl FnOnce(&App)) {
    let app = slot.borrow().clone();
    if let Some(app) = app {
        f(&app);
    }
}

struct App {
    slot: AppSlot,
    state: Rc<AppState>,
    window: adw::ApplicationWindow,
    preferences: RefCell<Preferences>,

    timer: RefCell<Timer>,
    timer_view: Rc<TimerView>,
    strip: Rc<StatsStrip>,
    times: Rc<TimesList>,
    sidebar: Rc<SessionMenu>,
    panel: Rc<ScramblePanel>,

    split: adw::OverlaySplitView,
    sidebar_toggle: gtk::ToggleButton,
    sidebar_action: gtk::gio::SimpleAction,
    header: adw::HeaderBar,
    selector_bar: gtk::Box,
    content: adw::ToolbarView,
    start_target: gtk::Box,
    cancel_inspection: gtk::Button,
    main_content: gtk::Box,
    lower_area: gtk::Grid,
    diagram_dock: gtk::Box,
    type_title: adw::WindowTitle,
    type_control: adw::SplitButton,
    options: Rc<ScrambleOptions>,
    image_toggle: gtk::ToggleButton,
    refresh_button: gtk::Button,
    copy_button: gtk::Button,
    toast_overlay: adw::ToastOverlay,

    feed: RefCell<ScrambleFeed>,
    worker: RefCell<ScrambleWorker>,
    /// The scrambles whose diagram we have, keyed by the scramble text.
    images: RefCell<std::collections::HashMap<String, String>>,
    scramble_type: RefCell<String>,
    scramble_length: Cell<u32>,
    fast_scramble: Cell<bool>,
    selectors_in_row: Cell<bool>,
    placed_diagram: Cell<Option<DiagramPlacement>>,
    /// The timer owns the view (arming through solving).
    chrome_hidden: Cell<bool>,
    sidebar_was_shown: Cell<bool>,
    start_area_inset: Cell<i32>,
    /// Set when Ctrl+S asks for the menu while the sidebar has no anchor yet.
    pending_menu_popup: Cell<bool>,
    /// The 16 ms frame while the readout has something to animate.
    tick_source: RefCell<Option<glib::SourceId>>,
    /// The session manager while it is open: Ctrl+M and the button toggle it.
    manager_dialog: RefCell<Option<adw::Dialog>>,
}

impl App {
    fn refresh_solves(&self) {
        let session = self.state.active_session();
        let session = session.borrow();
        self.times.rebuild(session.solves());
        self.strip.refresh(session.solves());
    }

    fn layout_now(&self) {
        let mut width = self.window.width() as f64;
        let mut height = self.window.height() as f64;
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

        self.split.set_collapsed(plan.drawer);
        self.split.set_max_sidebar_width(plan.sidebar_max);
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
    fn place_selectors(&self, in_row: bool) {
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
    fn sync_bottom_bar(&self) {
        self.content
            .set_reveal_bottom_bars(self.selectors_in_row.get() && !self.chrome_hidden.get());
    }

    /// Inset the start target by the drawer's swipe strip while the list is a
    /// drawer, so the gesture that opens it can never arm the timer. The
    /// dashed outline is drawn exactly where the inset applies.
    fn sync_start_area(&self) {
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
    fn apply_sidebar_focus(&self, focused: bool) {
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

    fn apply_diagram_placement(&self, placement: DiagramPlacement) {
        if self.placed_diagram.get() == Some(placement) {
            return;
        }
        self.placed_diagram.set(Some(placement));

        self.lower_area.remove(&self.timer_view.widget);
        self.lower_area.remove(&self.diagram_dock);
        if placement == DiagramPlacement::Wide {
            self.lower_area.attach(&self.timer_view.widget, 0, 0, 1, 1);
            self.lower_area.attach(&self.diagram_dock, 1, 0, 1, 1);
        } else if placement == DiagramPlacement::TallNarrow {
            self.lower_area.attach(&self.timer_view.widget, 0, 0, 1, 1);
            self.lower_area.attach(&self.diagram_dock, 0, 1, 1, 1);
        } else {
            self.lower_area.attach(&self.timer_view.widget, 0, 0, 1, 1);
        }
        self.diagram_dock
            .set_visible(placement != DiagramPlacement::None);
    }

    // ---- scrambling --------------------------------------------------------

    fn dispatch(&self, request: Option<ScrambleRequest>) {
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

    fn render_feed(&self) {
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

    fn settle(&self, answer: JobResult) {
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

    fn start_scramble(&self) {
        let request = self.feed.borrow_mut().start();
        self.dispatch(request);
        self.render_feed();
    }

    fn refresh_scramble(&self) {
        let request = self.feed.borrow_mut().refresh();
        self.dispatch(request);
        self.render_feed();
    }

    fn set_scramble_image(&self, enabled: bool) {
        {
            let mut prefs = self.preferences.borrow_mut();
            prefs.scramble_image = enabled;
        }
        self.state
            .set_preferences(self.preferences.borrow().clone());
        self.refresh_scramble();
    }

    fn set_type(&self, type_id: &str) {
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

    fn pick_type(&self, type_id: &str) {
        if *self.scramble_type.borrow() == type_id {
            return;
        }
        let active_id = self.state.active_id();
        self.state
            .with_library(|library| library.set_scramble_type(&active_id, type_id));
        self.state.save_library_index();
        self.set_type(type_id);
    }

    fn update_type_title(&self) {
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

    fn sync_scramble_options(&self) {
        self.options.sync(
            &self.scramble_type.borrow(),
            self.scramble_length.get(),
            self.fast_scramble.get(),
        );
    }

    fn set_scramble_length(&self, length: u32) {
        self.scramble_length.set(length);
        let request = self.feed.borrow_mut().set_length(length);
        self.dispatch(request);
        self.render_feed();
    }

    fn set_fast_scramble(&self, fast: bool) {
        if fast == self.fast_scramble.get() {
            return;
        }
        self.fast_scramble.set(fast);
        self.refresh_scramble();
    }

    // ---- sessions ----------------------------------------------------------

    fn after_session_change(&self) {
        let (entries, active) = self.state.library_snapshot();
        self.sidebar.rebuild(&entries, &active);
        self.refresh_solves();

        let scramble_type = entries
            .iter()
            .find(|entry| entry.id == active)
            .and_then(|entry| entry.scramble_type.clone())
            .unwrap_or_else(|| SCRAMBLE_DEFAULT_TYPE.to_string());
        self.set_type(&scramble_type);
        // `set_type` is a no-op when the type did not change, but the header
        // still has to name it on the first run and after a rename.
        self.update_type_title();
    }

    fn switch_session(&self, id: &str) {
        let changed = self.state.with_library(|library| library.switch_to(id));
        if !changed {
            return;
        }
        self.state.save_library_index();
        self.after_session_change();
    }

    fn new_session(&self) {
        let state = Rc::clone(&self.state);
        let validate =
            Rc::new(move |name: &str| state.with_library(|library| library.name_error(name, None)));
        let slot = self.slot.clone();
        prompt_name(
            &self.window,
            &t0(MessageKey::SessionNew),
            &t0(MessageKey::CommonCreate),
            &t0(MessageKey::SessionNewDescription),
            "",
            validate,
            move |name| {
                with_app(&slot, |app| app.create_session(&name));
            },
        );
    }

    fn create_session(&self, name: &str) {
        let created = self
            .state
            .with_library(|library| library.create(name, None, true).map(|entry| entry.id));
        if created.is_none() {
            return;
        }
        self.state.save_library_index();
        // A brand-new session has no file yet: seed the cache so the list
        // reads it immediately instead of an empty file on disk.
        self.after_session_change();
    }

    fn manage_sessions(&self) {
        self::session_manager::open(&self.window, self);
    }

    fn rename_session(&self, id: &str, current: &str) {
        let state = Rc::clone(&self.state);
        let id = id.to_string();
        let validate = {
            let id = id.clone();
            Rc::new(move |name: &str| {
                state.with_library(|library| library.name_error(name, Some(&id)))
            })
        };
        let slot = self.slot.clone();
        prompt_name(
            &self.window,
            &t0(MessageKey::SessionRename),
            &t0(MessageKey::CommonRename),
            "",
            current,
            validate,
            move |name| {
                with_app(&slot, |app| app.apply_rename(&id, &name));
            },
        );
    }

    fn apply_rename(&self, id: &str, name: &str) {
        if self.state.with_library(|library| library.rename(id, name)) {
            self.state.save_library_index();
            let (entries, active) = self.state.library_snapshot();
            self.sidebar.rebuild(&entries, &active);
        }
    }

    fn apply_delete_session(&self, id: &str) {
        if self.state.with_library(|library| library.remove(id)) {
            self.state.forget_session(id);
            self.state.store().borrow_mut().delete_session_file(id);
            self.state.save_library_index();
            self.after_session_change();
        }
    }

    fn move_session(&self, id: &str, to_index: isize) {
        if self
            .state
            .with_library(|library| library.move_entry(id, to_index))
        {
            self.state.save_library_index();
            let (entries, active) = self.state.library_snapshot();
            self.sidebar.rebuild(&entries, &active);
        }
    }

    // ---- solves ------------------------------------------------------------

    fn delete_solves(&self, solves: Vec<Solve>) {
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

    fn restore_solves(&self, removed: Vec<RemovedSolve>) {
        let session = self.state.active_session();
        {
            let mut session = session.borrow_mut();
            for removed in removed {
                session.restore(removed);
            }
        }
        self.refresh_solves();
    }

    fn delete_selected(&self) {
        if self.timer.borrow().state() == TimerState::Running {
            return;
        }
        let solves = self.times.selected_solves();
        if !solves.is_empty() {
            self.delete_solves(solves);
        }
    }

    fn set_selected_penalty(&self, penalty: Option<crate::core::time::Penalty>) {
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
    fn edit_selected(&self) {
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

    fn copy_scramble(&self) {
        let state = self.feed.borrow().state();
        if let Some(text) = state.scramble {
            self.window.clipboard().set_text(&text);
            self.toast_overlay
                .add_toast(adw::Toast::new(&t0(MessageKey::ScrambleCopied)));
        }
    }

    fn import_data(&self) {
        let dialog = gtk::FileDialog::builder()
            .title(t0(MessageKey::TransferImportTitle))
            .build();
        let slot = self.slot.clone();
        dialog.open(
            Some(&self.window),
            None::<&gtk::gio::Cancellable>,
            move |result| {
                let Ok(file) = result else {
                    return;
                };
                let Some(path) = file.path() else {
                    return;
                };
                let text = match crate::platform::transfer::read_text(&path) {
                    Ok(text) => text,
                    Err(error) => {
                        eprintln!("[import] {}: {error}", path.display());
                        with_app(&slot, |app| {
                            app.toast_overlay
                                .add_toast(adw::Toast::new(&t0(MessageKey::TransferImportFailed)))
                        });
                        return;
                    }
                };
                with_app(&slot, |app| app.apply_import(&text));
            },
        );
    }

    fn apply_import(&self, text: &str) {
        let parsed = match crate::core::cs_timer_format::parse_cs_timer_data(text) {
            Ok(parsed) => parsed,
            Err(error) => {
                eprintln!("[import] {error}");
                self.toast_overlay
                    .add_toast(adw::Toast::new(&t0(MessageKey::TransferImportFailed)));
                return;
            }
        };
        for warning in &parsed.warnings {
            eprintln!("[import] {warning}");
        }
        let state = Rc::clone(&self.state);
        let summary = self.state.with_library(|library| {
            crate::core::session_import::import_into_library(
                library,
                &parsed.sessions,
                &mut |entry, solves| state.seed_session(&entry.id, solves.to_vec()),
            )
        });
        if summary.session_count == 0 {
            self.toast_overlay
                .add_toast(adw::Toast::new(&t0(MessageKey::TransferImportFailed)));
            return;
        }
        self.state.save_library_index();
        self.after_session_change();
        self.state.flush();
        let sessions = t(
            MessageKey::TransferImportSessions,
            &[("count", Param::Number(summary.session_count as f64))],
        );
        let solves = t(
            MessageKey::TransferImportSolves,
            &[("count", Param::Number(summary.solve_count as f64))],
        );
        self.toast_overlay.add_toast(adw::Toast::new(&t(
            MessageKey::TransferImportDone,
            &[
                ("sessions", Param::Text(&sessions)),
                ("solves", Param::Text(&solves)),
            ],
        )));
    }

    fn export_data(&self) {
        let dialog = gtk::FileDialog::builder()
            .title(t0(MessageKey::TransferExportTitle))
            .initial_name("puzzle-timer.json")
            .build();
        let slot = self.slot.clone();
        dialog.save(
            Some(&self.window),
            None::<&gtk::gio::Cancellable>,
            move |result| {
                let Ok(file) = result else {
                    return;
                };
                let Some(path) = file.path() else {
                    return;
                };
                with_app(&slot, |app| app.write_export(&path));
            },
        );
    }

    fn write_export(&self, path: &std::path::Path) {
        let (entries, _) = self.state.library_snapshot();
        let sessions: Vec<_> = entries
            .iter()
            .map(|entry| {
                (
                    entry.clone(),
                    self.state.session(&entry.id).borrow().solves().to_vec(),
                )
            })
            .collect();
        let exports: Vec<crate::core::cs_timer_format::ExportSession<'_>> = sessions
            .iter()
            .map(
                |(entry, solves)| crate::core::cs_timer_format::ExportSession {
                    name: &entry.name,
                    scramble_type: entry.scramble_type.as_deref(),
                    solves,
                },
            )
            .collect();
        let data = crate::core::cs_timer_format::format_cs_timer_data(&exports);
        match crate::platform::transfer::write_text(path, &data) {
            Ok(()) => {
                let name = path
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_default();
                self.toast_overlay.add_toast(adw::Toast::new(&t(
                    MessageKey::TransferExportDone,
                    &[("name", Param::Text(&name))],
                )));
            }
            Err(error) => {
                eprintln!("[export] {}: {error}", path.display());
                self.toast_overlay
                    .add_toast(adw::Toast::new(&t0(MessageKey::TransferExportFailed)));
            }
        }
    }

    /// Ctrl+S and the popover button share one path: close it if open, pop it
    /// if the button is on screen, and otherwise reveal the sidebar and pop it
    /// on the frame the button maps.
    fn show_session_menu(&self) {
        if self.chrome_hidden.get() {
            return;
        }
        let button = &self.sidebar.session_button;
        if button.is_active() {
            button.popdown();
            return;
        }
        if button.is_mapped() {
            button.popup();
            return;
        }
        self.pending_menu_popup.set(true);
        self.sidebar_toggle.set_active(true);
    }

    fn delete_active_session(&self) {
        let (entries, active) = self.state.library_snapshot();
        if entries.len() <= 1 {
            return;
        }
        let Some(entry) = entries.iter().find(|entry| entry.id == active) else {
            return;
        };
        let name = entry.name.clone();
        let id = entry.id.clone();
        let solve_count = self.state.session(&id).borrow().len();
        let slot = self.slot.clone();
        session_dialogs::confirm_delete(&self.window, &name, solve_count, move || {
            with_app(&slot, |app| app.apply_delete_session(&id));
        });
    }

    fn rename_active(&self) {
        let (entries, active) = self.state.library_snapshot();
        if let Some(entry) = entries.iter().find(|entry| entry.id == active) {
            self.rename_session(&entry.id, &entry.name);
        }
    }

    fn edit_solves(&self, solves: Vec<Solve>) {
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

    // ---- timer -------------------------------------------------------------

    fn on_solved(&self, elapsed_ms: f64, penalty: Option<crate::core::time::Penalty>) {
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

    fn tick(&self) {
        let now = now_ms();
        self.timer.borrow_mut().update(now);
        self.render_frame();
    }

    /// What one frame shows: the readout, and whether the chrome hides.
    fn render_frame(&self) {
        let snapshot = self.timer.borrow().snapshot(now_ms());
        self.timer_view.render(&snapshot);
        self.apply_timer_focus(&snapshot);
    }

    /// The 16 ms frame only runs while it has something to animate: a hold in
    /// progress, an inspection counting down, or a solve being timed. Every
    /// other state is static — a cleared readout, an armed timer waiting for
    /// the release — and does not need a frame.
    fn needs_tick(&self) -> bool {
        let snapshot = self.timer.borrow().snapshot(now_ms());
        matches!(
            snapshot.state,
            TimerState::Holding | TimerState::Inspecting | TimerState::Running
        ) || (snapshot.state == TimerState::Ready && snapshot.inspection_ms > 0.0)
    }

    /// Repaint once and keep the frame running only while it is needed.
    fn ensure_ticking(&self) {
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
    fn apply_timer_focus(&self, snapshot: &TimerSnapshot) {
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

    fn key_down(&self, id: &str) {
        self.timer.borrow_mut().key_down(id, now_ms());
        if id == "escape" {
            let inspecting = self.timer.borrow().snapshot(now_ms()).state == TimerState::Inspecting;
            if !inspecting && self.split.is_collapsed() {
                self.split.set_show_sidebar(false);
            }
        }
        self.ensure_ticking();
    }

    fn key_up(&self, id: &str) {
        self.timer.borrow_mut().key_up(id, now_ms());
        self.ensure_ticking();
    }

    /// The inspection toggle, from Preferences: the countdown may be running,
    /// so this repaints and starts or stops the frame with it.
    fn set_inspection(&self, enabled: bool) {
        self.timer.borrow_mut().set_inspection(enabled, now_ms());
        self.ensure_ticking();
    }

    fn start_mouse(&self) {
        if self.preferences.borrow().mouse_start {
            self.key_down(START_KEY);
        }
    }

    fn end_mouse(&self) {
        if self.preferences.borrow().mouse_start {
            self.key_up(START_KEY);
        }
    }

    /// Report the store's notices: each source has its own headline toast,
    /// and the detail has already gone to stderr. The sink makes every later
    /// one — a session file opened for the first time — toast when it happens.
    fn toast_notices(&self) {
        let slot = self.slot.clone();
        self.state.set_notice_sink(Rc::new(move |kind| {
            with_app(&slot, |app| app.toast_notice(kind));
        }));
        for kind in self.state.take_notices() {
            self.toast_notice(kind);
        }
    }

    fn toast_notice(&self, kind: NoticeKind) {
        let key = match kind {
            NoticeKind::SessionList => MessageKey::ToastSessionListUnreadable,
            NoticeKind::SessionFile => MessageKey::ToastSessionFileUnreadable,
            NoticeKind::Settings => MessageKey::ToastSettingsUnreadable,
        };
        let toast = adw::Toast::builder().title(t0(key)).timeout(10).build();
        self.toast_overlay.add_toast(toast);
    }

    fn about(&self) {
        let dialog = adw::AboutDialog::builder()
            .application_name(t0(MessageKey::AppName))
            .application_icon("puzzle-timer")
            .developer_name("Lu Xu")
            .version(meta::APP_VERSION)
            .website(meta::APP_REPOSITORY)
            .issue_url(meta::APP_ISSUES)
            .comments(t0(MessageKey::AppAboutComments))
            .copyright("© 2026 Lu Xu")
            .license_type(gtk::License::Gpl30)
            .build();
        if let Some(notes) = meta::release_notes_html() {
            dialog.set_release_notes(&notes);
            dialog.set_release_notes_version(meta::APP_VERSION);
        }
        dialog.add_acknowledgement_section(
            Some(&t0(MessageKey::AppAboutBuiltWith)),
            &[
                "csTimer and cstimer_module by Shuang Chen",
                "GTK and libadwaita",
                "JavaScriptCore",
            ],
        );
        dialog.present(Some(&self.window));
    }
}

mod session_manager;

/// Install the stylesheet for this display.
pub fn load_css() {
    let provider = gtk::CssProvider::new();
    provider.load_from_string(include_str!("../../style.css"));

    if let Some(display) = gtk::gdk::Display::default() {
        // In a source checkout the icons are beside `src/`; a packaged build
        // picks them up from `/usr/share/icons` through the normal theme path.
        let dev_icons = concat!(env!("CARGO_MANIFEST_DIR"), "/data/icons");
        if std::path::Path::new(dev_icons).is_dir() {
            gtk::IconTheme::for_display(&display).add_search_path(dev_icons);
        }

        gtk::style_context_add_provider_for_display(
            &display,
            &provider,
            gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
        );
    }
}

/// Build the window and run the app.
pub fn build_window(application: &adw::Application) {
    let state = AppState::load();
    let preferences = state.preferences();
    let system_tag = glib::language_names()
        .first()
        .map(|name| name.to_string())
        .unwrap_or_default();
    set_locale(resolve_language(preferences.language, &system_tag).tag());
    apply_color_scheme(preferences.color_scheme);

    let window = adw::ApplicationWindow::builder()
        .application(application)
        .title(t0(MessageKey::AppName))
        .default_width(900)
        .default_height(540)
        .width_request(BREAKPOINTS.min_width as i32)
        .height_request(BREAKPOINTS.min_height as i32)
        .build();

    let slot: AppSlot = Rc::default();

    // ---- timer, strip, scramble panel -------------------------------------
    let strip = StatsStrip::new();
    let timer_view = TimerView::new(Rc::clone(&strip));
    let panel = ScramblePanel::new();

    let timer = Timer::with_config(TimerConfig {
        hold_threshold_ms: preferences.hold_threshold_ms,
        start_key: START_KEY.into(),
        inspection: preferences.inspection,
    });

    // ---- sidebar header ---------------------------------------------------
    let sidebar = SessionMenu::new(
        application,
        {
            let slot = Rc::clone(&slot);
            move |id: &str| with_app(&slot, |app| app.switch_session(id))
        },
        {
            let slot = Rc::clone(&slot);
            move || with_app(&slot, |app| app.new_session())
        },
        {
            let slot = Rc::clone(&slot);
            move || with_app(&slot, |app| app.rename_active())
        },
        {
            let slot = Rc::clone(&slot);
            move || with_app(&slot, |app| app.delete_active_session())
        },
        {
            let slot = Rc::clone(&slot);
            move || with_app(&slot, |app| app.manage_sessions())
        },
    );

    let times = TimesList::new(
        &sidebar.session_button,
        &sidebar.new_button,
        &sidebar.manager_button,
        {
            let slot = Rc::clone(&slot);
            move |solves: Vec<Solve>| with_app(&slot, |app| app.delete_solves(solves))
        },
        {
            let slot = Rc::clone(&slot);
            move |solves: Vec<Solve>| with_app(&slot, |app| app.edit_solves(solves))
        },
    );

    // ---- content header ----------------------------------------------------
    // The centre slot names the scramble type (category over name); the
    // controls around it act on that scramble. `show_title` stays on — with a
    // custom title widget the property is what decides whether the slot is
    // drawn at all.
    let header = adw::HeaderBar::builder().show_title(true).build();
    let toggle = gtk::ToggleButton::builder()
        .icon_name("sidebar-show-symbolic")
        .tooltip_text(t0(MessageKey::MenuShowList))
        .active(true)
        .css_classes(["flat"])
        .build();
    header.pack_start(&toggle);

    let type_title = adw::WindowTitle::new("", "");
    let options = ScrambleOptions::new(
        {
            let slot = Rc::clone(&slot);
            move |length| with_app(&slot, |app| app.set_scramble_length(length))
        },
        {
            let slot = Rc::clone(&slot);
            move |fast| with_app(&slot, |app| app.set_fast_scramble(fast))
        },
    );
    {
        let slot = Rc::clone(&slot);
        options
            .popover
            .connect_show(move |_| with_app(&slot, |app| app.sync_scramble_options()));
    }

    let refresh_button = gtk::Button::builder()
        .icon_name("view-refresh-symbolic")
        .tooltip_text(t0(MessageKey::ScrambleNew))
        .css_classes(["flat"])
        .build();
    let copy_button = gtk::Button::builder()
        .icon_name("edit-copy-symbolic")
        .tooltip_text(t0(MessageKey::ScrambleCopy))
        .css_classes(["flat"])
        .build();

    // One `Adw.SplitButton`, two halves: the button opens the picker, the
    // arrow opens the current type's options. The halves have to disagree —
    // a type with a fixed length has no options but is still choosable — so
    // the popover is detached for those and libadwaita greys only the arrow.
    let type_control = adw::SplitButton::builder()
        .icon_name("view-grid-symbolic")
        .tooltip_text(t0(MessageKey::ScrambleChooseType))
        .dropdown_tooltip(t0(MessageKey::ScrambleOptions))
        .popover(&options.popover)
        .css_classes(["flat"])
        .build();
    header.set_title_widget(Some(&type_title));
    header.pack_start(&refresh_button);
    header.pack_start(&copy_button);
    header.pack_start(&type_control);

    // Icon-only: the type name is the title, so this only says "picture".
    // It rides the header's end box beside Cancel and the menu; `halign END`
    // right-aligns it once the narrow layout moves it into the bottom bar.
    let image_toggle = gtk::ToggleButton::builder()
        .icon_name("image-x-generic-symbolic")
        .tooltip_text(t0(MessageKey::ScrambleImage))
        .active(preferences.scramble_image)
        .halign(gtk::Align::End)
        .css_classes(["flat"])
        .build();

    // Escape's job with no keyboard: an inspection otherwise has no visible
    // way out. The button taps the same Escape key, so one cancellation route
    // exists for both, and it is only shown while inspecting.
    let cancel_inspection = gtk::Button::builder()
        .label(t0(MessageKey::CommonCancel))
        .tooltip_text(t0(MessageKey::MenuCancelInspection))
        .css_classes(["destructive-action"])
        .visible(false)
        .build();

    // The narrow layout's home for the scramble controls. Only `reveal-bars`
    // decides whether the bar is on screen, so it stays visible here.
    let selector_bar = gtk::Box::builder()
        .orientation(gtk::Orientation::Horizontal)
        .css_classes(["toolbar"])
        .build();

    // ---- lower area --------------------------------------------------------
    let lower_area = gtk::Grid::builder()
        .row_spacing(8)
        .hexpand(true)
        .vexpand(true)
        .build();
    lower_area.attach(&timer_view.widget, 0, 0, 1, 1);
    let diagram_dock = gtk::Box::builder()
        .orientation(gtk::Orientation::Horizontal)
        .halign(gtk::Align::End)
        .valign(gtk::Align::End)
        .build();
    diagram_dock.append(&panel.image);
    lower_area.attach(&diagram_dock, 0, 1, 1, 1);

    // The timer's start target is an overlay child, so it never joins the size
    // request; it is inset from the edges to leave the drawer's swipe strip.
    let start_target = gtk::Box::builder()
        .hexpand(true)
        .vexpand(true)
        .margin_top(START_AREA_INSET_PX as i32)
        .margin_bottom(START_AREA_INSET_PX as i32)
        .margin_start(START_AREA_INSET_PX as i32)
        .margin_end(START_AREA_INSET_PX as i32)
        .build();
    let start_area = gtk::Overlay::builder().child(&lower_area).build();
    start_area.add_overlay(&start_target);

    let main_content = gtk::Box::new(gtk::Orientation::Vertical, 0);
    main_content.append(&panel.widget);
    main_content.append(&start_area);

    let content = adw::ToolbarView::builder()
        .top_bar_style(adw::ToolbarStyle::Flat)
        .bottom_bar_style(adw::ToolbarStyle::Flat)
        .reveal_bottom_bars(false)
        .build();
    content.add_top_bar(&header);
    content.add_bottom_bar(&selector_bar);
    content.set_content(Some(&main_content));

    let split = adw::OverlaySplitView::builder()
        .content(&content)
        .sidebar(&times.widget)
        .sidebar_position(gtk::PackType::Start)
        .min_sidebar_width(BREAKPOINTS.sidebar_min)
        .max_sidebar_width(320.0)
        .sidebar_width_unit(adw::LengthUnit::Px)
        .show_sidebar(true)
        .build();

    split
        .bind_property("show-sidebar", &toggle, "active")
        .sync_create()
        .bidirectional()
        .build();

    // Ctrl+B and the toggle are the same switch; the action is kept so the
    // timer's view can disable both at once.
    let sidebar_action = gtk::gio::SimpleAction::new("sidebar", None);
    {
        let split = split.clone();
        sidebar_action.connect_activate(move |_, _| {
            split.set_show_sidebar(!split.shows_sidebar());
        });
    }
    application.add_action(&sidebar_action);

    let toast_overlay = adw::ToastOverlay::new();
    toast_overlay.set_child(Some(&split));
    window.set_content(Some(&toast_overlay));

    // A popover cannot anchor to an unmapped button, so Ctrl+S with the
    // sidebar closed reveals it first and the menu opens on the map.
    {
        let slot = Rc::clone(&slot);
        let button = sidebar.session_button.clone();
        button.connect_map(move |button| {
            let wanted = slot
                .borrow()
                .clone()
                .is_some_and(|app| app.pending_menu_popup.replace(false));
            if wanted {
                button.popup();
            }
        });
    }

    let feed = ScrambleFeed::new(
        SCRAMBLE_DEFAULT_TYPE,
        scramble_length(SCRAMBLE_DEFAULT_TYPE),
    );
    let worker = ScrambleWorker::spawn(random::random_seed());

    let app = Rc::new(App {
        slot: Rc::clone(&slot),
        state,
        window: window.clone(),
        preferences: RefCell::new(preferences),
        timer: RefCell::new(timer),
        timer_view: Rc::clone(&timer_view),
        strip,
        times,
        sidebar,
        panel,
        split: split.clone(),
        sidebar_toggle: toggle.clone(),
        sidebar_action: sidebar_action.clone(),
        header: header.clone(),
        selector_bar,
        content: content.clone(),
        start_target: start_target.clone(),
        cancel_inspection: cancel_inspection.clone(),
        main_content,
        lower_area,
        diagram_dock,
        type_title,
        type_control: type_control.clone(),
        options,
        image_toggle: image_toggle.clone(),
        refresh_button: refresh_button.clone(),
        copy_button: copy_button.clone(),
        toast_overlay: toast_overlay.clone(),
        feed: RefCell::new(feed),
        worker: RefCell::new(worker),
        images: RefCell::new(std::collections::HashMap::new()),
        scramble_type: RefCell::new(SCRAMBLE_DEFAULT_TYPE.to_string()),
        scramble_length: Cell::new(scramble_length(SCRAMBLE_DEFAULT_TYPE)),
        fast_scramble: Cell::new(false),
        selectors_in_row: Cell::new(false),
        placed_diagram: Cell::new(None),
        chrome_hidden: Cell::new(false),
        sidebar_was_shown: Cell::new(true),
        start_area_inset: Cell::new(-1),
        pending_menu_popup: Cell::new(false),
        tick_source: RefCell::new(None),
        manager_dialog: RefCell::new(None),
    });
    *slot.borrow_mut() = Some(Rc::clone(&app));

    // ---- solve and cue listeners ------------------------------------------
    {
        let slot = Rc::clone(&slot);
        app.timer.borrow_mut().on_solved(move |elapsed, penalty| {
            with_app(&slot, |app| app.on_solved(elapsed, penalty));
        });
    }
    app.timer.borrow_mut().on_cue(audio::play_inspection_cue);

    // ---- header controls ---------------------------------------------------
    {
        let slot = Rc::clone(&slot);
        refresh_button.connect_clicked(move |_| with_app(&slot, |app| app.refresh_scramble()));
    }
    {
        let slot = Rc::clone(&slot);
        copy_button.connect_clicked(move |_| with_app(&slot, |app| app.copy_scramble()));
    }
    {
        let slot = Rc::clone(&slot);
        image_toggle.connect_toggled(move |toggle| {
            let enabled = toggle.is_active();
            with_app(&slot, |app| {
                if app.preferences.borrow().scramble_image != enabled {
                    app.set_scramble_image(enabled);
                }
            });
        });
    }
    {
        let slot = Rc::clone(&slot);
        type_control.connect_clicked(move |_| {
            with_app(&slot, |app| {
                let current = app.scramble_type.borrow().clone();
                let slot = Rc::clone(&slot);
                scramble_type_picker::open(&app.window, &current, move |id| {
                    with_app(&slot, |app| app.pick_type(id));
                });
            });
        });
    }

    // ---- app menu ----------------------------------------------------------
    {
        // Four sections (Statistics, Data, application actions, then window
        // actions); a section boundary is what draws the separator, so
        // Fullscreen and Quit sit apart at the end.
        let statistics_section = gtk::gio::Menu::new();
        statistics_section.append(
            Some(&t0(MessageKey::MenuStatistics)),
            Some("app.statistics"),
        );

        let data_section = gtk::gio::Menu::new();
        data_section.append(
            Some(&t0(MessageKey::MenuImportData)),
            Some("app.import-data"),
        );
        data_section.append(
            Some(&t0(MessageKey::MenuExportData)),
            Some("app.export-data"),
        );

        let application_section = gtk::gio::Menu::new();
        application_section.append(
            Some(&t0(MessageKey::MenuPreferences)),
            Some("app.preferences"),
        );
        application_section.append(Some(&t0(MessageKey::MenuShortcuts)), Some("app.shortcuts"));
        application_section.append(
            Some(&t(
                MessageKey::MenuAbout,
                &[("name", Param::Text(&t0(MessageKey::AppName)))],
            )),
            Some("app.about"),
        );

        let window_section = gtk::gio::Menu::new();
        // The label is the only state indicator: a checkable item would make
        // GTK reserve a check column on every row of the menu.
        window_section.append(
            Some(&fullscreen_menu_label(&window)),
            Some("app.fullscreen"),
        );
        window_section.append(Some(&t0(MessageKey::MenuQuit)), Some("app.quit"));

        let menu = gtk::gio::Menu::new();
        menu.append_section(None, &statistics_section);
        menu.append_section(None, &data_section);
        menu.append_section(None, &application_section);
        menu.append_section(None, &window_section);

        // F11 toggles both ways, so leaving fullscreen never depends on
        // reaching this menu from the fullscreen view; the label follows the
        // window either way.
        {
            let window_section = window_section.clone();
            window.connect_notify_local(Some("fullscreened"), move |window, _| {
                window_section.remove(0);
                window_section.insert(
                    0,
                    Some(&fullscreen_menu_label(window)),
                    Some("app.fullscreen"),
                );
            });
        }

        let menu_button = gtk::MenuButton::builder()
            .icon_name("open-menu-symbolic")
            .tooltip_text(t0(MessageKey::MenuMain))
            .menu_model(&menu)
            .primary(true)
            .css_classes(["flat"])
            .build();
        // `pack_end` prepends: the end box then reads image → Cancel → menu,
        // the menu at the header's edge next to the window controls.
        header.pack_end(&menu_button);
        header.pack_end(&cancel_inspection);
        header.pack_end(&image_toggle);
    }

    // ---- actions -----------------------------------------------------------
    install_actions(&app, application);

    // ---- input -------------------------------------------------------------
    install_keys(&app, &start_target);

    // ---- resize ------------------------------------------------------------
    {
        let slot = Rc::clone(&slot);
        window.connect_notify_local(Some("default-width"), move |_, _| {
            with_app(&slot, |app| app.layout_now())
        });
    }
    // The toplevel has no surface until it is realized, so the first layout
    // hook can only be attached there — asking now (before present) finds
    // `None` and would leave the window laid out at whatever the minimum gave
    // until the user resized it.
    {
        let slot = Rc::clone(&slot);
        window.connect_realize(move |window| {
            let Some(surface) = window.surface() else {
                return;
            };
            let slot = Rc::clone(&slot);
            surface.connect_layout(move |_, _, _| {
                with_app(&slot, |app| app.layout_now());
            });
        });
    }

    // ---- startup -----------------------------------------------------------
    app.after_session_change();
    app.start_scramble();
    app.layout_now();
    app.ensure_ticking();
    app.toast_notices();

    // ---- result reader -----------------------------------------------------
    {
        let results = app.worker.borrow().results();
        let slot = Rc::clone(&slot);
        glib::spawn_future_local(async move {
            while let Ok(answer) = results.recv().await {
                with_app(&slot, |app| app.settle(answer));
            }
        });
    }

    // ---- close -------------------------------------------------------------
    {
        let state = Rc::clone(&app.state);
        window.connect_close_request(move |_| {
            state.flush();
            glib::Propagation::Proceed
        });
    }

    window.present();
}

fn install_keys(app: &Rc<App>, start_target: &gtk::Box) {
    let keys = gtk::EventControllerKey::new();
    keys.set_propagation_phase(gtk::PropagationPhase::Capture);
    {
        let slot = Rc::clone(&app.slot);
        keys.connect_key_pressed(move |_, keyval, _, modifiers| {
            if modifiers.intersects(command_mask()) {
                return glib::Propagation::Proceed;
            }
            let Some(id) = key_id(keyval) else {
                return glib::Propagation::Proceed;
            };
            with_app(&slot, |app| app.key_down(&id));
            glib::Propagation::Stop
        });
    }
    {
        let slot = Rc::clone(&app.slot);
        keys.connect_key_released(move |_, keyval, _, _| {
            if let Some(id) = key_id(keyval) {
                with_app(&slot, |app| app.key_up(&id));
            }
        });
    }
    app.window.add_controller(keys);

    let gesture = gtk::GestureClick::new();
    gesture.set_button(1);
    {
        let slot = Rc::clone(&app.slot);
        gesture.connect_pressed(move |_, _, _, _| {
            with_app(&slot, |app| app.start_mouse());
        });
    }
    {
        let slot = Rc::clone(&app.slot);
        gesture.connect_released(move |_, _, _, _| {
            with_app(&slot, |app| app.end_mouse());
        });
    }
    start_target.add_controller(gesture);
}

fn install_actions(app: &Rc<App>, application: &adw::Application) {
    let fullscreen = gtk::gio::SimpleAction::new("fullscreen", None);
    {
        let window = app.window.clone();
        fullscreen.connect_activate(move |_, _| {
            if window.is_fullscreen() {
                window.unfullscreen();
            } else {
                window.fullscreen();
            }
        });
    }
    application.add_action(&fullscreen);

    let statistics = gtk::gio::SimpleAction::new("statistics", None);
    {
        let slot = Rc::clone(&app.slot);
        statistics.connect_activate(move |_, _| {
            with_app(&slot, |app| self::statistics::open(&app.window, app))
        });
    }
    application.add_action(&statistics);

    let preferences = gtk::gio::SimpleAction::new("preferences", None);
    {
        let slot = Rc::clone(&app.slot);
        preferences.connect_activate(move |_, _| {
            with_app(&slot, |app| preferences_dialog::open(&app.window, app))
        });
    }
    application.add_action(&preferences);

    let shortcuts = gtk::gio::SimpleAction::new("shortcuts", None);
    {
        let window = app.window.clone();
        shortcuts.connect_activate(move |_, _| self::shortcuts::open(&window));
    }
    application.add_action(&shortcuts);

    let copy_scramble = gtk::gio::SimpleAction::new("copy-scramble", None);
    {
        let slot = Rc::clone(&app.slot);
        copy_scramble.connect_activate(move |_, _| with_app(&slot, |app| app.copy_scramble()));
    }
    application.add_action(&copy_scramble);

    for (name, penalty) in [
        ("solve-ok", None),
        ("solve-plus2", Some(crate::core::time::Penalty::Plus2)),
        ("solve-dnf", Some(crate::core::time::Penalty::Dnf)),
    ] {
        let action = gtk::gio::SimpleAction::new(name, None);
        let slot = Rc::clone(&app.slot);
        action
            .connect_activate(move |_, _| with_app(&slot, |app| app.set_selected_penalty(penalty)));
        application.add_action(&action);
    }

    let solve_edit = gtk::gio::SimpleAction::new("solve-edit", None);
    {
        let slot = Rc::clone(&app.slot);
        solve_edit.connect_activate(move |_, _| with_app(&slot, |app| app.edit_selected()));
    }
    application.add_action(&solve_edit);

    let solve_delete = gtk::gio::SimpleAction::new("solve-delete", None);
    {
        let slot = Rc::clone(&app.slot);
        solve_delete.connect_activate(move |_, _| with_app(&slot, |app| app.delete_selected()));
    }
    application.add_action(&solve_delete);

    let session_menu = gtk::gio::SimpleAction::new("session-menu", None);
    {
        let slot = Rc::clone(&app.slot);
        session_menu.connect_activate(move |_, _| with_app(&slot, |app| app.show_session_menu()));
    }
    application.add_action(&session_menu);

    let session_manager = gtk::gio::SimpleAction::new("session-manager", None);
    {
        let slot = Rc::clone(&app.slot);
        session_manager.connect_activate(move |_, _| with_app(&slot, |app| app.manage_sessions()));
    }
    application.add_action(&session_manager);

    let import_data = gtk::gio::SimpleAction::new("import-data", None);
    {
        let slot = Rc::clone(&app.slot);
        import_data.connect_activate(move |_, _| with_app(&slot, |app| app.import_data()));
    }
    application.add_action(&import_data);

    let export_data = gtk::gio::SimpleAction::new("export-data", None);
    {
        let slot = Rc::clone(&app.slot);
        export_data.connect_activate(move |_, _| with_app(&slot, |app| app.export_data()));
    }
    application.add_action(&export_data);

    let about = gtk::gio::SimpleAction::new("about", None);
    {
        let slot = Rc::clone(&app.slot);
        about.connect_activate(move |_, _| with_app(&slot, |app| app.about()));
    }
    application.add_action(&about);

    let quit = gtk::gio::SimpleAction::new("quit", None);
    {
        let state = Rc::clone(&app.state);
        let application = application.clone();
        quit.connect_activate(move |_, _| {
            state.flush();
            application.quit();
        });
    }
    application.add_action(&quit);

    application.set_accels_for_action("app.fullscreen", &["F11"]);
    application.set_accels_for_action("app.sidebar", &["<Control>b"]);
    application.set_accels_for_action("app.quit", &["<Control>q"]);
    application.set_accels_for_action("app.copy-scramble", &["<Control>c"]);
    application.set_accels_for_action("app.statistics", &["<Control>t"]);
    application.set_accels_for_action("app.import-data", &["<Control>o"]);
    application.set_accels_for_action("app.export-data", &["<Control><Shift>s"]);
    application.set_accels_for_action("app.preferences", &["<Control>comma"]);
    application.set_accels_for_action("app.shortcuts", &["<Control>question"]);
    application.set_accels_for_action("app.solve-ok", &["<Control>1"]);
    application.set_accels_for_action("app.solve-plus2", &["<Control>2"]);
    application.set_accels_for_action("app.solve-dnf", &["<Control>3"]);
    application.set_accels_for_action("app.solve-edit", &["<Control>e"]);
    application.set_accels_for_action("app.solve-delete", &["Delete"]);
    application.set_accels_for_action("app.session-new", &["<Control>n"]);
    application.set_accels_for_action("app.session-rename", &["F2"]);
    application.set_accels_for_action("app.session-manager", &["<Control>m"]);
    application.set_accels_for_action("app.session-menu", &["<Control>s"]);
    application.set_accels_for_action("app.session-delete", &["<Control>Delete"]);
}
