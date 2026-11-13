//! Dates that are not times.
//!
//! `core` formats times and relative stamps; a calendar date belongs to the
//! platform, because only the system's formatter knows the user's month and
//! weekday names. `glib::DateTime` wraps it (`g_date_time_format`), which is
//! what GTK itself uses.
//!
//! This follows the process locale (GTK sets it from the environment), not the
//! app's language preference: a Chinese preference on an English desktop shows
//! English month names.

use glib::DateTime;

/// `12 Nov 2026` — the short month form, for the places with room.
pub fn format_date(epoch_ms: f64) -> String {
    format_with(epoch_ms, "%e %b %Y")
}

/// `Nov` — one month name, for the heat map's column labels.
pub fn format_month(epoch_ms: f64) -> String {
    format_with(epoch_ms, "%b")
}

/// `Mon` — one weekday name, for the heat map's rail.
pub fn format_weekday(epoch_ms: f64) -> String {
    format_with(epoch_ms, "%a")
}

fn format_with(epoch_ms: f64, format: &str) -> String {
    if !epoch_ms.is_finite() {
        return String::new();
    }
    let Ok(stamp) = DateTime::from_unix_local((epoch_ms / 1000.0).floor() as i64) else {
        return String::new();
    };
    // `%e` pads the day with a space; a squeezed repeat closes the double gap
    // without collapsing a deliberate one in the month name.
    stamp
        .format(format)
        .map(|text| text.replace("  ", " ").trim().to_string())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bad_stamp_formats_to_nothing() {
        assert_eq!(format_date(f64::NAN), "");
        assert!(!format_month(0.0).is_empty());
    }

    #[test]
    fn a_date_carries_the_year_and_a_month_name() {
        // 2026-11-12 12:00 UTC — the year is what the assertion can rely on.
        let text = format_date(1_763_000_000_000.0);
        assert!(text.contains("202"), "{text}");
        assert!(!text.contains("  "), "{text}");
    }

    #[test]
    fn short_forms_are_single_words() {
        let month = format_month(1_763_000_000_000.0);
        let weekday = format_weekday(1_763_000_000_000.0);
        assert!(!month.is_empty() && !month.contains(' '), "{month}");
        assert!(!weekday.is_empty(), "{weekday}");
    }
}
