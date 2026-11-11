//! Data for the Statistics charts: a time histogram and a trend.
//!
//! The rules are ported from csTimer's GPL `distribution.js` and `trend.js` —
//! the math, not the DOM. The bin width is one tenth of the finite time range,
//! rounded up to csTimer's own step ladder (100 ms … 100 s); the trend axis
//! snaps outward to whole steps. DNFs are gaps, never points at infinity: they
//! stay out of the bins and out of every line.
//!
//! Times are effective milliseconds ([`crate::core::stats`]), so +2 and DNF
//! already happened before this module sees them.

use std::collections::HashMap;

use super::stats::{StatKind, window_at_each};

/// csTimer's automatic precision ladder, in milliseconds.
const STEPS: [f64; 10] = [
    100.0, 200.0, 500.0, 1_000.0, 2_000.0, 5_000.0, 10_000.0, 20_000.0, 50_000.0, 100_000.0,
];

/// Roughly ten bins across the range, snapped to the ladder — csTimer's
/// `getBestDiff()` with automatic precision. A range of one solve still gets
/// the 100 ms floor rather than a zero-width bin.
fn choose_step(range_ms: f64) -> f64 {
    let target = range_ms / 10.0;
    for step in STEPS {
        if target < step {
            return step;
        }
    }
    STEPS[STEPS.len() - 1]
}

