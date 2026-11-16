//! The GTK/libadwaita layer. This is the only module allowed to import
//! `gtk4` or `libadwaita`.
//!
//! This file assembles the app: the sidebar is the solve list, its header the
//! session switch; the content header keeps the timer's controls (sidebar
//! toggle, type title, refresh, copy, image toggle, the app menu), and the
//! lower area holds the timer and the scramble diagram.
//!
//! `App` is one shared state object and its methods are split by the thing
//! they act on, so a change lands in one file:
//!
//! - `window` — builds the widgets and installs the key, gesture and action
//!   controllers; the only module that knows the whole tree.
//! - `layout` — applies `core::layout`'s answer: where the selectors sit, the
//!   start-area inset, the sidebar while the timer owns the view.
//! - `timer_flow` — the hold/inspection/solve state machine's view half, and
//!   every way the timer is pressed (keys, touch, mouse).
//! - `scramble_flow` — the prefetch loop, the type control and the options.
//! - `session_flow` — switching, creating, renaming, deleting sessions.
//! - `solve_flow` — refreshing the list, penalties, deletion and undo.
//! - `data_flow` — csTimer import and export, and their file dialogs.
//! - `notices` — toasts from the store and the About dialog.

mod charts;
mod data_flow;
mod font_size;
mod layout;
mod notices;
#[path = "preferences.rs"]
mod preferences_dialog;
mod scramble_flow;
mod scramble_options;
mod scramble_panel;
mod scramble_type_picker;
mod session_dialogs;
mod session_flow;
mod session_manager;
mod shortcuts;
mod sidebar;
mod solve_editor;
mod solve_flow;
mod state;
mod statistics;
mod stats_strip;
mod timer_flow;
mod timer_view;
mod times_list;
mod window;

pub use self::window::build_window;

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::{SystemTime, UNIX_EPOCH};

use gtk4 as gtk;
use gtk4::glib::translate::IntoGlib;
use gtk4::prelude::*;
use libadwaita as adw;
use libadwaita::prelude::*;

use crate::core::i18n::{MessageKey, Param, t, t_group, t0};
use crate::core::layout::{
    BREAKPOINTS, ContentSize, DiagramPlacement, START_AREA_INSET_PX, SizeScales, layout_for,
};
use crate::core::preferences::{ColorScheme, Preferences};
use crate::core::scramble_feed::{Request as ScrambleRequest, ScrambleFeed};
use crate::core::scramble_types::{
    SCRAMBLE_DEFAULT_TYPE, is_scramble_type, scramble_length, scramble_type_title,
};
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
    /// The width band the window's breakpoints last entered, as a clamp. The
    /// band is checked against the allocation the bin just received, so it is
    /// fresher than `content()` during a resize or a preview switch; the
    /// clamp keeps a stale, wider allocation from undoing the tier the band
    /// already chose.
    layout_band: Cell<(f64, f64)>,
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

pub fn load_css() {
    let provider = gtk::CssProvider::new();
    provider.load_from_string(include_str!("../../style.css"));

    if let Some(display) = gtk::gdk::Display::default() {
        // In a source checkout the icons are beside `src/`. A release build
        // never reads that path: a packaged binary takes its icons from
        // `/usr/share/icons` like any other app, and keeping the build
        // directory out of the executable is what keeps a package free of it.
        #[cfg(debug_assertions)]
        {
            let dev_icons = concat!(env!("CARGO_MANIFEST_DIR"), "/data/icons");
            if std::path::Path::new(dev_icons).is_dir() {
                gtk::IconTheme::for_display(&display).add_search_path(dev_icons);
            }
        }

        gtk::style_context_add_provider_for_display(
            &display,
            &provider,
            gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
        );
    }
}
