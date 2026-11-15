//! The runtime catalog lookup.
//!
//! `core` owns the keys and the English text: [`crate::locales::en`] is the
//! msgid table, and [`t`] looks those msgids up in a gettext catalog. The
//! lookup itself is a pair of functions installed by `platform::i18n`, so this
//! module stays pure Rust — no locale, no files, no libc — and a headless
//! `cargo test` gets English without a `.mo` in sight.
//!
//! Translations are `po/*.po`, compiled to `.mo` at build time. A missing
//! translation falls back to the English msgid, so completeness is a test
//! (`tests/i18n_catalogs.rs`), not a compiler error, and the `.po` header's
//! plural rule — not a hand-written match — decides which form a count takes.
//!
//! Keys do not exist for the two numeric formats — times stay in
//! `src/core/time.rs`, and the compact list timestamps stay deliberately
//! numeric.
//!
//! Date formatting stays out of this module: GLib's locale-aware formatter is
//! the only implementation that knows the user's month names, and `core` has no
//! GLib. The platform/UI layer formats dates; this module formats counts.

use std::sync::OnceLock;

use crate::locales::en;

/// A catalog lookup: the English msgid in, the user's language out.
///
/// The plural half takes the count, because which form a language uses is the
/// catalog's business — `ngettext` reads the rule out of the `.po` header.
pub struct Translator {
    pub text: fn(&str) -> String,
    pub plural: fn(&str, &str, u64) -> String,
}

static TRANSLATOR: OnceLock<Translator> = OnceLock::new();

/// Install the catalog. Called once by `platform::i18n::init`; until then —
/// and in tests — the English msgid is the answer, which is also gettext's own
/// fallback.
pub fn install(translator: Translator) {
    let _ = TRANSLATOR.set(translator);
}

fn translator() -> &'static Translator {
    TRANSLATOR.get_or_init(|| Translator {
        text: |msgid| msgid.to_string(),
        plural: |one, other, count| (if count == 1 { one } else { other }).to_string(),
    })
}

/// One catalog value: plain text, or a plural pair.
///
/// `one` is the English `msgid` for `ngettext` and `other` its `msgid_plural`;
/// a catalog with more than two forms answers both from the same entry.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Message {
    Text(&'static str),
    Plural {
        one: Option<&'static str>,
        other: &'static str,
    },
}

