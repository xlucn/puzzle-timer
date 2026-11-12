//! A font size the user can change, expressed in GTK4 CSS.
//!
//! GTK4 CSS has no custom properties, so a size that comes from a preference
//! cannot be a style class baked into a sheet at import time. The next cheapest
//! thing is one tiny inline sheet per selector that owns a dynamic size,
//! swapped when the number changes: the new sheet is installed before the old
//! one is removed, so no frame is ever painted at a size nobody asked for.

use std::cell::{Cell, RefCell};

use gtk4 as gtk;

pub struct FontSize {
    selector: String,
    provider: RefCell<Option<gtk::CssProvider>>,
    /// Current size in hundredths of a px, so the comparison is integral.
    current: Cell<i64>,
}

impl FontSize {
    pub fn new(selector: &str) -> Self {
        Self {
            selector: selector.to_string(),
            provider: RefCell::new(None),
            current: Cell::new(-1),
        }
    }

    /// Set `selector`'s font size in px. The same size is a no-op, so it is
    /// safe to call from every layout pass.
    pub fn set(&self, px: f64) {
        if !px.is_finite() || px <= 0.0 {
            return;
        }
        let hundredths = (px * 100.0).round() as i64;
        if hundredths == self.current.get() {
            return;
        }
        self.current.set(hundredths);

        let Some(display) = gtk::gdk::Display::default() else {
            return;
        };
        let provider = gtk::CssProvider::new();
        provider.load_from_string(&format!(
            "{} {{ font-size: {:.2}px; }}",
            self.selector,
            hundredths as f64 / 100.0
        ));
        gtk::style_context_add_provider_for_display(
            &display,
            &provider,
            gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
        );

        // Install first, then drop the previous sheet: never a blank frame.
        let previous = self.provider.replace(Some(provider));
        if let Some(previous) = previous {
            gtk::style_context_remove_provider_for_display(&display, &previous);
        }
    }
}
