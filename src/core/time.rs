//! Time formatting and penalty maths.
//!
//! This module is pure: no GTK, no IO. It mirrors `src/core/time.ts` from the
//! v0.3.0 app, including its truncation rules — a timer must never display a
//! time faster than the one measured, and WCA results are scored to
//! centiseconds.

/// WCA +2 penalty, in milliseconds.
pub const PLUS2_MS: f64 = 2000.0;

/// A WCA penalty on a solve. `None` means the solve is OK.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Penalty {
    Plus2,
    Dnf,
}

/// The time a solve is *scored* at, in milliseconds.
///
/// DNF is `f64::INFINITY`, which sorts last and poisons an average only when
/// it survives trimming — the same trick the TypeScript version uses.
pub fn effective_ms(time_ms: f64, penalty: Option<Penalty>) -> f64 {
    match penalty {
        Some(Penalty::Dnf) => f64::INFINITY,
        Some(Penalty::Plus2) => ((time_ms + PLUS2_MS) / 10.0).floor() * 10.0,
        None => (time_ms / 10.0).floor() * 10.0,
    }
}

/// One solve as written in the list, the footer or the timer result.
pub fn format_solve(time_ms: f64, penalty: Option<Penalty>) -> String {
    if penalty == Some(Penalty::Dnf) {
        return "DNF".into();
    }
    let scored = format_time(effective_ms(time_ms, penalty), false);
    if penalty == Some(Penalty::Plus2) {
        format!("{scored}+")
    } else {
        scored
    }
}

/// An average or mean: rounded to the nearest hundredth, because an average
/// does not always land on a whole centisecond.
pub fn format_average(ms: f64) -> String {
    if ms.is_nan() {
        return "DNF".into();
    }
    if !ms.is_finite() {
        return if ms > 0.0 {
            "DNF".into()
        } else {
            "0.00".into()
        };
    }
    format_time((ms / 10.0).round() * 10.0, false)
}

/// The timer display: truncated, never rounded up.
pub fn format_time(ms: f64, use_ms: bool) -> String {
    let ms = if !ms.is_finite() || ms < 0.0 { 0.0 } else { ms };

    let units_per_second = if use_ms { 1000 } else { 100 };
    let ms_per_unit = 1000.0 / units_per_second as f64;

    let total_units = (ms / ms_per_unit).floor() as u64;
    let fraction = total_units % units_per_second;
    let total_seconds = total_units / units_per_second;
    let seconds = total_seconds % 60;
    let minutes = total_seconds / 60;

    let fraction_str = format!("{fraction:0width$}", width = if use_ms { 3 } else { 2 });
    let seconds_str = format!("{seconds:02}");

    if minutes > 0 {
        format!("{minutes}:{seconds_str}.{fraction_str}")
    } else {
        format!("{seconds}.{fraction_str}")
    }
}

/// WCA inspection readout: 15…1 seconds left, then `+2`, then `DNF`.
pub fn format_inspection(elapsed_ms: f64) -> String {
    if elapsed_ms >= 17_000.0 {
        return "DNF".into();
    }
    if elapsed_ms >= 15_000.0 {
        return "+2".into();
    }
    let remaining = ((15_000.0 - elapsed_ms.max(0.0)) / 1000.0).ceil();
    let remaining = if remaining.is_nan() { 15.0 } else { remaining };
    format!("{:.0}", remaining.min(15.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effective_time_truncates_and_applies_penalties() {
        assert_eq!(effective_ms(12_345.0, None), 12_340.0);
        assert_eq!(effective_ms(12_345.0, Some(Penalty::Plus2)), 14_340.0);
        assert!(effective_ms(12_345.0, Some(Penalty::Dnf)).is_infinite());
    }

    #[test]
    fn solves_show_the_scored_time() {
        assert_eq!(format_solve(12_345.0, None), "12.34");
        assert_eq!(format_solve(12_345.0, Some(Penalty::Plus2)), "14.34+");
        assert_eq!(format_solve(12_345.0, Some(Penalty::Dnf)), "DNF");
    }

    #[test]
    fn averages_round_to_centiseconds() {
        assert_eq!(format_average(10_866.0), "10.87");
        assert_eq!(format_average(10_833.0), "10.83");
        assert_eq!(format_average(f64::INFINITY), "DNF");
        assert_eq!(format_average(f64::NAN), "DNF");
    }

    #[test]
    fn times_truncate_never_round_up() {
        assert_eq!(format_time(0.0, false), "0.00");
        assert_eq!(format_time(999.9, false), "0.99");
        assert_eq!(format_time(12_345.0, false), "12.34");
        assert_eq!(format_time(62_345.0, false), "1:02.34");
        assert_eq!(format_time(62_345.0, true), "1:02.345");
        assert_eq!(format_time(-10.0, false), "0.00");
    }

    #[test]
    fn inspection_counts_down_then_grades() {
        assert_eq!(format_inspection(0.0), "15");
        assert_eq!(format_inspection(14_001.0), "1");
        assert_eq!(format_inspection(15_000.0), "+2");
        assert_eq!(format_inspection(17_000.0), "DNF");
    }
}