/// Every key the catalogs must provide.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum MessageKey {
    AppName,
    AppAboutComments,
    AppAboutBuiltWith,
    CommonCancel,
    CommonCreate,
    CommonDelete,
    CommonRename,
    CommonSave,
    CommonUndo,
    MenuMain,
    MenuStatistics,
    MenuFullscreen,
    MenuExitFullscreen,
    MenuPreferences,
    MenuShortcuts,
    MenuQuit,
    MenuCancelInspection,
    MenuShowList,
    MenuAbout,
    MenuImportData,
    MenuExportData,
    TimerHintIdle,
    TimerHintHolding,
    TimerHintReady,
    TimerHintInspectionReady,
    TimerHintInspecting,
    TimerHintRunning,
    ScrambleGenerating,
    ScrambleDiagram,
    ScrambleNew,
    ScrambleCopy,
    ScrambleCopied,
    ScrambleImage,
    ScrambleType,
    ScrambleChooseType,
    ScrambleOptions,
    ScrambleCategory,
    ScrambleFast,
    ScrambleMoves,
    ScrambleScrambles,
    ScrambleCubes,
    ScrambleFailed,
    TransferImportTitle,
    TransferImportAccept,
    TransferExportTitle,
    TransferFilter,
    TransferExportAccept,
    TransferImportSessions,
    TransferImportSolves,
    TransferImportDone,
    TransferImportWarnings,
    TransferImportFailed,
    TransferExportDone,
    TransferExportFailed,
    PrefsTitle,
    PrefsTimerTitle,
    PrefsTimerGroup,
    PrefsInspection,
    PrefsInspectionSubtitle,
    PrefsCues,
    PrefsCuesSubtitle,
    PrefsHold,
    PrefsHoldSubtitle,
    PrefsMouse,
    PrefsMouseSubtitle,
    PrefsAppearanceTitle,
    PrefsSchemeGroup,
    PrefsTheme,
    PrefsThemeSystem,
    PrefsThemeLight,
    PrefsThemeDark,
    PrefsSizesGroup,
    PrefsSizesDescription,
    PrefsSizeTimer,
    PrefsSizeTimerSubtitle,
    PrefsSizeScramble,
    PrefsSizeScrambleSubtitle,
    PrefsSizeDiagram,
    PrefsSizeDiagramSubtitle,
    PrefsPageScramble,
    PrefsPreScrambleGroup,
    PrefsPreScrambleDescription,
    PrefsPreScrambleRow,
    PrefsImageGroup,
    PrefsImageDescription,
    PrefsImageRow,
    PrefsLanguageGroup,
    PrefsLanguageRow,
    PrefsLanguageSystem,
    PrefsLanguageEnglish,
    PrefsLanguageChinese,
    PrefsLanguageRestart,
    SessionTooltip,
    SessionNewTooltip,
    SessionNew,
    SessionNewDescription,
    SessionName,
    SessionRename,
    SessionDeleteTitle,
    SessionDeleteEmpty,
    SessionDeleteBody,
    SessionRenameMenu,
    SessionDeleteMenu,
    SessionErrorName,
    SessionErrorLong,
    SessionErrorTaken,
    SessionManagerTitle,
    SessionManagerTooltip,
    SessionManagerCurrent,
    SessionManagerRename,
    SessionManagerDelete,
    SessionManagerReorder,
    ListTime,
    ListScramble,
    ListDate,
    ListEmptyTitle,
    ListEmptyBody,
    ListEditTooltip,
    ListEdit,
    ListDeleteTooltip,
    ListCopyScramble,
    ListCopyDate,
    ListPenalty,
    ListPenaltyOk,
    ListPenaltyPlus2,
    ListPenaltyDnf,
    ListComment,
    ListEditTitle,
    ListSelected,
    StatsTitle,
    StatsSingle,
    StatsMo3,
    StatsAo5,
    StatsAo12,
    StatsAny,
    StatsCurrent,
    StatsBest,
    StatsTarget,
    StatsEmpty,
    StatsMean,
    StatsSolves,
    StatsCounted,
    StatsDnf,
    StatsAo50,
    StatsAo100,
    StatsAo1000,
    StatsSpread,
    StatsWorst,
    StatsRange,
    StatsSigma,
    StatsTotalTime,
    StatsTabSummary,
    StatsTabCharts,
    StatsRecordsGroup,
    StatsRecordsDescription,
    StatsRecordsNone,
    StatsRecordsCurrent,
    StatsRecordsSetDate,
    StatsRecordsSetSolve,
    StatsRecordsHeldDays,
    StatsRecordsHeldSameDay,
    StatsRecordsOlder,
    StatsRecordsHeldSolves,
    StatsActivityTotalSolves,
    StatsActivityToday,
    StatsActivityLast7,
    StatsActivityLast30,
    StatsActivityActiveCount,
    StatsActivityCurrentStreak,
    StatsActivityLongestStreak,
    StatsActivityDays,
    StatsActivityActiveDays,
    StatsActivityPerDay,
    StatsActivityBestDay,
    StatsActivityUndated,
    StatsChartsDistribution,
    StatsChartsTrend,
    StatsActivityOverview,
    StatsActivityRecent,
    StatsActivityLess,
    StatsActivityMore,
    StatsActivityNoSolves,
    ShortcutsTitle,
    ShortcutsGroupTimer,
    ShortcutsGroupScramble,
    ShortcutsGroupList,
    ShortcutsGroupSessions,
    ShortcutsGroupGeneral,
    ShortcutsGroupData,
    ShortcutsStartStop,
    ShortcutsCancelInspection,
    ShortcutsCopyScramble,
    ShortcutsSidebar,
    ShortcutsHideDrawer,
    ShortcutsDeleteSolves,
    ShortcutsClearPenalty,
    ShortcutsPlus2,
    ShortcutsDnf,
    ShortcutsEditSolve,
    ShortcutsSessionMenu,
    ShortcutsSessionManager,
    ShortcutsNewSession,
    ShortcutsRenameSession,
    ShortcutsDeleteSession,
    ShortcutsStatistics,
    ShortcutsKeyboard,
    ShortcutsPreferences,
    ShortcutsFullscreen,
    ShortcutsQuit,
    ShortcutsImportData,
    ShortcutsExportData,
    ToastSolvesDeleted,
    ToastSessionFileUnreadable,
    ToastSessionListUnreadable,
    ToastSettingsUnreadable,
}

