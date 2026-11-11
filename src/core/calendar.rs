//! Local calendar-day arithmetic.
//!
//! The v0.3.0 app got its civil-time rules from JavaScript's `Date`, i.e. from
//! the C library's local-time conversion. This module keeps that algorithm —
//! `localtime_r`/`mktime` through the `libc` crate — instead of parsing a
//! time-zone database in Rust, so day boundaries, DST and `Date`'s field
//! normalisation behave exactly as they did. It opens no files of its own and
//! touches no GTK or JSC.
//!
//! Everything is epoch milliseconds; `0` is the import's "unknown date" and is
//! the caller's business, not this module's.

use libc::{c_int, time_t, tm};

/// Local civil time at an instant: the fields a date formatter needs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CivilTime {
    pub year: i32,
    /// 1-based.
    pub month: u32,
    pub day: u32,
    pub hour: u32,
    pub minute: u32,
    pub second: u32,
    /// 0 = Sunday, like JavaScript's `Date#getDay`.
    pub weekday: u32,
}

/// The local civil time at `epoch_ms`.
pub fn civil_time(epoch_ms: f64) -> CivilTime {
    // Seconds since the epoch, rounded down: a timestamp at 23:59:59.999 is
    // still that day.
    let seconds = (epoch_ms / 1000.0).floor() as time_t;
    let mut local: tm = unsafe { std::mem::zeroed() };
    let result = unsafe { libc::localtime_r(&seconds, &mut local) };
    if result.is_null() {
        // Local time is unavailable for this instant (no TZ database); fall
        // back to UTC-like fields rather than panicking inside a timer.
        return CivilTime {
            year: 1970,
            month: 1,
            day: 1,
            hour: 0,
            minute: 0,
            second: 0,
            weekday: 4,
        };
    }
    CivilTime {
        year: local.tm_year + 1900,
        month: (local.tm_mon + 1) as u32,
        day: local.tm_mday as u32,
        hour: local.tm_hour as u32,
        minute: local.tm_min as u32,
        second: local.tm_sec as u32,
        weekday: local.tm_wday as u32,
    }
}

/// Local midnight of the day `epoch_ms` falls in.
fn midnight(year: i32, month: u32, day: i32) -> f64 {
    let mut local: tm = unsafe { std::mem::zeroed() };
    local.tm_year = year - 1900;
    local.tm_mon = month as c_int - 1;
    local.tm_mday = day;
    local.tm_hour = 0;
    local.tm_min = 0;
    local.tm_sec = 0;
    local.tm_isdst = -1;
    // `mktime` normalises out-of-range fields (day 32 → next month) and picks
    // the offset in force at that local midnight, exactly like `new Date(y,m,d)`.
    let seconds = unsafe { libc::mktime(&mut local) };
    seconds as f64 * 1000.0
}

/// Local midnight of the day `epoch_ms` falls in, in epoch milliseconds.
pub fn day_start(epoch_ms: f64) -> f64 {
    let civil = civil_time(epoch_ms);
    midnight(civil.year, civil.month, civil.day as i32)
}

/// `YYYY-MM-DD` for the local day of `epoch_ms`; also the sort key.
pub fn day_key(epoch_ms: f64) -> String {
    let civil = civil_time(epoch_ms);
    format!("{:04}-{:02}-{:02}", civil.year, civil.month, civil.day)
}

/// Local midnight `delta` days from `start_ms`, DST-safe: the calendar day is
/// stepped, never a constant 24 hours.
pub fn shift_days(start_ms: f64, delta: i32) -> f64 {
    let civil = civil_time(start_ms);
    midnight(civil.year, civil.month, civil.day as i32 + delta)
}

/// Weekday of the local day, 0 = Sunday (JavaScript's `Date#getDay`).
pub fn weekday(epoch_ms: f64) -> u32 {
    civil_time(epoch_ms).weekday
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOUR: f64 = 3_600_000.0;

    /// Local wall-clock time, built the same way the app reads it.
    fn local(year: i32, month: u32, day: i32, hour: i32) -> f64 {
        midnight(year, month, day) + hour as f64 * HOUR
    }

    #[test]
    fn snaps_to_local_midnight_and_keys_the_date() {
        let late = local(2026, 11, 8, 23);
        assert_eq!(day_start(late), local(2026, 11, 8, 0));
        assert_eq!(day_key(late), "2026-11-08");
    }

    #[test]
    fn steps_calendar_days_across_month_boundaries() {
        assert_eq!(shift_days(local(2026, 11, 8, 0), 1), local(2026, 11, 9, 0));
        assert_eq!(
            shift_days(local(2026, 11, 8, 0), -8),
            local(2026, 10, 31, 0)
        );
    }

    #[test]
    fn reports_sunday_as_zero() {
        // 8 November 2026 is a Sunday.
        assert_eq!(weekday(local(2026, 11, 8, 12)), 0);
        assert_eq!(weekday(local(2026, 11, 9, 12)), 1);
    }
}
