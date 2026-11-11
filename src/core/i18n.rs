//! The runtime catalog lookup.
//!
//! Pure Rust: the locale is module state, not a translator object threaded
//! through every widget factory. UI code calls [`t`] while building a widget, so
//! a locale chosen before the window is assembled reaches every label.
//!
//! [`crate::locales::en`] is the source of truth; [`crate::locales::zh_cn`]
//! matches every key exhaustively, so a missing key is a compile error rather
//! than a raw key on screen. Keys do not exist for the two numeric formats —
//! times stay in `src/core/time.rs`, and the compact list timestamps stay
//! deliberately numeric.
//!
//! Date formatting stays out of this module: GLib's locale-aware formatter is
//! the only implementation that knows the user's month names, and `core` has no
//! GLib. The platform/UI layer formats dates; this module formats counts.

use std::cell::Cell;

use crate::locales::{en, zh_cn};

/// One catalog value: plain text, or plural forms selected by the locale's
/// plural rule. `other` is the required fallback; English adds `one`.
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

/// The preference's value: `system` resolves once, at startup.
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
}

/// A catalog we actually carry.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SupportedLocale {
    En,
    ZhCn,
}

impl SupportedLocale {
    pub fn tag(self) -> &'static str {
        match self {
            SupportedLocale::En => "en",
            SupportedLocale::ZhCn => "zh-CN",
        }
    }

    fn catalog(self, key: MessageKey) -> Message {
        match self {
            SupportedLocale::En => en::message(key),
            SupportedLocale::ZhCn => zh_cn::message(key),
        }
    }

    fn group_names(self) -> &'static [(&'static str, &'static str)] {
        match self {
            SupportedLocale::En => en::GROUP_NAMES,
            SupportedLocale::ZhCn => zh_cn::GROUP_NAMES,
        }
    }

    fn section_names(self) -> &'static [(&'static str, &'static str)] {
        match self {
            SupportedLocale::En => en::SECTION_NAMES,
            SupportedLocale::ZhCn => zh_cn::SECTION_NAMES,
        }
    }
}

thread_local! {
    static LOCALE: Cell<SupportedLocale> = const { Cell::new(SupportedLocale::En) };
}

/// Map an arbitrary BCP 47 tag onto a catalog. Only Chinese is distinguished:
/// `zh`, `zh-CN`, `zh-Hans-CN` and `zh-TW` all read the same (simplified)
/// catalog; everything else falls back to English rather than showing raw keys.
pub fn normalize_locale(tag: &str) -> SupportedLocale {
    if tag.to_lowercase().starts_with("zh") {
        SupportedLocale::ZhCn
    } else {
        SupportedLocale::En
    }
}

/// Pick the catalog for the run. Returns what was selected, for logging.
pub fn set_locale(tag: &str) -> SupportedLocale {
    let locale = normalize_locale(tag);
    LOCALE.with(|current| current.set(locale));
    locale
}

/// The catalog in force.
pub fn get_locale() -> SupportedLocale {
    LOCALE.with(Cell::get)
}

