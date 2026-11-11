//! The improvement history behind each personal best.
//!
//! [`pb_history`] walks the session once and keeps the solves that *strictly*
//! improved the record. Both halves matter in practice: a window can improve
//! without a new fastest single (a steady run of 12s beats an 11.5s
//! single-adjacent ao5), so Single and ao5 have different histories from the
//! same list of solves.
//!
//! A DNF is ∞ ([`crate::core::time`]): it can never improve a finite record
//! and it can never *be* one, so an all-DNF session has an empty history
//! rather than a meaningless first entry. Ties do not count — "equal to my
//! PB" is not a new PB.
//!
//! The date is the moment the solve *completed* the record: for a window that
//! is the last solve of the window, because that is when the average became
//! real. Imported solves may have no date (`created_at_ms` 0); the UI then
//! falls back to solve numbers, which are always present.

use super::calendar::day_start;
use super::session::Solve;
use super::stats::{StatKind, effective_times, window_at_each};

#[derive(Clone, Debug, PartialEq)]
pub struct PbRecord {
    /// The effective time or average that was the new best, in ms.
    pub value: f64,
    /// When the solve that completed it finished; 0 when the date is unknown.
    pub set_at_ms: f64,
    /// When the next improvement finished, or `None` while this record still
    /// stands. May be 0 when that solve has no date.
    pub held_until_ms: Option<f64>,
    /// The solve that completed the record (the window's last solve).
    pub solve_id: u64,
    /// Chronological index of that solve, 0-based.
    pub index: usize,
}

/// Every strict improvement of `kind`, oldest first. `Single` records use the
/// solve's own time; every other kind uses the completed window ending at that
/// solve.
pub fn pb_history(solves: &[Solve], kind: StatKind) -> Vec<PbRecord> {
    let values = window_at_each(&effective_times(solves), kind);
    let mut records: Vec<PbRecord> = Vec::new();

    for (index, &value) in values.iter().enumerate() {
        // NaN is an incomplete window; ∞ is a DNF — neither can set a record.
        if value.is_nan() || !value.is_finite() {
            continue;
        }

        if let Some(previous) = records.last_mut() {
            if value >= previous.value {
                continue;
            }
            previous.held_until_ms = Some(solves[index].created_at_ms);
        }

        records.push(PbRecord {
            value,
            set_at_ms: solves[index].created_at_ms,
            held_until_ms: None,
            solve_id: solves[index].id,
            index,
        });
    }

    records
}

/// Number of solves that elapsed before the record was broken, or between the
/// record and the newest solve while it still stands. A useful "held for"
/// figure when dates are unavailable; 0 means the record was set on the latest
/// solve.
pub fn held_solves(record: &PbRecord, total: usize, next: Option<&PbRecord>) -> i64 {
    let end = next.map_or(total.saturating_sub(1), |next| next.index);
    end as i64 - record.index as i64
}