impl MessageKey {
    /// Every key, in declaration order: what the template generator and the
    /// catalog tests walk.
    pub const ALL: [MessageKey; 215] = [
        MessageKey::AppName,
        MessageKey::AppAboutComments,
        MessageKey::AppAboutBuiltWith,
        MessageKey::CommonCancel,
        MessageKey::CommonCreate,
        MessageKey::CommonDelete,
        MessageKey::CommonRename,
        MessageKey::CommonSave,
        MessageKey::CommonUndo,
        MessageKey::MenuMain,
        MessageKey::MenuStatistics,
        MessageKey::MenuFullscreen,
        MessageKey::MenuExitFullscreen,
        MessageKey::MenuPreferences,
        MessageKey::MenuShortcuts,
        MessageKey::MenuQuit,
        MessageKey::MenuCancelInspection,
        MessageKey::MenuShowList,
        MessageKey::MenuAbout,
        MessageKey::MenuImportData,
        MessageKey::MenuExportData,
        MessageKey::TimerHintIdle,
        MessageKey::TimerHintHolding,
        MessageKey::TimerHintReady,
        MessageKey::TimerHintInspectionReady,
        MessageKey::TimerHintInspecting,
        MessageKey::TimerHintRunning,
        MessageKey::ScrambleGenerating,
        MessageKey::ScrambleDiagram,
        MessageKey::ScrambleNew,
        MessageKey::ScrambleCopy,
        MessageKey::ScrambleCopied,
        MessageKey::ScrambleImage,
        MessageKey::ScrambleType,
        MessageKey::ScrambleChooseType,
        MessageKey::ScrambleOptions,
        MessageKey::ScrambleCategory,
        MessageKey::ScrambleFast,
        MessageKey::ScrambleMoves,
        MessageKey::ScrambleScrambles,
        MessageKey::ScrambleCubes,
        MessageKey::ScrambleFailed,
        MessageKey::TransferImportTitle,
        MessageKey::TransferImportAccept,
        MessageKey::TransferExportTitle,
        MessageKey::TransferFilter,
        MessageKey::TransferExportAccept,
        MessageKey::TransferImportSessions,
        MessageKey::TransferImportSolves,
        MessageKey::TransferImportDone,
        MessageKey::TransferImportWarnings,
        MessageKey::TransferImportFailed,
        MessageKey::TransferExportDone,
        MessageKey::TransferExportFailed,
        MessageKey::PrefsTitle,
        MessageKey::PrefsTimerTitle,
        MessageKey::PrefsTimerGroup,
        MessageKey::PrefsInspection,
        MessageKey::PrefsInspectionSubtitle,
        MessageKey::PrefsCues,
        MessageKey::PrefsCuesSubtitle,
        MessageKey::PrefsHold,
        MessageKey::PrefsHoldSubtitle,
        MessageKey::PrefsMouse,
        MessageKey::PrefsMouseSubtitle,
        MessageKey::PrefsAppearanceTitle,
        MessageKey::PrefsSchemeGroup,
        MessageKey::PrefsTheme,
        MessageKey::PrefsThemeSystem,
        MessageKey::PrefsThemeLight,
        MessageKey::PrefsThemeDark,
        MessageKey::PrefsSizesGroup,
        MessageKey::PrefsSizesDescription,
        MessageKey::PrefsSizeTimer,
        MessageKey::PrefsSizeTimerSubtitle,
        MessageKey::PrefsSizeScramble,
        MessageKey::PrefsSizeScrambleSubtitle,
        MessageKey::PrefsSizeDiagram,
        MessageKey::PrefsSizeDiagramSubtitle,
        MessageKey::PrefsPageScramble,
        MessageKey::PrefsPreScrambleGroup,
        MessageKey::PrefsPreScrambleDescription,
        MessageKey::PrefsPreScrambleRow,
        MessageKey::PrefsImageGroup,
        MessageKey::PrefsImageDescription,
        MessageKey::PrefsImageRow,
        MessageKey::PrefsLanguageGroup,
        MessageKey::PrefsLanguageRow,
        MessageKey::PrefsLanguageSystem,
        MessageKey::PrefsLanguageEnglish,
        MessageKey::PrefsLanguageChinese,
        MessageKey::PrefsLanguageRestart,
        MessageKey::SessionTooltip,
        MessageKey::SessionNewTooltip,
        MessageKey::SessionNew,
        MessageKey::SessionNewDescription,
        MessageKey::SessionName,
        MessageKey::SessionRename,
        MessageKey::SessionDeleteTitle,
        MessageKey::SessionDeleteEmpty,
        MessageKey::SessionDeleteBody,
        MessageKey::SessionRenameMenu,
        MessageKey::SessionDeleteMenu,
        MessageKey::SessionErrorName,
        MessageKey::SessionErrorLong,
        MessageKey::SessionErrorTaken,
        MessageKey::SessionManagerTitle,
        MessageKey::SessionManagerTooltip,
        MessageKey::SessionManagerCurrent,
        MessageKey::SessionManagerRename,
        MessageKey::SessionManagerDelete,
        MessageKey::SessionManagerReorder,
        MessageKey::ListTime,
        MessageKey::ListScramble,
        MessageKey::ListDate,
        MessageKey::ListEmptyTitle,
        MessageKey::ListEmptyBody,
        MessageKey::ListEditTooltip,
        MessageKey::ListEdit,
        MessageKey::ListDeleteTooltip,
        MessageKey::ListCopyScramble,
        MessageKey::ListCopyDate,
        MessageKey::ListPenalty,
        MessageKey::ListPenaltyOk,
        MessageKey::ListPenaltyPlus2,
        MessageKey::ListPenaltyDnf,
        MessageKey::ListComment,
        MessageKey::ListEditTitle,
        MessageKey::ListSelected,
        MessageKey::StatsTitle,
        MessageKey::StatsSingle,
        MessageKey::StatsMo3,
        MessageKey::StatsAo5,
        MessageKey::StatsAo12,
        MessageKey::StatsAny,
        MessageKey::StatsCurrent,
        MessageKey::StatsBest,
        MessageKey::StatsTarget,
        MessageKey::StatsEmpty,
        MessageKey::StatsMean,
        MessageKey::StatsSolves,
        MessageKey::StatsCounted,
        MessageKey::StatsDnf,
        MessageKey::StatsAo50,
        MessageKey::StatsAo100,
        MessageKey::StatsAo1000,
        MessageKey::StatsSpread,
        MessageKey::StatsWorst,
        MessageKey::StatsRange,
        MessageKey::StatsSigma,
        MessageKey::StatsTotalTime,
        MessageKey::StatsTabSummary,
        MessageKey::StatsTabCharts,
        MessageKey::StatsRecordsGroup,
        MessageKey::StatsRecordsDescription,
        MessageKey::StatsRecordsNone,
        MessageKey::StatsRecordsCurrent,
        MessageKey::StatsRecordsSetDate,
        MessageKey::StatsRecordsSetSolve,
        MessageKey::StatsRecordsHeldDays,
        MessageKey::StatsRecordsHeldSameDay,
        MessageKey::StatsRecordsOlder,
        MessageKey::StatsRecordsHeldSolves,
        MessageKey::StatsActivityTotalSolves,
        MessageKey::StatsActivityToday,
        MessageKey::StatsActivityLast7,
        MessageKey::StatsActivityLast30,
        MessageKey::StatsActivityActiveCount,
        MessageKey::StatsActivityCurrentStreak,
        MessageKey::StatsActivityLongestStreak,
        MessageKey::StatsActivityDays,
        MessageKey::StatsActivityActiveDays,
        MessageKey::StatsActivityPerDay,
        MessageKey::StatsActivityBestDay,
        MessageKey::StatsActivityUndated,
        MessageKey::StatsChartsDistribution,
        MessageKey::StatsChartsTrend,
        MessageKey::StatsActivityOverview,
        MessageKey::StatsActivityRecent,
        MessageKey::StatsActivityLess,
        MessageKey::StatsActivityMore,
        MessageKey::StatsActivityNoSolves,
        MessageKey::ShortcutsTitle,
        MessageKey::ShortcutsGroupTimer,
        MessageKey::ShortcutsGroupScramble,
        MessageKey::ShortcutsGroupList,
        MessageKey::ShortcutsGroupSessions,
        MessageKey::ShortcutsGroupGeneral,
        MessageKey::ShortcutsGroupData,
        MessageKey::ShortcutsStartStop,
        MessageKey::ShortcutsCancelInspection,
        MessageKey::ShortcutsCopyScramble,
        MessageKey::ShortcutsSidebar,
        MessageKey::ShortcutsHideDrawer,
        MessageKey::ShortcutsDeleteSolves,
        MessageKey::ShortcutsClearPenalty,
        MessageKey::ShortcutsPlus2,
        MessageKey::ShortcutsDnf,
        MessageKey::ShortcutsEditSolve,
        MessageKey::ShortcutsSessionMenu,
        MessageKey::ShortcutsSessionManager,
        MessageKey::ShortcutsNewSession,
        MessageKey::ShortcutsRenameSession,
        MessageKey::ShortcutsDeleteSession,
        MessageKey::ShortcutsStatistics,
        MessageKey::ShortcutsKeyboard,
        MessageKey::ShortcutsPreferences,
        MessageKey::ShortcutsFullscreen,
        MessageKey::ShortcutsQuit,
        MessageKey::ShortcutsImportData,
        MessageKey::ShortcutsExportData,
        MessageKey::ToastSolvesDeleted,
        MessageKey::ToastSessionFileUnreadable,
        MessageKey::ToastSessionListUnreadable,
        MessageKey::ToastSettingsUnreadable,
    ];
}

