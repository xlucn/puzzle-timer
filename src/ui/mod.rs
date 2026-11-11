//! The GTK/libadwaita layer. This is the only module allowed to import
//! `gtk4` or `libadwaita`.

use gtk4 as gtk;
use gtk4::prelude::*;
use libadwaita as adw;
use libadwaita::prelude::*;

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

/// Build the first window of the Rust port.
///
/// The real shell arrives with the UI port; this proves the crate, the
/// stylesheet, the app id and the icon theme are wired before the widget work
/// starts.
pub fn build_window(app: &adw::Application) {
    let window = adw::ApplicationWindow::builder()
        .application(app)
        .title("Puzzle Timer")
        .default_width(900)
        .default_height(640)
        .build();

    let page = adw::StatusPage::builder()
        .title("Puzzle Timer")
        .icon_name("puzzle-timer-symbolic")
        .build();

    let toolbar = adw::ToolbarView::new();
    toolbar.add_top_bar(&adw::HeaderBar::new());
    toolbar.set_content(Some(&page));

    window.set_content(Some(&toolbar));
    window.present();
}