/// Whole local calendar days between setting and breaking a record, or `None`
/// when either date is unknown. A same-day improvement reads as 0, which the
/// UI presents as "same day" rather than "0 days".
pub fn held_days(record: &PbRecord) -> Option<i64> {
    let held_until = record.held_until_ms?;
    if record.set_at_ms <= 0.0 || held_until <= 0.0 {
        return None;
    }
    let start = day_start(record.set_at_ms);
    let end = day_start(held_until);
    Some(((end - start) / 86_400_000.0).round().max(0.0) as i64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::time::Penalty;

    const INF: f64 = f64::INFINITY;

    fn solve(id: u64, time_ms: f64, created_at_ms: f64) -> Solve {
        Solve {
            id,
            time_ms,
            scramble: String::new(),
            scramble_type: "333".into(),
            created_at_ms,
            penalty: None,
            comment: None,
        }
    }

    fn local(year: i32, month: u32, day: i32, hour: i32) -> f64 {
        let mut tm: libc::tm = unsafe { std::mem::zeroed() };
        tm.tm_year = year - 1900;
        tm.tm_mon = month as libc::c_int - 1;
        tm.tm_mday = day;
        tm.tm_hour = hour;
        tm.tm_isdst = -1;
        unsafe { libc::mktime(&mut tm) as f64 * 1000.0 }
    }

    #[test]
    fn keeps_only_strict_single_improvements() {
        let solves = [
            solve(1, 12_000.0, 1_000.0),
            solve(2, 14_000.0, 2_000.0), // slower: no record
            solve(3, 11_000.0, 3_000.0), // record
            solve(4, 11_000.0, 4_000.0), // tie: no record
            solve(5, 10_000.0, 5_000.0), // record
        ];
        let history = pb_history(&solves, StatKind::Single);
        assert_eq!(
            history,
            vec![
                PbRecord {
                    value: 12_000.0,
                    set_at_ms: 1_000.0,
                    held_until_ms: Some(3_000.0),
                    solve_id: 1,
                    index: 0,
                },
                PbRecord {
                    value: 11_000.0,
                    set_at_ms: 3_000.0,
                    held_until_ms: Some(5_000.0),
                    solve_id: 3,
                    index: 2,
                },
                PbRecord {
                    value: 10_000.0,
                    set_at_ms: 5_000.0,
                    held_until_ms: None,
                    solve_id: 5,
                    index: 4,
                },
            ]
        );
    }

    #[test]
    fn lets_an_average_improve_without_a_new_fastest_single() {
        // The single is set on solve 1 and never beaten; the ao5 improves
        // later as the *other* four solves catch up.
        let times = [
            9_000.0, 20_000.0, 20_000.0, 20_000.0, 20_000.0, 10_000.0, 10_000.0, 10_000.0, 10_000.0,
        ];
        let solves: Vec<Solve> = times
            .iter()
            .enumerate()
            .map(|(i, &time_ms)| solve(i as u64 + 1, time_ms, (i as f64 + 1.0) * 1_000.0))
            .collect();

        assert_eq!(pb_history(&solves, StatKind::Single).len(), 1);
        let ao5 = pb_history(&solves, StatKind::Ao5);
        assert!(ao5.len() > 1);
        // The first record is the first completed window (index 4)…
        assert_eq!(ao5[0].index, 4);
        // …and the last one is the latest completed window, still standing.
        assert_eq!(ao5.last().map(|record| record.index), Some(8));
        assert_eq!(ao5.last().and_then(|record| record.held_until_ms), None);
        // Each old record's `held_until` is the next record's `set_at`.
        for pair in ao5.windows(2) {
            assert_eq!(pair[0].held_until_ms, Some(pair[1].set_at_ms));
            assert!(pair[0].value > pair[1].value);
        }
    }

    #[test]
    fn never_lets_a_dnf_be_a_record() {
        let mut solves = [solve(1, 12_000.0, 0.0), solve(2, 10_000.0, 0.0)];
        solves[0].penalty = Some(Penalty::Dnf);
        solves[1].penalty = Some(Penalty::Dnf);
        assert_eq!(pb_history(&solves, StatKind::Single), vec![]);
        assert_eq!(pb_history(&solves, StatKind::Ao5), vec![]);
    }

    #[test]
    fn skips_dnfs_in_a_window_history_and_keeps_the_finite_improvements() {
        // ao5 windows: [12,12,12,12,DNF] = 12.00 (DNF trimmed), then
        // [12,12,12,DNF,11] = 12.00 (tie), then [12,12,DNF,11,11] = 11.67,
        // then [12,DNF,11,11,11] = 11.33.
        let mut solves: Vec<Solve> = (1..=8)
            .map(|id| {
                let time_ms = if id <= 5 { 12_000.0 } else { 11_000.0 };
                solve(id, time_ms, id as f64 * 1_000.0)
            })
            .collect();
        solves[4].penalty = Some(Penalty::Dnf);

        let history = pb_history(&solves, StatKind::Ao5);
        let indices: Vec<usize> = history.iter().map(|record| record.index).collect();
        assert_eq!(indices, vec![4, 6, 7]);
        assert_eq!(history[0].value, 12_000.0);
        assert!((history[1].value - 35_000.0 / 3.0).abs() < 1e-5);
        assert!((history[2].value - 34_000.0 / 3.0).abs() < 1e-5);
    }

    #[test]
    fn keeps_zero_dates_as_unknown_rather_than_inventing_1970() {
        let solves = [solve(1, 12_000.0, 0.0), solve(2, 11_000.0, 0.0)];
        let history = pb_history(&solves, StatKind::Single);
        assert_eq!(history[0].set_at_ms, 0.0);
        assert_eq!(history[0].held_until_ms, Some(0.0));
        assert_eq!(history[1].set_at_ms, 0.0);
        assert_eq!(held_days(&history[0]), None);
    }

    #[test]
    fn counts_the_solves_between_a_record_and_the_one_that_broke_it() {
        let solves = [
            solve(1, 12_000.0, 1_000.0),
            solve(2, 11_000.0, 2_000.0),
            solve(3, 10_000.0, 3_000.0),
        ];
        let history = pb_history(&solves, StatKind::Single);
        assert_eq!(held_solves(&history[0], 3, Some(&history[1])), 1);
        assert_eq!(held_solves(&history[1], 3, Some(&history[2])), 1);
        assert_eq!(held_solves(&history[2], 3, None), 0);
    }

    #[test]
    fn measures_whole_calendar_days_when_both_dates_are_known() {
        let record = PbRecord {
            value: 10_000.0,
            set_at_ms: local(2026, 3, 14, 18),
            held_until_ms: Some(local(2026, 3, 16, 9)),
            solve_id: 1,
            index: 0,
        };
        assert_eq!(held_days(&record), Some(2));
        // Same day: 0, which the UI words as "same day".
        assert_eq!(
            held_days(&PbRecord {
                held_until_ms: Some(local(2026, 3, 14, 23)),
                ..record.clone()
            }),
            Some(0)
        );
        // Still standing / unknown: no day figure.
        assert_eq!(
            held_days(&PbRecord {
                held_until_ms: None,
                ..record
            }),
            None
        );
    }

    #[test]
    fn an_incomplete_single_window_never_sets_a_record() {
        // Reaching for a window kind with too few solves returns no history,
        // and the sentinel values never leak through.
        let solves = [solve(1, INF, 1_000.0)];
        assert!(pb_history(&solves, StatKind::Ao5).is_empty());
    }
}
