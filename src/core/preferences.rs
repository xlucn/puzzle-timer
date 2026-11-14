//! The user's settings.
//!
//! Pure Rust: this module owns the *shape*, the defaults and the validation of
//! what comes off disk; where it is stored is `src/platform/store.rs` and how
//! it is shown is `src/ui/`. Everything that reads a setting reads it from the
//! [`Preferences`] handed back at startup or by the dialog's change callback,
//! so the values can never drift apart between the UI and the timer.
//!
//! The file on disk is hand-editable (like the session index), so every field
//! is validated individually: a bad value falls back to its default rather
//! than taking the whole file down — one wrong number must not cost the user
//! their settings.

use serde::Serialize;
use serde_json::{Map, Value};

use super::i18n::Language;

/// Light/dark theming: `system` follows the desktop (`Adw.ColorScheme`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ColorScheme {
    System,
    Light,
    Dark,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    /// How long the start key must be held before the timer arms — csTimer's
    /// "time of keeping space down", in milliseconds so the timer can use it
    /// directly (the dialog shows seconds).
    #[serde(serialize_with = "crate::core::json_number::serialize")]
    pub hold_threshold_ms: f64,
    /// WCA inspection: the 15 s countdown before the solve starts.
    pub inspection: bool,
    /// The inspection's 8 s / 12 s acoustic cues.
    pub inspection_sound: bool,
    /// Show a picture of the scramble when its type has one.
    pub scramble_image: bool,
    /// csTimer's pre-scramble for the diagram (the module's `preScr` global):
    /// a setup the diagram is drawn from, e.g. `y`. Empty for none.
    pub pre_scramble: String,
    /// Whether a mouse press can start and stop the timer; touch and keys
    /// always can.
    pub mouse_start: bool,
    /// Light/dark theming; `system` follows the desktop.
    pub color_scheme: ColorScheme,
    /// UI language: `system` follows the desktop, anything else is a catalog
    /// tag resolved once at startup.
    pub language: Language,
    /// Multiplier on the timer readout's size (`src/core/layout.rs`).
    #[serde(serialize_with = "crate::core::json_number::serialize")]
    pub timer_scale: f64,
    /// Multiplier on the scramble text: bigger text, fewer characters per line.
    #[serde(serialize_with = "crate::core::json_number::serialize")]
    pub scramble_scale: f64,
    /// Multiplier on the scramble diagram's box.
    #[serde(serialize_with = "crate::core::json_number::serialize")]
    pub diagram_scale: f64,
}

/// Bumped only when the preferences file's shape changes incompatibly.
pub const PREFERENCES_FILE_VERSION: u32 = 1;

/// The range the hold threshold is clamped to, in milliseconds.
pub const MIN_HOLD_THRESHOLD_MS: f64 = 0.0;
pub const MAX_HOLD_THRESHOLD_MS: f64 = 2_000.0;
/// Spin-row step in the dialog, in milliseconds (0.05 s).
pub const HOLD_THRESHOLD_STEP_MS: f64 = 50.0;

/// The range the three size multipliers are clamped to. The lowest value keeps
/// a slider from making anything unreadable; 1 is the layout's own size.
pub const MIN_SIZE_SCALE: f64 = 0.75;
pub const MAX_SIZE_SCALE: f64 = 1.5;
/// The picture may go smaller than the text before it stops being a diagram.
pub const MIN_DIAGRAM_SCALE: f64 = 0.5;
/// Spin-row step for every size multiplier.
pub const SIZE_SCALE_STEP: f64 = 0.05;

impl Default for Preferences {
    fn default() -> Self {
        Self {
            hold_threshold_ms: 300.0,
            inspection: true,
            inspection_sound: false,
            scramble_image: true,
            pre_scramble: String::new(),
            mouse_start: false,
            color_scheme: ColorScheme::System,
            language: Language::System,
            timer_scale: 1.0,
            scramble_scale: 1.0,
            diagram_scale: 1.0,
        }
    }
}

/// A finite number from the file, or `None` when it is missing or unusable.
fn stored_number(raw: &Map<String, Value>, key: &str) -> Option<f64> {
    raw.get(key)
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
}

fn stored_flag(raw: &Map<String, Value>, key: &str, default: bool) -> bool {
    raw.get(key).and_then(Value::as_bool).unwrap_or(default)
}

