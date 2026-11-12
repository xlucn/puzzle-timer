//! The preferences dialog.
//!
//! Every row writes the changed field straight back through `AppState`, which
//! validates and persists it, and then applies what the running window can
//! apply. A language change cannot reach widgets that were built with `t()`,
//! so it is saved and announced as taking effect on the next start.

use std::rc::Rc;

use gtk4 as gtk;
use gtk4::prelude::*;
use libadwaita as adw;
use libadwaita::prelude::*;

use crate::core::i18n::{LANGUAGES, Language, MessageKey, t0};
use crate::core::preferences::{
    ColorScheme, HOLD_THRESHOLD_STEP_MS, MAX_HOLD_THRESHOLD_MS, MAX_SIZE_SCALE, MIN_DIAGRAM_SCALE,
    MIN_HOLD_THRESHOLD_MS, MIN_SIZE_SCALE, SIZE_SCALE_STEP,
};

use super::App;

fn page(title: MessageKey, icon: &str) -> adw::PreferencesPage {
    adw::PreferencesPage::builder()
        .title(t0(title))
        .icon_name(icon)
        .build()
}

fn spin(
    title: MessageKey,
    subtitle: Option<MessageKey>,
    lower: f64,
    upper: f64,
    step: f64,
    digits: u32,
    value: f64,
) -> adw::SpinRow {
    let adjustment = gtk::Adjustment::new(value, lower, upper, step, step * 10.0, 0.0);
    let row = adw::SpinRow::new(Some(&adjustment), step, digits);
    row.set_title(&t0(title));
    if let Some(subtitle) = subtitle {
        row.set_subtitle(&t0(subtitle));
    }
    row
}

fn scheme_index(scheme: ColorScheme) -> u32 {
    match scheme {
        ColorScheme::System => 0,
        ColorScheme::Light => 1,
        ColorScheme::Dark => 2,
    }
}

fn scheme_from_index(index: u32) -> ColorScheme {
    match index {
        1 => ColorScheme::Light,
        2 => ColorScheme::Dark,
        _ => ColorScheme::System,
    }
}

fn language_index(language: Language) -> u32 {
    LANGUAGES
        .iter()
        .position(|each| *each == language)
        .unwrap_or(0) as u32
}