/// The `language` preference: `system` follows the environment, which is also
/// what a fresh install starts on.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Language {
    #[serde(rename = "system")]
    System,
    #[serde(rename = "en")]
    En,
    #[serde(rename = "zh-CN")]
    ZhCn,
}

/// Every value selectable in Preferences / hand-editable in `prefs.json`.
pub const LANGUAGES: [Language; 3] = [Language::System, Language::En, Language::ZhCn];

impl Language {
    pub fn tag(self) -> &'static str {
        match self {
            Language::System => "system",
            Language::En => "en",
            Language::ZhCn => "zh-CN",
        }
    }

    /// The preference value for a tag, or `None` when it is not one we carry.
    pub fn parse(tag: &str) -> Option<Self> {
        LANGUAGES.into_iter().find(|language| language.tag() == tag)
    }

    /// The gettext locale this preference asks for, or `None` for `system`,
    /// which leaves `LANGUAGE` to the session and its desktop settings.
    pub fn gettext_locale(self) -> Option<&'static str> {
        match self {
            Language::System => None,
            Language::En => Some("en"),
            Language::ZhCn => Some("zh_CN"),
        }
    }
}

/// A value substituted into a `{name}` placeholder.
#[derive(Clone, Copy, Debug)]
pub enum Param<'a> {
    Text(&'a str),
    Number(f64),
}