/// Coerce whatever came off disk (or out of the dialog) into usable
/// preferences. Unknown shapes and individually bad fields fall back to their
/// defaults — the file is hand-editable and losing everything over one bad
/// value would be worse than ignoring it.
pub fn normalize_preferences(value: Option<&Value>) -> Preferences {
    let defaults = Preferences::default();
    let Some(Value::Object(raw)) = value else {
        return defaults;
    };

    let hold_threshold_ms =
        stored_number(raw, "holdThresholdMs").map_or(defaults.hold_threshold_ms, |hold| {
            hold.round()
                .clamp(MIN_HOLD_THRESHOLD_MS, MAX_HOLD_THRESHOLD_MS)
        });

    let color_scheme = match raw.get("colorScheme").and_then(Value::as_str) {
        Some("light") => ColorScheme::Light,
        Some("dark") => ColorScheme::Dark,
        Some("system") => ColorScheme::System,
        _ => defaults.color_scheme,
    };

    let pre_scramble = match raw.get("preScramble").and_then(Value::as_str) {
        Some(text) => text.trim().to_string(),
        None => defaults.pre_scramble.clone(),
    };

    let language = raw
        .get("language")
        .and_then(Value::as_str)
        .and_then(Language::parse)
        .unwrap_or(defaults.language);

    // Non-finite scales fall back to "unchanged"; everything else is clamped,
    // so a zero or negative hand-edit lands on the minimum rather than hiding
    // the thing it sizes.
    let scale = |key: &str, min: f64| {
        stored_number(raw, key).map_or(1.0, |value| value.clamp(min, MAX_SIZE_SCALE))
    };

    Preferences {
        hold_threshold_ms,
        inspection: stored_flag(raw, "inspection", defaults.inspection),
        inspection_sound: stored_flag(raw, "inspectionSound", defaults.inspection_sound),
        scramble_image: stored_flag(raw, "scrambleImage", defaults.scramble_image),
        pre_scramble,
        mouse_start: stored_flag(raw, "mouseStart", defaults.mouse_start),
        color_scheme,
        language,
        timer_scale: scale("timerScale", MIN_SIZE_SCALE),
        scramble_scale: scale("scrambleScale", MIN_SIZE_SCALE),
        diagram_scale: scale("diagramScale", MIN_DIAGRAM_SCALE),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn normalize(value: Value) -> Preferences {
        normalize_preferences(Some(&value))
    }

    #[test]
    fn keeps_mouse_control_off_by_default() {
        assert!(!Preferences::default().mouse_start);
    }

    #[test]
    fn returns_the_defaults_for_a_missing_or_unusable_file() {
        assert_eq!(normalize_preferences(None), Preferences::default());
        assert_eq!(normalize(json!(null)), Preferences::default());
        assert_eq!(normalize(json!("settings")), Preferences::default());
        assert_eq!(normalize(json!(42)), Preferences::default());
    }

    #[test]
    fn keeps_every_good_value_as_it_is() {
        let stored = json!({
            "holdThresholdMs": 550,
            "inspection": false,
            "inspectionSound": false,
            "scrambleImage": false,
            "preScramble": "y",
            "mouseStart": true,
            "colorScheme": "dark",
            "language": "zh-CN",
            "timerScale": 1.25,
            "scrambleScale": 0.9,
            "diagramScale": 0.5,
        });
        assert_eq!(
            normalize(stored),
            Preferences {
                hold_threshold_ms: 550.0,
                inspection: false,
                inspection_sound: false,
                scramble_image: false,
                pre_scramble: "y".into(),
                mouse_start: true,
                color_scheme: ColorScheme::Dark,
                language: Language::ZhCn,
                timer_scale: 1.25,
                scramble_scale: 0.9,
                diagram_scale: 0.5,
            }
        );
    }

    #[test]
    fn clamps_a_hold_threshold_into_the_usable_range() {
        assert_eq!(
            normalize(json!({ "holdThresholdMs": -100 })).hold_threshold_ms,
            MIN_HOLD_THRESHOLD_MS
        );
        assert_eq!(
            normalize(json!({ "holdThresholdMs": 99_999 })).hold_threshold_ms,
            MAX_HOLD_THRESHOLD_MS
        );
        assert_eq!(
            normalize(json!({ "holdThresholdMs": 1234.4 })).hold_threshold_ms,
            1234.0
        );
    }

    #[test]
    fn keeps_the_pre_scramble_and_trims_it() {
        assert_eq!(Preferences::default().pre_scramble, "");
        assert_eq!(
            normalize(json!({ "preScramble": "  z2 " })).pre_scramble,
            "z2"
        );
        // A non-string hand edit falls back instead of taking the file down.
        assert_eq!(normalize(json!({ "preScramble": 42 })).pre_scramble, "");
    }

    #[test]
    fn falls_back_per_field_not_per_file() {
        let prefs = normalize(json!({
            "holdThresholdMs": "soon", // not a number → default
            "inspection": "yes",       // not a boolean → default
            "inspectionSound": false,  // the one good value in the file
            "scrambleImage": 0,        // not a boolean → default
            "mouseStart": "yes",       // not a boolean → default (off)
            "colorScheme": "neon",     // unknown → default
        }));
        assert_eq!(
            prefs,
            Preferences {
                inspection_sound: false,
                ..Preferences::default()
            }
        );
    }

    #[test]
    fn defaults_to_the_system_language_and_rejects_an_unknown_tag() {
        assert_eq!(Preferences::default().language, Language::System);
        assert_eq!(normalize(json!({})).language, Language::System);
        assert_eq!(
            normalize(json!({ "language": "zh-CN" })).language,
            Language::ZhCn
        );
        assert_eq!(
            normalize(json!({ "language": "en" })).language,
            Language::En
        );
        assert_eq!(
            normalize(json!({ "language": "fr" })).language,
            Language::System
        );
        assert_eq!(
            normalize(json!({ "language": 42 })).language,
            Language::System
        );
    }

    #[test]
    fn rejects_an_unknown_colour_scheme_but_keeps_the_rest() {
        let prefs = normalize(json!({ "colorScheme": "sepia", "inspection": false }));
        assert_eq!(prefs.color_scheme, ColorScheme::System);
        assert!(!prefs.inspection);
    }

    #[test]
    fn clamps_each_size_scale_into_its_own_range() {
        assert_eq!(
            normalize(json!({ "timerScale": 9 })).timer_scale,
            MAX_SIZE_SCALE
        );
        assert_eq!(
            normalize(json!({ "timerScale": 0.1 })).timer_scale,
            MIN_SIZE_SCALE
        );
        assert_eq!(
            normalize(json!({ "scrambleScale": 9 })).scramble_scale,
            MAX_SIZE_SCALE
        );
        assert_eq!(
            normalize(json!({ "scrambleScale": 0.1 })).scramble_scale,
            MIN_SIZE_SCALE
        );
        // The diagram may go smaller than the text before it stops reading as one.
        assert_eq!(
            normalize(json!({ "diagramScale": 0.1 })).diagram_scale,
            MIN_DIAGRAM_SCALE
        );
        assert_eq!(
            normalize(json!({ "diagramScale": 9 })).diagram_scale,
            MAX_SIZE_SCALE
        );
    }

    #[test]
    fn leaves_a_size_scale_unchanged_when_the_value_is_not_a_number() {
        for value in [json!("big"), json!(null)] {
            let prefs = normalize(json!({
                "timerScale": value,
                "scrambleScale": value,
                "diagramScale": value,
            }));
            assert_eq!(prefs.timer_scale, 1.0);
            assert_eq!(prefs.scramble_scale, 1.0);
            assert_eq!(prefs.diagram_scale, 1.0);
        }
    }

    #[test]
    fn serializes_a_whole_millisecond_threshold_as_an_integer() {
        let text = serde_json::to_string(&Preferences::default()).expect("JSON");
        assert!(text.contains("\"holdThresholdMs\":300"), "got {text}");
        assert!(text.contains("\"language\":\"system\""));
        assert!(text.contains("\"colorScheme\":\"system\""));

        // The three multipliers are whole at 1, and v0.3.0 wrote them as `1`.
        let value: Value = serde_json::from_str(&text).expect("JSON");
        for key in ["timerScale", "scrambleScale", "diagramScale"] {
            assert_eq!(value[key], json!(1), "{key} in {text}");
        }
    }
}
