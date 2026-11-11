//! Application bootstrap: build the `Adw.Application`, load the stylesheet,
//! and let `ui` own the window. Nothing here builds widgets.

use libadwaita as adw;
use libadwaita::prelude::*;

use puzzle_timer::{platform, ui};

fn main() -> glib::ExitCode {
    let app = adw::Application::builder()
        .application_id(platform::meta::APP_ID)
        .build();

    app.connect_startup(|_| ui::load_css());
    app.connect_activate(ui::build_window);
    app.run()
}
