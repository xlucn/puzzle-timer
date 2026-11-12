//! The shared application state behind the widgets.
//!
//! `core` deliberately knows nothing about caching or threads; this module is
//! where the process keeps its one `Store`, its one `SessionLibrary` and the
//! loaded sessions, so every widget reads the same objects. It holds no GTK:
//! the widgets borrow it through `Rc`, which keeps the borrowing rules of a
//! single-threaded UI straightforward.
//!
//! One `Session` per id is cached for the whole run. Caching is not an
//! optimisation: a change to a session that is *not* active still has to reach
//! disk (an undo toast can outlive the switch that followed it), and a switch
//! must not re-read a file whose write is still inside the store's debounce
//! window.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use crate::core::preferences::Preferences;
use crate::core::session::{Session, Solve};
use crate::core::session_library::{SessionEntry, SessionLibrary};
use crate::platform::store::Store;

pub type SharedSession = Rc<RefCell<Session>>;

pub struct AppState {
    /// The store, shared with every session's save listener.
    store: Rc<RefCell<Store>>,
    library: RefCell<SessionLibrary>,
    sessions: RefCell<HashMap<String, SharedSession>>,
    preferences: RefCell<Preferences>,
    /// Notes from the store, drained by the window into toasts/stderr.
    notices: RefCell<Vec<String>>,
}

impl AppState {
    /// Load the index and the preferences; a notice from either is kept for
    /// the window to report once it exists.
    pub fn load() -> Rc<Self> {
        let store = Rc::new(RefCell::new(Store::new()));

        let index = store.borrow().load_index();
        let mut notices = Vec::new();
        if let Some(notice) = index.notice {
            notices.push(notice);
        }
        let library = SessionLibrary::new(index.sessions, index.active_id.as_deref());

        let loaded = store.borrow().load_preferences();
        if let Some(notice) = loaded.notice {
            notices.push(notice);
        }

        Rc::new(Self {
            store,
            library: RefCell::new(library),
            sessions: RefCell::new(HashMap::new()),
            preferences: RefCell::new(loaded.preferences),
            notices: RefCell::new(notices),
        })
    }

    pub fn store(&self) -> Rc<RefCell<Store>> {
        Rc::clone(&self.store)
    }

    pub fn preferences(&self) -> Preferences {
        self.preferences.borrow().clone()
    }

    /// Replace the preferences and write them. Field validation already
    /// happened in the dialog (`normalize_preferences` on load, direct values
    /// from the widgets), so this is the one write path.
    pub fn set_preferences(&self, preferences: Preferences) {
        *self.preferences.borrow_mut() = preferences;
        let snapshot = self.preferences.borrow().clone();
        self.store.borrow().save_preferences(&snapshot);
    }

    /// The active session's id. Read from the library, so it is the same
    /// value every listener just heard.
    pub fn active_id(&self) -> String {
        self.library.borrow().active_id().to_string()
    }

    /// The session behind `id`, loading it on first use and subscribing its
    /// save. The listener writes through the store, which coalesces the
    /// writes and flushes them on close.
    pub fn session(&self, id: &str) -> SharedSession {
        if let Some(session) = self.sessions.borrow().get(id) {
            return Rc::clone(session);
        }

        let loaded = self.store.borrow().load_session(id);
        if let Some(notice) = loaded.notice {
            self.notices.borrow_mut().push(notice);
        }
        let session = Rc::new(RefCell::new(Session::new(loaded.solves)));

        let store = Rc::clone(&self.store);
        let save_id = id.to_string();
        session.borrow_mut().subscribe(move |_change, solves| {
            store.borrow_mut().schedule_save(&save_id, solves);
        });

        self.sessions
            .borrow_mut()
            .insert(id.to_string(), Rc::clone(&session));
        session
    }

    /// Put a freshly imported session into the cache, with the same save
    /// subscription every loaded session has. Called from the importer's
    /// before-announce hook, so the first UI reaction already reads the
    /// imported solves rather than an empty file.
    pub fn seed_session(&self, id: &str, solves: Vec<Solve>) {
        let session = Rc::new(RefCell::new(Session::new(solves)));
        let store = Rc::clone(&self.store);
        let save_id = id.to_string();
        session.borrow_mut().subscribe(move |_change, solves| {
            store.borrow_mut().schedule_save(&save_id, solves);
        });
        self.sessions.borrow_mut().insert(id.to_string(), session);
    }

    pub fn active_session(&self) -> SharedSession {
        let id = self.active_id();
        self.session(&id)
    }

    /// Run `f` with the library. The callback must not touch the library
    /// again — it runs while the library is mutably borrowed.
    pub fn with_library<R>(&self, f: impl FnOnce(&mut SessionLibrary) -> R) -> R {
        f(&mut self.library.borrow_mut())
    }

    /// The entries and the active id, copied out for a menu rebuild.
    pub fn library_snapshot(&self) -> (Vec<SessionEntry>, String) {
        let library = self.library.borrow();
        (library.entries().to_vec(), library.active_id().to_string())
    }

    /// Persist the index. Called from the library listener, which receives the
    /// same entries, so this only has to write.
    pub fn save_index(&self, entries: &[SessionEntry], active_id: &str) {
        self.store.borrow().save_index(entries, Some(active_id));
    }

    /// Copy the library out and write it — the one write path after a
    /// create / rename / delete / switch / reorder / retype.
    pub fn save_library_index(&self) {
        let (entries, active) = self.library_snapshot();
        self.save_index(&entries, &active);
    }

    /// Drop a deleted session from the cache and forget its queued write.
    pub fn forget_session(&self, id: &str) {
        self.sessions.borrow_mut().remove(id);
        self.store.borrow_mut().drop_pending(id);
    }

    /// Write everything that is waiting, e.g. on window close.
    pub fn flush(&self) {
        self.store.borrow_mut().flush();
    }

    /// Take the queued store notices.
    pub fn take_notices(&self) -> Vec<String> {
        std::mem::take(&mut self.notices.borrow_mut())
    }
}