#[derive(Clone, Debug, PartialEq)]
pub struct HistogramBin {
    /// Inclusive lower bound, ms.
    pub start_ms: f64,
    /// Exclusive upper bound (except conceptually the final bin), ms.
    pub end_ms: f64,
    pub count: usize,
    /// Finite solves in this bin and every earlier one.
    pub cumulative: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Histogram {
    pub bins: Vec<HistogramBin>,
    pub step_ms: f64,
    /// Finite solves represented by the bins.
    pub total: usize,
    pub dnf_count: usize,
}

/// Count finite times into equal bins. The bins run from the bin containing
/// the best time to the bin containing the worst, including empty bins in
/// between so a gap in the distribution is visible. `None` when the session
/// has no finite solve at all.
pub fn histogram(times: &[f64]) -> Option<Histogram> {
    let mut best = f64::INFINITY;
    let mut worst = f64::NEG_INFINITY;
    let mut total = 0;
    let mut dnf_count = 0;

    for &time in times {
        if !time.is_finite() {
            dnf_count += 1;
            continue;
        }
        total += 1;
        if time < best {
            best = time;
        }
        if time > worst {
            worst = time;
        }
    }
    if total == 0 {
        return None;
    }

    let step_ms = choose_step(worst - best);
    let first = (best / step_ms).floor() as i64;
    let last = (worst / step_ms).floor() as i64;
    let mut counts: HashMap<i64, usize> = HashMap::new();
    for &time in times {
        if !time.is_finite() {
            continue;
        }
        *counts.entry((time / step_ms).floor() as i64).or_insert(0) += 1;
    }

    let mut bins = Vec::with_capacity((last - first + 1).max(0) as usize);
    let mut cumulative = 0;
    for index in first..=last {
        let count = counts.get(&index).copied().unwrap_or(0);
        cumulative += count;
        bins.push(HistogramBin {
            start_ms: index as f64 * step_ms,
            end_ms: (index + 1) as f64 * step_ms,
            count,
            cumulative,
        });
    }
    Some(Histogram {
        bins,
        step_ms,
        total,
        dnf_count,
    })
}

/// A point in chart space: `x` and `y` are both 0 (left/bottom) to 1.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TrendPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TrendSeries {
    pub kind: StatKind,
    pub points: Vec<TrendPoint>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TrendTick {
    pub value_ms: f64,
    /// Vertical position, 0 at the bottom of the plot and 1 at the top.
    pub y: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Trend {
    /// Single, ao5, ao12 — in that draw order.
    pub series: Vec<TrendSeries>,
    pub ticks: Vec<TrendTick>,
    pub plot_min_ms: f64,
    pub plot_max_ms: f64,
    pub step_ms: f64,
    /// All solves, DNFs included (the x axis counts them).
    pub count: usize,
    pub dnf_count: usize,
}

/// The trend chart's series and value axis. X is solve order: 0 is the
/// oldest solve and 1 the newest, so a DNF leaves a horizontal gap rather than
/// a spike. The ao5/ao12 points sit at the *last* solve of their window, the
/// same x the solve list gives that average.
pub fn trend(times: &[f64]) -> Option<Trend> {
    let mut best = f64::INFINITY;
    let mut worst = f64::NEG_INFINITY;
    let mut count = 0;
    let mut dnf_count = 0;

    for &time in times {
        if !time.is_finite() {
            dnf_count += 1;
            continue;
        }
        count += 1;
        if time < best {
            best = time;
        }
        if time > worst {
            worst = time;
        }
    }
    if count == 0 {
        return None;
    }

    let step_ms = choose_step(worst - best);
    let plot_min_ms = (best / step_ms).floor() * step_ms;
    let mut plot_max_ms = (worst / step_ms).ceil() * step_ms;
    if plot_max_ms == plot_min_ms {
        plot_max_ms = plot_min_ms + step_ms;
    }
    let height_ms = plot_max_ms - plot_min_ms;

    let total = times.len();
    let x_at = |index: usize| -> f64 {
        if total <= 1 {
            0.5
        } else {
            index as f64 / (total - 1) as f64
        }
    };
    let y_at = |value: f64| -> f64 { ((value - plot_min_ms) / height_ms).clamp(0.0, 1.0) };

    let mut raw = Vec::new();
    for (index, &time) in times.iter().enumerate() {
        if time.is_finite() {
            raw.push(TrendPoint {
                x: x_at(index),
                y: y_at(time),
            });
        }
    }

    let mut series = vec![TrendSeries {
        kind: StatKind::Single,
        points: raw,
    }];
    for kind in [StatKind::Ao5, StatKind::Ao12] {
        let values = window_at_each(times, kind);
        let mut points = Vec::new();
        for (index, &value) in values.iter().enumerate() {
            if value.is_finite() {
                points.push(TrendPoint {
                    x: x_at(index),
                    y: y_at(value),
                });
            }
        }
        series.push(TrendSeries { kind, points });
    }

    let mut ticks = Vec::new();
    let mut value_ms = plot_min_ms;
    while value_ms <= plot_max_ms {
        ticks.push(TrendTick {
            value_ms,
            y: (value_ms - plot_min_ms) / height_ms,
        });
        value_ms += step_ms;
    }
    Some(Trend {
        series,
        ticks,
        plot_min_ms,
        plot_max_ms,
        step_ms,
        count,
        dnf_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const INF: f64 = f64::INFINITY;

    #[test]
    fn bins_finite_times_on_cstimer_step_ladder() {
        // best 1000, worst 3900 → range 2900 → 290 ms target → 500 ms step.
        let chart = histogram(&[1_000.0, 1_100.0, 3_900.0]).expect("finite solves");
        assert_eq!(chart.step_ms, 500.0);
        assert_eq!(chart.bins.len(), 6);
        let shape: Vec<(f64, usize, usize)> = chart
            .bins
            .iter()
            .map(|bin| (bin.start_ms, bin.count, bin.cumulative))
            .collect();
        assert_eq!(
            shape,
            vec![
                (1_000.0, 2, 2),
                (1_500.0, 0, 2),
                (2_000.0, 0, 2),
                (2_500.0, 0, 2),
                (3_000.0, 0, 2),
                (3_500.0, 1, 3),
            ]
        );
        assert_eq!(chart.total, 3);
        assert_eq!(chart.dnf_count, 0);
    }

    #[test]
    fn keeps_dnfs_out_of_the_bins_and_counts_them_separately() {
        let chart = histogram(&[1_000.0, INF, INF]).expect("one finite solve");
        assert_eq!(
            chart.bins,
            vec![HistogramBin {
                start_ms: 1_000.0,
                end_ms: 1_100.0,
                count: 1,
                cumulative: 1,
            }]
        );
        assert_eq!(chart.total, 1);
        assert_eq!(chart.dnf_count, 2);
    }

    #[test]
    fn returns_none_when_every_solve_is_a_dnf() {
        assert_eq!(histogram(&[INF, INF]), None);
        assert_eq!(histogram(&[]), None);
    }

    #[test]
    fn falls_back_to_the_100_ms_floor_for_a_single_time() {
        let chart = histogram(&[12_340.0]).expect("one finite solve");
        assert_eq!(chart.step_ms, 100.0);
        assert_eq!(chart.bins.len(), 1);
        assert_eq!(chart.bins[0].count, 1);
    }

    #[test]
    fn caps_a_very_wide_range_at_the_100_s_step() {
        let chart = histogram(&[0.0, 5_000_000.0]).expect("finite solves");
        assert_eq!(chart.step_ms, 100_000.0);
        assert_eq!(chart.bins.len(), 51);
    }

    #[test]
    fn trend_normalizes_singles_and_places_ao5_at_the_window_end() {
        let chart =
            trend(&[1_000.0, 1_500.0, 2_000.0, 2_500.0, 3_000.0, 3_500.0]).expect("finite solves");
        assert_eq!(chart.step_ms, 500.0);
        assert_eq!(chart.plot_min_ms, 1_000.0);
        assert_eq!(chart.plot_max_ms, 3_500.0);
        let ticks: Vec<f64> = chart.ticks.iter().map(|tick| tick.value_ms).collect();
        assert_eq!(
            ticks,
            vec![1_000.0, 1_500.0, 2_000.0, 2_500.0, 3_000.0, 3_500.0]
        );
        assert_eq!(chart.series[0].kind, StatKind::Single);
        assert_eq!(
            chart.series[0].points,
            vec![
                TrendPoint { x: 0.0, y: 0.0 },
                TrendPoint { x: 0.2, y: 0.2 },
                TrendPoint { x: 0.4, y: 0.4 },
                TrendPoint { x: 0.6, y: 0.6 },
                TrendPoint { x: 0.8, y: 0.8 },
                TrendPoint { x: 1.0, y: 1.0 },
            ]
        );
        assert_eq!(chart.series[1].kind, StatKind::Ao5);
        assert_eq!(
            chart.series[1].points,
            vec![TrendPoint { x: 0.8, y: 0.4 }, TrendPoint { x: 1.0, y: 0.6 },]
        );
        assert!(chart.series[2].points.is_empty());
    }

    #[test]
    fn trend_leaves_dnfs_as_gaps_in_the_single_line() {
        let chart = trend(&[1_000.0, INF, 3_000.0]).expect("finite solves");
        assert_eq!(
            chart.series[0].points,
            vec![TrendPoint { x: 0.0, y: 0.0 }, TrendPoint { x: 1.0, y: 1.0 },]
        );
        assert_eq!(chart.dnf_count, 1);
    }

    #[test]
    fn trend_plots_one_solve_in_the_middle_of_the_x_axis() {
        let chart = trend(&[12_340.0]).expect("one finite solve");
        assert_eq!(chart.series[0].points, vec![TrendPoint { x: 0.5, y: 0.4 }]);
        assert_eq!(chart.plot_min_ms, 12_300.0);
        assert_eq!(chart.plot_max_ms, 12_400.0);
    }

    #[test]
    fn trend_returns_none_when_every_solve_is_a_dnf() {
        assert_eq!(trend(&[INF]), None);
    }
}