/// Resolve the stored `language` preference. `system` asks the caller for the
/// process locale (`LANG` / the desktop session) — GLib owns that question, so
/// this module never reads the environment.
pub fn resolve_language(language: Language, system_tag: &str) -> SupportedLocale {
    match language {
        Language::System => normalize_locale(system_tag),
        Language::En => SupportedLocale::En,
        Language::ZhCn => SupportedLocale::ZhCn,
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

/// Which plural form a count selects. English has `one` at exactly 1; Chinese
/// has a single form, so every count is `other`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PluralForm {
    One,
    Other,
}

fn plural_form(locale: SupportedLocale, count: f64) -> PluralForm {
    match locale {
        SupportedLocale::En if count == 1.0 => PluralForm::One,
        _ => PluralForm::Other,
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

/// Translate one key. A plural value picks its form from the `count` param; a
/// missing catalog key falls back to English, then to the key itself, so a
/// stale catalog can never blank a control.
pub fn t(key: MessageKey, params: &[(&str, Param<'_>)]) -> String {
    let locale = get_locale();
    let message = locale.catalog(key);
    let count = params.iter().find_map(|(name, param)| match param {
        Param::Number(value) if *name == "count" => Some(*value),
        _ => None,
    });
    let text = match message {
        Message::Text(text) => text,
        Message::Plural { one, other } => match count {
            Some(count) if plural_form(locale, count) == PluralForm::One => one.unwrap_or(other),
            _ => other,
        },
    };
    interpolate(text, params)
}

/// [`t`] without placeholders.
pub fn t0(key: MessageKey) -> String {
    t(key, &[])
}

/// A scramble category by the catalogue's own name. The catalogue keeps its
/// English keys (they are stable identifiers, not display text), and the
/// picker/header show this translated form; an unknown name passes through.
pub fn t_group(name: &str) -> String {
    lookup(get_locale().group_names(), name)
}

/// A picker section title (`WCA`, `Other`, …); unknown names pass through.
pub fn t_section(name: &str) -> String {
    lookup(get_locale().section_names(), name)
}

fn lookup(table: &'static [(&'static str, &'static str)], name: &str) -> String {
    table
        .iter()
        .find(|(key, _)| *key == name)
        .map_or_else(|| name.to_string(), |(_, value)| (*value).to_string())
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;
    use crate::core::scramble_types::{scramble_groups, scramble_sections};

    fn text(key: MessageKey) -> String {
        match get_locale().catalog(key) {
            Message::Text(text) => text.to_string(),
            Message::Plural { other, .. } => other.to_string(),
        }
    }

    #[test]
    fn normalizes_a_tag_to_a_catalog_we_carry() {
        assert_eq!(normalize_locale("en"), SupportedLocale::En);
        assert_eq!(normalize_locale("en-GB"), SupportedLocale::En);
        assert_eq!(normalize_locale("zh"), SupportedLocale::ZhCn);
        assert_eq!(normalize_locale("zh-Hans-CN"), SupportedLocale::ZhCn);
        assert_eq!(normalize_locale("zh-TW"), SupportedLocale::ZhCn);
        assert_eq!(normalize_locale("fr-FR"), SupportedLocale::En);
    }

    #[test]
    fn resolves_the_system_preference_to_a_supported_locale() {
        assert_eq!(resolve_language(Language::En, "fr-FR"), SupportedLocale::En);
        assert_eq!(
            resolve_language(Language::ZhCn, "en-US"),
            SupportedLocale::ZhCn
        );
        assert_eq!(
            resolve_language(Language::System, "zh-TW"),
            SupportedLocale::ZhCn
        );
        assert_eq!(
            resolve_language(Language::System, "en-US"),
            SupportedLocale::En
        );
    }

    #[test]
    fn switches_catalogs_and_falls_back_to_english() {
        set_locale("en");
        assert_eq!(get_locale(), SupportedLocale::En);
        assert_eq!(t0(MessageKey::CommonCancel), "Cancel");

        set_locale("zh-CN");
        assert_eq!(get_locale(), SupportedLocale::ZhCn);
        assert_eq!(t0(MessageKey::CommonCancel), "取消");

        set_locale("en");
    }

    #[test]
    fn interpolates_named_params_and_formats_counts() {
        set_locale("en");
        assert_eq!(
            t(
                MessageKey::SessionDeleteTitle,
                &[("name", Param::Text("Weekly"))]
            ),
            "Delete “Weekly”?"
        );
        assert_eq!(
            t(
                MessageKey::StatsCounted,
                &[("count", Param::Number(4.0)), ("total", Param::Number(7.0))]
            ),
            "4 of 7 counted"
        );
    }

    #[test]
    fn selects_plural_forms_from_the_count() {
        set_locale("en");
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

        set_locale("zh-CN");
        assert_eq!(
            t(
                MessageKey::ToastSolvesDeleted,
                &[("count", Param::Number(1.0))]
            ),
            "已删除 1 条成绩"
        );
        assert_eq!(
            t(
                MessageKey::ToastSolvesDeleted,
                &[("count", Param::Number(3.0))]
            ),
            "已删除 3 条成绩"
        );
        set_locale("en");
    }

    #[test]
    fn translates_catalogue_names_but_passes_unknown_ones_through() {
        set_locale("zh-CN");
        assert_eq!(t_group("Megaminx"), "五魔方");
        assert_eq!(t_group("Not a category"), "Not a category");
        assert_eq!(t_section("Other"), "其他");
        assert_eq!(t_section("Unknown"), "Unknown");
        set_locale("en");
        assert_eq!(t_group("Megaminx"), "Megaminx");
        assert_eq!(t_section("Other"), "Other");
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
    fn covers_every_catalogue_group_and_section_in_both_catalogs() {
        let groups: HashSet<&str> = scramble_groups().iter().map(|group| group.name).collect();
        for catalog in [en::GROUP_NAMES, zh_cn::GROUP_NAMES] {
            let keys: HashSet<&str> = catalog.iter().map(|(key, _)| *key).collect();
            assert_eq!(keys, groups);
        }

        let sections: HashSet<&str> = scramble_sections()
            .iter()
            .map(|section| section.name)
            .collect();
        for catalog in [en::SECTION_NAMES, zh_cn::SECTION_NAMES] {
            let keys: HashSet<&str> = catalog.iter().map(|(key, _)| *key).collect();
            assert_eq!(keys, sections);
        }
    }

    #[test]
    fn every_key_has_a_value_in_both_catalogs() {
        // The exhaustive matches already guarantee this at compile time; this
        // also pins that no catalog value is empty.
        for key in ALL_KEYS {
            set_locale("en");
            assert!(!text(key).trim().is_empty(), "{key:?} en");
            set_locale("zh-CN");
            assert!(!text(key).trim().is_empty(), "{key:?} zh");
        }
        set_locale("en");
    }

    /// Every key, for the sweep above.
    const ALL_KEYS: [MessageKey; 215] = [
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
