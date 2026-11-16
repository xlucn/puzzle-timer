//! Building the window and installing the controllers.

use super::*;

/// Build the window and run the app.
pub fn build_window(application: &adw::Application) {
    let state = AppState::load();
    let preferences = state.preferences();
    crate::platform::i18n::init(preferences.language);
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
    let lower_area = gtk::Grid::builder().hexpand(true).vexpand(true).build();
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
        layout_band: Cell::new((0.0, f64::MAX)),
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

    // The header's Cancel is the same tap as Escape: one cancellation route
    // for the keyboard and for a touch screen. Both halves of the key are fed
    // so the timer's held-key set is left the way a real release leaves it.
    {
        let slot = Rc::clone(&slot);
        cancel_inspection.connect_clicked(move |_| {
            with_app(&slot, |app| {
                app.key_down("escape");
                app.key_up("escape");
            });
        });
    }

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
            {
                let slot = Rc::clone(&slot);
                surface.connect_layout(move |_, _, _| {
                    with_app(&slot, |app| app.layout_now());
                });
            }

            // `layout` arrives before GTK has caught the allocations up, so it
            // can only re-apply the tier already in force. A height-only
            // resize raises no width band, and the Adaptive Preview's
            // emulated-screen switch raises no surface event at all, so the
            // post-allocation pass is where a real size change lands. Every
            // writer is compare-first, so an idle frame costs one measurement.
            if let Some(clock) = window.frame_clock() {
                let slot = Rc::clone(&slot);
                clock.connect_after_paint(move |_| {
                    with_app(&slot, |app| app.layout_now());
                });
            }
        });
    }

    // ---- layout bands ------------------------------------------------------
    // These bands change no property: their job is to make the window's
    // `Adw.BreakpointBin` report a zero minimum, so the Adaptive Preview can
    // ask for a phone-sized rectangle without GTK complaining that the docked
    // sidebar's minimum does not fit. Each band also re-runs the layout when
    // it applies, so a width tier takes effect on the allocation that changed
    // it. `layout_for` still decides every tier; the bands only make sure it
    // runs at the moment the window crosses one.
    let band = |min: Option<f64>, max: Option<f64>| {
        let width =
            |type_, value| adw::BreakpointCondition::new_length(type_, value, adw::LengthUnit::Px);
        match (min, max) {
            (Some(min), Some(max)) => adw::BreakpointCondition::new_and(
                width(adw::BreakpointConditionLengthType::MinWidth, min),
                width(adw::BreakpointConditionLengthType::MaxWidth, max),
            ),
            (Some(min), None) => width(adw::BreakpointConditionLengthType::MinWidth, min),
            (None, Some(max)) => width(adw::BreakpointConditionLengthType::MaxWidth, max),
            (None, None) => unreachable!(),
        }
    };
    for (min, max) in [
        (None, Some(BREAKPOINTS.selector_row_max)),
        (
            Some(BREAKPOINTS.selector_row_max + 1.0),
            Some(BREAKPOINTS.drawer_max),
        ),
        (Some(BREAKPOINTS.drawer_max + 1.0), None),
    ] {
        let breakpoint = adw::Breakpoint::new(band(min, max));
        let applied = Rc::clone(&slot);
        breakpoint.connect_apply(move |_| {
            with_app(&applied, |app| app.layout_in_band(Some((min, max))));
        });
        window.add_breakpoint(breakpoint);
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
        gesture.connect_pressed(move |gesture, _, _, _| {
            let touch = is_touch(gesture);
            with_app(&slot, |app| app.start_press(touch));
        });
    }
    {
        let slot = Rc::clone(&app.slot);
        gesture.connect_released(move |gesture, _, _, _| {
            let touch = is_touch(gesture);
            with_app(&slot, |app| app.end_press(touch));
        });
    }
    start_target.add_controller(gesture);
}

/// A touch screen or a pen always drives the timer; the mouse and a
/// touchpad's buttons follow the `mouseStart` preference.
fn is_touch(gesture: &gtk::GestureClick) -> bool {
    gesture.current_event_device().is_some_and(|device| {
        matches!(
            device.source(),
            gtk::gdk::InputSource::Touchscreen | gtk::gdk::InputSource::Pen
        )
    })
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