/// Format a count with the catalog's digit grouping.
pub fn format_count(value: f64) -> String {
    let negative = value < 0.0;
    let text = format!("{}", value.abs());
    let (whole, fraction) = match text.split_once('.') {
        Some((whole, fraction)) => (whole, Some(fraction)),
        None => (text.as_str(), None),
    };
    let mut grouped = String::with_capacity(text.len() + text.len() / 3);
    for (index, digit) in whole.chars().enumerate() {
        if index > 0 && (whole.len() - index) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(digit);
    }
    if let Some(fraction) = fraction {
        grouped.push('.');
        grouped.push_str(fraction);
    }
    if negative {
        format!("-{grouped}")
    } else {
        grouped
    }
}

fn interpolate(text: &str, params: &[(&str, Param<'_>)]) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('{') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        let Some(close) = after.find('}') else {
            out.push_str(&rest[open..]);
            return out;
        };
        let name = &after[..close];
        match params.iter().find(|(key, _)| *key == name) {
            Some((_, Param::Text(value))) => out.push_str(value),
            Some((_, Param::Number(value))) => out.push_str(&format_count(*value)),
            None => {
                out.push('{');
                out.push_str(name);
                out.push('}');
            }
        }
        rest = &after[close + 1..];
    }
    out.push_str(rest);
    out
}