pub fn open(parent: &impl IsA<gtk::Widget>, app: &App) {
    let prefs = app.preferences.borrow().clone();
    let dialog = adw::PreferencesDialog::builder()
        .title(t0(MessageKey::PrefsTitle))
        .build();

    // ---- timer -------------------------------------------------------------
    let timer_page = page(
        MessageKey::PrefsTimerTitle,
        "preferences-system-time-symbolic",
    );
    let timer_group = adw::PreferencesGroup::builder()
        .title(t0(MessageKey::PrefsTimerGroup))
        .build();

    let inspection = adw::SwitchRow::builder()
        .title(t0(MessageKey::PrefsInspection))
        .subtitle(t0(MessageKey::PrefsInspectionSubtitle))
        .active(prefs.inspection)
        .build();
    {
        let app = app.slot.clone();
        inspection.connect_active_notify(move |row| {
            if let Some(app) = app.borrow().clone() {
                {
                    let mut prefs = app.preferences.borrow_mut();
                    prefs.inspection = row.is_active();
                }
                let prefs = app.preferences.borrow().clone();
                app.state.set_preferences(prefs.clone());
                app.timer
                    .borrow_mut()
                    .set_inspection(prefs.inspection, super::now_ms());
            }
        });
    }

    let cues = adw::SwitchRow::builder()
        .title(t0(MessageKey::PrefsCues))
        .subtitle(t0(MessageKey::PrefsCuesSubtitle))
        .active(prefs.inspection_sound)
        .build();
    {
        let app = app.slot.clone();
        cues.connect_active_notify(move |row| {
            if let Some(app) = app.borrow().clone() {
                {
                    let mut prefs = app.preferences.borrow_mut();
                    prefs.inspection_sound = row.is_active();
                }
                let prefs = app.preferences.borrow().clone();
                app.state.set_preferences(prefs);
            }
        });
    }

    let hold = spin(
        MessageKey::PrefsHold,
        Some(MessageKey::PrefsHoldSubtitle),
        MIN_HOLD_THRESHOLD_MS,
        MAX_HOLD_THRESHOLD_MS,
        HOLD_THRESHOLD_STEP_MS,
        0,
        prefs.hold_threshold_ms,
    );
    {
        let app = app.slot.clone();
        hold.connect_value_notify(move |row| {
            if let Some(app) = app.borrow().clone() {
                {
                    let mut prefs = app.preferences.borrow_mut();
                    prefs.hold_threshold_ms = row.value().round();
                }
                let prefs = app.preferences.borrow().clone();
                app.state.set_preferences(prefs.clone());
                app.timer
                    .borrow_mut()
                    .set_hold_threshold(prefs.hold_threshold_ms);
            }
        });
    }

    let mouse = adw::SwitchRow::builder()
        .title(t0(MessageKey::PrefsMouse))
        .subtitle(t0(MessageKey::PrefsMouseSubtitle))
        .active(prefs.mouse_start)
        .build();
    {
        let app = app.slot.clone();
        mouse.connect_active_notify(move |row| {
            if let Some(app) = app.borrow().clone() {
                {
                    let mut prefs = app.preferences.borrow_mut();
                    prefs.mouse_start = row.is_active();
                }
                let prefs = app.preferences.borrow().clone();
                app.state.set_preferences(prefs);
            }
        });
    }

    timer_group.add(&inspection);
    timer_group.add(&cues);
    timer_group.add(&hold);
    timer_group.add(&mouse);
    timer_page.add(&timer_group);
    dialog.add(&timer_page);

    // ---- appearance --------------------------------------------------------
    let appearance_page = page(
        MessageKey::PrefsAppearanceTitle,
        "applications-graphics-symbolic",
    );

    let scheme_group = adw::PreferencesGroup::builder()
        .title(t0(MessageKey::PrefsSchemeGroup))
        .build();
    let scheme = adw::ComboRow::builder()
        .title(t0(MessageKey::PrefsTheme))
        .model(&gtk::StringList::new(&[
            &t0(MessageKey::PrefsThemeSystem),
            &t0(MessageKey::PrefsThemeLight),
            &t0(MessageKey::PrefsThemeDark),
        ]))
        .selected(scheme_index(prefs.color_scheme))
        .build();
    {
        let app = app.slot.clone();
        scheme.connect_selected_notify(move |row| {
            if let Some(app) = app.borrow().clone() {
                {
                    let mut prefs = app.preferences.borrow_mut();
                    prefs.color_scheme = scheme_from_index(row.selected());
                }
                let prefs = app.preferences.borrow().clone();
                app.state.set_preferences(prefs.clone());
                super::apply_color_scheme(prefs.color_scheme);
            }
        });
    }
    scheme_group.add(&scheme);
    appearance_page.add(&scheme_group);

    let sizes_group = adw::PreferencesGroup::builder()
        .title(t0(MessageKey::PrefsSizesGroup))
        .description(t0(MessageKey::PrefsSizesDescription))
        .build();
    let timer_scale = spin(
        MessageKey::PrefsSizeTimer,
        Some(MessageKey::PrefsSizeTimerSubtitle),
        MIN_SIZE_SCALE,
        MAX_SIZE_SCALE,
        SIZE_SCALE_STEP,
        2,
        prefs.timer_scale,
    );
    let scramble_scale = spin(
        MessageKey::PrefsSizeScramble,
        Some(MessageKey::PrefsSizeScrambleSubtitle),
        MIN_SIZE_SCALE,
        MAX_SIZE_SCALE,
        SIZE_SCALE_STEP,
        2,
        prefs.scramble_scale,
    );
    let diagram_scale = spin(
        MessageKey::PrefsSizeDiagram,
        Some(MessageKey::PrefsSizeDiagramSubtitle),
        MIN_DIAGRAM_SCALE,
        MAX_SIZE_SCALE,
        SIZE_SCALE_STEP,
        2,
        prefs.diagram_scale,
    );
    for (row, field) in [
        (&timer_scale, 0u8),
        (&scramble_scale, 1),
        (&diagram_scale, 2),
    ] {
        let app = app.slot.clone();
        row.connect_value_notify(move |row| {
            if let Some(app) = app.borrow().clone() {
                {
                    let mut prefs = app.preferences.borrow_mut();
                    let value = row.value();
                    match field {
                        0 => prefs.timer_scale = value,
                        1 => prefs.scramble_scale = value,
                        _ => prefs.diagram_scale = value,
                    }
                }
                let prefs = app.preferences.borrow().clone();
                app.state.set_preferences(prefs);
                app.layout_now();
            }
        });
    }
    sizes_group.add(&timer_scale);
    sizes_group.add(&scramble_scale);
    sizes_group.add(&diagram_scale);
    appearance_page.add(&sizes_group);
    dialog.add(&appearance_page);

    // ---- scramble ----------------------------------------------------------
    let scramble_page = page(MessageKey::PrefsPageScramble, "image-x-generic-symbolic");
    let pre_scramble_group = adw::PreferencesGroup::builder()
        .title(t0(MessageKey::PrefsPreScrambleGroup))
        .description(t0(MessageKey::PrefsPreScrambleDescription))
        .build();
    let pre_scramble = adw::EntryRow::builder()
        .title(t0(MessageKey::PrefsPreScrambleRow))
        .text(prefs.pre_scramble.clone())
        .show_apply_button(true)
        .build();
    // Committed on Enter, on the apply button (the touch path) or when the
    // dialog closes — not per keystroke, which would regenerate the scramble
    // for every letter typed.
    let commit_pre_scramble: Rc<dyn Fn()> = {
        let slot = app.slot.clone();
        let pre_scramble = pre_scramble.clone();
        Rc::new(move || {
            let Some(app) = slot.borrow().clone() else {
                return;
            };
            let text = pre_scramble.text().trim().to_string();
            if app.preferences.borrow().pre_scramble == text {
                return;
            }
            app.preferences.borrow_mut().pre_scramble = text;
            let prefs = app.preferences.borrow().clone();
            app.state.set_preferences(prefs);
            app.refresh_scramble();
        })
    };
    {
        let commit = Rc::clone(&commit_pre_scramble);
        pre_scramble.connect_apply(move |_| commit());
    }
    {
        let commit = Rc::clone(&commit_pre_scramble);
        pre_scramble.connect_entry_activated(move |_| commit());
    }
    {
        let commit = Rc::clone(&commit_pre_scramble);
        dialog.connect_closed(move |_| commit());
    }
    pre_scramble_group.add(&pre_scramble);

    let image_group = adw::PreferencesGroup::builder()
        .title(t0(MessageKey::PrefsImageGroup))
        .description(t0(MessageKey::PrefsImageDescription))
        .build();
    let image = adw::SwitchRow::builder()
        .title(t0(MessageKey::PrefsImageRow))
        .active(prefs.scramble_image)
        .build();
    {
        let app = app.slot.clone();
        image.connect_active_notify(move |row| {
            if let Some(app) = app.borrow().clone() {
                if app.preferences.borrow().scramble_image != row.is_active() {
                    app.set_scramble_image(row.is_active());
                }
            }
        });
    }
    image_group.add(&image);
    scramble_page.add(&pre_scramble_group);
    scramble_page.add(&image_group);
    dialog.add(&scramble_page);

    // ---- language: on the appearance page, as in the original ------------
    let language_group = adw::PreferencesGroup::builder()
        .title(t0(MessageKey::PrefsLanguageGroup))
        .build();
    let language = adw::ComboRow::builder()
        .title(t0(MessageKey::PrefsLanguageRow))
        .model(&gtk::StringList::new(&[
            &t0(MessageKey::PrefsLanguageSystem),
            &t0(MessageKey::PrefsLanguageEnglish),
            &t0(MessageKey::PrefsLanguageChinese),
        ]))
        .selected(language_index(prefs.language))
        .build();
    {
        let app = app.slot.clone();
        language.connect_selected_notify(move |row| {
            if let Some(app) = app.borrow().clone() {
                let language = LANGUAGES
                    .get(row.selected() as usize)
                    .copied()
                    .unwrap_or(Language::System);
                {
                    let mut prefs = app.preferences.borrow_mut();
                    prefs.language = language;
                }
                let prefs = app.preferences.borrow().clone();
                app.state.set_preferences(prefs);
                app.toast_overlay
                    .add_toast(adw::Toast::new(&t0(MessageKey::PrefsLanguageRestart)));
            }
        });
    }
    language_group.add(&language);
    appearance_page.add(&language_group);

    dialog.present(Some(parent));
}
