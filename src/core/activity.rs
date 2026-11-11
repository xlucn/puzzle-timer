//! Solves grouped by local calendar day.
//!
//! Day boundaries come from [`crate::core::calendar`], so a solve at 23:59 and
//! one at 00:01 fall into different days in the user's own time zone — which
//! is what "I practised yesterday" means — without a UTC convention the UI
//! would have to explain.
//!
//! Imported solves can have no date (`created_at_ms` 0); they are counted in
//! `undated` and kept out of the buckets rather than landing on 1 January
//! 1970, which would invent a 56-year streak.
//!
//! A streak is calendar days, not 24-hour spans: DST days are 23 or 25 hours
//! long, so consecutive-day tests step with [`shift_days`], never with a
//! constant.

use std::collections::BTreeMap;

use super::calendar::{day_key, day_start, shift_days, weekday};
use super::session::Solve;

#[derive(Clone, Debug, PartialEq)]
pub struct DayBucket {
    /// `YYYY-MM-DD` in local time; also the sort key.
    pub key: String,
    /// Local midnight of the day, epoch ms.
    pub start_ms: f64,
    pub count: usize,
    /// Sum of the measured times, DNF solves included.
    pub total_ms: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Rolling {
    pub solves: usize,
    pub active_days: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Activity {
    /// Every day with at least one dated solve, oldest first.
    pub days: Vec<DayBucket>,
    /// Today's bucket, zero-filled when nothing was recorded today.
    pub today: DayBucket,
    pub last7: Rolling,
    pub last30: Rolling,
    /// Dated solves only; this is `days.len()`.
    pub active_days: usize,
    /// Dated solves ÷ active days; 0 when there are none.
    pub per_active_day: f64,
    /// Consecutive active days ending today or yesterday; 0 otherwise.
    pub current_streak: usize,
    pub longest_streak: usize,
    /// The day with the most solves (the oldest one on a tie), or `None`.
    pub best_day: Option<DayBucket>,
    /// Solves with no usable date; they are in no bucket.
    pub undated: usize,
    pub total_solves: usize,
}

fn empty_day(start_ms: f64) -> DayBucket {
    DayBucket {
        key: day_key(start_ms),
        start_ms,
        count: 0,
        total_ms: 0.0,
    }
}

/// The window `[today - (days - 1), today]`, solved counts and active days.
fn rolling(days: &[DayBucket], today_start: f64, span: i64) -> Rolling {
    let from = shift_days(today_start, -(span as i32 - 1));
    let mut solves = 0;
    let mut active_days = 0;
    for day in days {
        if day.start_ms < from {
            continue;
        }
        solves += day.count;
        active_days += 1;
    }
    Rolling {
        solves,
        active_days,
    }
}

/// Bucket `solves` into local days and derive the figures the Summary tab
/// shows. `now` is passed in so "today", the streaks and the rolling windows
/// are testable without depending on the machine's clock.
pub fn activity(solves: &[Solve], now: f64) -> Activity {
    // Keyed by local midnight; the key is whole milliseconds, so an `i64` is
    // exact and keeps the map ordered oldest-first.
    let mut buckets: BTreeMap<i64, DayBucket> = BTreeMap::new();
    let mut undated = 0;

    for solve in solves {
        if !solve.created_at_ms.is_finite() || solve.created_at_ms <= 0.0 {
            undated += 1;
            continue;
        }
        let start_ms = day_start(solve.created_at_ms);
        let bucket = buckets
            .entry(start_ms as i64)
            .or_insert_with(|| empty_day(start_ms));
        bucket.count += 1;
        if solve.time_ms.is_finite() {
            bucket.total_ms += solve.time_ms;
        }
    }

    let days: Vec<DayBucket> = buckets.values().cloned().collect();
    let today_start = day_start(now);
    let today = buckets
        .get(&(today_start as i64))
        .cloned()
        .unwrap_or_else(|| empty_day(today_start));

    let mut longest_streak = 0;
    let mut run = 0;
    let mut best_day: Option<DayBucket> = None;
    for (index, day) in days.iter().enumerate() {
        if index > 0 && shift_days(days[index - 1].start_ms, 1) == day.start_ms {
            run += 1;
        } else {
            run = 1;
        }
        if run > longest_streak {
            longest_streak = run;
        }
        // Strict `>` keeps the oldest day on a tie: the first time the record
        // was reached is the more interesting one.
        if best_day.as_ref().is_none_or(|best| day.count > best.count) {
            best_day = Some(day.clone());
        }
    }

    // A streak is still "current" when yesterday was active and today has not
    // been recorded yet; it breaks only once a whole day has passed.
    let mut cursor = if buckets.contains_key(&(today_start as i64)) {
        today_start
    } else {
        shift_days(today_start, -1)
    };
    let mut current_streak = 0;
    while buckets.contains_key(&(cursor as i64)) {
        current_streak += 1;
        cursor = shift_days(cursor, -1);
    }

    let dated_solves: usize = days.iter().map(|day| day.count).sum();
    Activity {
        today,
        last7: rolling(&days, today_start, 7),
        last30: rolling(&days, today_start, 30),
        active_days: days.len(),
        per_active_day: if days.is_empty() {
            0.0
        } else {
            dated_solves as f64 / days.len() as f64
        },
        current_streak,
        longest_streak,
        best_day,
        undated,
        total_solves: solves.len(),
        days,
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HeatmapCell {
    /// Local midnight of the day.
    pub start_ms: i64,
    pub key: String,
    pub count: usize,
    /// 0 (empty) to 4 (the busiest day in this map).
    pub level: u8,
    /// False for days after today in the current week.
    pub in_range: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Heatmap {
    /// Oldest week first; each week is Monday..Sunday.
    pub weeks: Vec<Vec<HeatmapCell>>,
    /// The largest daily count inside the map; 0 when there is no data.
    pub max_count: usize,
    /// Local midnight of the first cell, always a Monday.
    pub start_ms: i64,
}

/// A calendar heatmap for the last `weeks` weeks, aligned to Monday and ending
/// with the current week. Days after today are `in_range: false` so the UI can
/// leave them blank instead of drawing a misleading zero. `now` must be the
/// same instant passed to [`activity`].
///
/// The levels are scaled against the busiest day **inside** the map, so an
/// ancient 500-solve day cannot flatten the recent colours.
pub fn heatmap(stats: &Activity, now: f64, weeks: usize) -> Heatmap {
    let columns = weeks.max(1);
    let counts: BTreeMap<i64, usize> = stats
        .days
        .iter()
        .map(|day| (day.start_ms as i64, day.count))
        .collect();

    let today_start = day_start(now);
    // The grid is Monday-first; `Date#getDay` is Sunday-first, so Sunday (0)
    // maps to 6 days into the week.
    let weekday = (weekday(today_start) as usize + 6) % 7;
    let first_monday = shift_days(today_start, -(((columns - 1) * 7) as i32) - weekday as i32);

    let mut max_count = 0;
    for column in 0..columns {
        for day in 0..7 {
            let start_ms = shift_days(first_monday, (column * 7 + day) as i32);
            if start_ms > today_start {
                continue;
            }
            max_count = max_count.max(counts.get(&(start_ms as i64)).copied().unwrap_or(0));
        }
    }

    let mut result = Vec::with_capacity(columns);
    for column in 0..columns {
        let mut week = Vec::with_capacity(7);
        for day in 0..7 {
            let start_ms = shift_days(first_monday, (column * 7 + day) as i32);
            let in_range = start_ms <= today_start;
            let count = counts.get(&(start_ms as i64)).copied().unwrap_or(0);
            let level = if !in_range || count == 0 || max_count == 0 {
                0
            } else {
                ((count as f64 / max_count as f64) * 4.0)
                    .ceil()
                    .clamp(1.0, 4.0) as u8
            };
            week.push(HeatmapCell {
                start_ms: start_ms as i64,
                key: day_key(start_ms),
                count,
                level,
                in_range,
            });
        }
        result.push(week);
    }
    Heatmap {
        weeks: result,
        max_count,
        start_ms: first_monday as i64,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Local wall-clock time: local midnight through libc, plus whole hours.
    fn local(year: i32, month: u32, day: i32, hour: i32) -> f64 {
        c_midnight(year, month, day) + hour as f64 * 3_600_000.0
    }

    /// Local midnight, through libc, for the tests only.
    fn c_midnight(year: i32, month: u32, day: i32) -> f64 {
        let mut local: libc::tm = unsafe { std::mem::zeroed() };
        local.tm_year = year - 1900;
        local.tm_mon = month as libc::c_int - 1;
        local.tm_mday = day;
        local.tm_isdst = -1;
        unsafe { libc::mktime(&mut local) as f64 * 1000.0 }
    }

    fn solve(id: u64, created_at_ms: f64) -> Solve {
        Solve {
            id,
            time_ms: 10_000.0,
            scramble: String::new(),
            scramble_type: "333".into(),
            created_at_ms,
            penalty: None,
            comment: None,
        }
    }

    /// 8 November 2026, a Sunday, at noon local time.
    fn now() -> f64 {
        local(2026, 11, 8, 12)
    }

    #[test]
    fn buckets_by_local_day_and_keeps_undated_solves_out() {
        let stats = activity(
            &[
                solve(1, local(2026, 11, 6, 23)),
                solve(2, local(2026, 11, 7, 0)),
                solve(3, local(2026, 11, 7, 18)),
                solve(4, 0.0),
                solve(5, f64::NAN),
            ],
            now(),
        );
        let days: Vec<(&str, usize)> = stats
            .days
            .iter()
            .map(|day| (day.key.as_str(), day.count))
            .collect();
        assert_eq!(days, vec![("2026-11-06", 1), ("2026-11-07", 2)]);
        assert_eq!(stats.undated, 2);
        assert_eq!(stats.total_solves, 5);
        assert_eq!(stats.active_days, 2);
        assert_eq!(stats.per_active_day, 1.5);
    }

    #[test]
    fn counts_today_the_rolling_windows_and_the_best_day() {
        let solves = [
            solve(1, local(2026, 10, 10, 12)), // 30 days ago: outside both windows
            solve(2, local(2026, 11, 1, 12)),
            solve(3, local(2026, 11, 2, 12)),
            solve(4, local(2026, 11, 2, 12)),
            solve(5, local(2026, 11, 2, 12)),
            solve(6, local(2026, 11, 7, 12)),
            solve(7, local(2026, 11, 8, 12)),
        ];
        let stats = activity(&solves, now());
        assert_eq!(
            stats.today,
            DayBucket {
                key: "2026-11-08".into(),
                start_ms: local(2026, 11, 8, 0),
                count: 1,
                total_ms: 10_000.0,
            }
        );
        assert_eq!(
            stats.last7,
            Rolling {
                solves: 5,
                active_days: 3
            }
        );
        assert_eq!(
            stats.last30,
            Rolling {
                solves: 7,
                active_days: 5
            }
        );
        assert_eq!(
            stats.best_day.as_ref().map(|day| day.key.as_str()),
            Some("2026-11-02")
        );
        assert_eq!(stats.best_day.as_ref().map(|day| day.count), Some(3));
    }

    #[test]
    fn keeps_a_streak_current_through_yesterday_then_breaks_it() {
        let through_today = activity(
            &[
                solve(1, local(2026, 11, 6, 12)),
                solve(2, local(2026, 11, 7, 12)),
                solve(3, local(2026, 11, 8, 12)),
            ],
            now(),
        );
        assert_eq!(through_today.current_streak, 3);

        let through_yesterday = activity(
            &[
                solve(1, local(2026, 11, 6, 12)),
                solve(2, local(2026, 11, 7, 12)),
            ],
            now(),
        );
        assert_eq!(through_yesterday.current_streak, 2);

        let stale = activity(
            &[
                solve(1, local(2026, 11, 5, 12)),
                solve(2, local(2026, 11, 6, 12)),
            ],
            now(),
        );
        assert_eq!(stale.current_streak, 0);
    }

    #[test]
    fn finds_the_longest_streak_and_ties_the_best_day_to_the_oldest() {
        let day = |day: i32, count: usize| -> Vec<Solve> {
            (0..count)
                .map(|i| solve(day as u64 * 100 + i as u64, local(2026, 10, day, 12)))
                .collect()
        };
        let mut solves = day(1, 1);
        solves.extend(day(2, 1));
        solves.extend(day(3, 4));
        solves.extend(day(10, 1));
        solves.extend(day(11, 1));
        let stats = activity(&solves, now());
        assert_eq!(stats.longest_streak, 3);
        assert_eq!(stats.current_streak, 0);
        assert_eq!(
            stats.best_day.as_ref().map(|day| day.key.as_str()),
            Some("2026-10-03")
        );
        assert_eq!(stats.best_day.as_ref().map(|day| day.count), Some(4));
    }

    #[test]
    fn is_all_zeroes_for_an_empty_session() {
        let stats = activity(&[], now());
        assert!(stats.days.is_empty());
        assert_eq!(stats.today.count, 0);
        assert_eq!(stats.last7, Rolling::default());
        assert_eq!(stats.active_days, 0);
        assert_eq!(stats.per_active_day, 0.0);
        assert_eq!(stats.current_streak, 0);
        assert_eq!(stats.longest_streak, 0);
        assert!(stats.best_day.is_none());
    }

    #[test]
    fn fills_recent_calendar_days_with_zero_rows() {
        let stats = activity(&[solve(1, local(2026, 11, 6, 12))], now());
        let map = heatmap(&stats, now(), 1);
        let week: Vec<(&str, usize)> = map.weeks[0]
            .iter()
            .map(|cell| (cell.key.as_str(), cell.count))
            .collect();
        assert_eq!(
            week,
            vec![
                ("2026-11-02", 0),
                ("2026-11-03", 0),
                ("2026-11-04", 0),
                ("2026-11-05", 0),
                ("2026-11-06", 1),
                ("2026-11-07", 0),
                ("2026-11-08", 0),
            ]
        );
        assert_eq!(map.weeks[0][6].level, 0);
        assert!(map.weeks[0][6].in_range);
        assert_eq!(map.max_count, 1);
    }
}