/// Translate one key. A plural value asks the catalog which form the `count`
/// param selects; a key the catalog does not carry stays English, so a stale
/// `.po` can never blank a control.
pub fn t(key: MessageKey, params: &[(&str, Param<'_>)]) -> String {
    let message = en::message(key);
    let count = params.iter().find_map(|(name, param)| match param {
        Param::Number(value) if *name == "count" => Some(*value),
        _ => None,
    });
    let catalog = translator();
    let text = match message {
        Message::Text(text) => (catalog.text)(text),
        Message::Plural {
            one: Some(one),
            other,
        } => (catalog.plural)(one, other, count.unwrap_or(0.0) as u64),
        Message::Plural { one: None, other } => (catalog.text)(other),
    };
    interpolate(&text, params)
}

/// [`t`] without placeholders.
pub fn t0(key: MessageKey) -> String {
    t(key, &[])
}

/// A scramble category by the catalogue's own name. The catalogue keeps its
/// English names (they are stable identifiers, not display text); the picker
/// and the header show the translated form, and an unknown name passes
/// through, which is gettext's own answer for a msgid it does not carry.
pub fn t_group(name: &str) -> String {
    (translator().text)(name)
}

/// A picker section title (`WCA`, `Other`, …); unknown names pass through.
pub fn t_section(name: &str) -> String {
    (translator().text)(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn english(key: MessageKey) -> String {
        match en::message(key) {
            Message::Text(text) => text.to_string(),
            Message::Plural { other, .. } => other.to_string(),
        }
    }

    #[test]
    fn english_is_the_default_catalog() {
        assert_eq!(t0(MessageKey::CommonCancel), "Cancel");
        assert_eq!(
            t(
                MessageKey::ListEditTitle,
                &[("number", Param::Number(316.0))]
            ),
            "Edit solve #316"
        );
        assert_eq!(
            t(
                MessageKey::SessionDeleteTitle,
                &[("name", Param::Text("Weekly"))]
            ),
            "Delete “Weekly”?"
        );
    }

    #[test]
    fn interpolates_named_params_and_formats_counts() {
        assert_eq!(
            t(
                MessageKey::StatsCounted,
                &[("count", Param::Number(4.0)), ("total", Param::Number(7.0))]
            ),
            "4 of 7 counted"
        );
        assert_eq!(
            t(MessageKey::ScrambleFailed, &[]),
            "Scramble failed: {reason}"
        );
    }

    #[test]
    fn selects_plural_forms_from_the_count() {
        assert_eq!(
            t(
                MessageKey::ToastSolvesDeleted,
                &[("count", Param::Number(1.0))]
            ),
            "Solve deleted"
        );
        assert_eq!(
            t(
                MessageKey::ToastSolvesDeleted,
                &[("count", Param::Number(3.0))]
            ),
            "3 solves deleted"
        );
        assert_eq!(
            t(MessageKey::StatsSolves, &[("count", Param::Number(1.0))]),
            "1 solve"
        );
        assert_eq!(
            t(MessageKey::StatsSolves, &[("count", Param::Number(3.0))]),
            "3 solves"
        );
        // A plural key without a count is the plural form, and its `{count}`
        // placeholder stays unfilled — the caller always passes one.
        assert_eq!(
            t(MessageKey::StatsDnf, &[]),
            "{count} DNFs",
            "no count still reads as a plural"
        );
    }

    #[test]
    fn catalogue_names_pass_through_untranslated() {
        assert_eq!(t_group("Megaminx"), "Megaminx");
        assert_eq!(t_group("Not a category"), "Not a category");
        assert_eq!(t_section("Other"), "Other");
        assert_eq!(t_section("Unknown"), "Unknown");
    }

    #[test]
    fn formats_counts_with_digit_grouping() {
        assert_eq!(format_count(1234.0), "1,234");
        assert_eq!(format_count(0.0), "0");
        assert_eq!(format_count(1_000_000.0), "1,000,000");
        assert_eq!(format_count(-1234.0), "-1,234");
        assert_eq!(format_count(12.5), "12.5");
    }

    #[test]
    fn every_key_has_english_text() {
        for key in MessageKey::ALL {
            assert!(!english(key).trim().is_empty(), "{key:?}");
        }
    }

    #[test]
    fn preference_tags_round_trip_and_name_a_catalog() {
        for language in LANGUAGES {
            assert_eq!(Language::parse(language.tag()), Some(language));
        }
        assert_eq!(Language::parse("zh-CN"), Some(Language::ZhCn));
        assert_eq!(Language::parse("fr-FR"), None);

        assert_eq!(Language::System.gettext_locale(), None);
        assert_eq!(Language::En.gettext_locale(), Some("en"));
        assert_eq!(Language::ZhCn.gettext_locale(), Some("zh_CN"));
    }
}
