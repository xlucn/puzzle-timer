//! Session statistics: window averages, bests, mean, PB target.
//!
//! Pure Rust: no GTK, no IO, no clock. The rules are ported from csTimer's
//! GPL `timestat.js` (TimeStat) — the *math*, not the DOM: DNF as ∞ so it
//! sorts last and poisons an average only when it survives trimming (WCA
//! 9f8–9f9), trim [1,1] for every aoN, no trim for mo3 (any DNF → DNF, WCA
//! 9f10), session mean over non-DNF solves only. What csTimer does with a
//! red-black tree over a sorted list, this module does with an incrementally
//! maintained sorted window: adding and removing a solve are binary-search +
//! insert, and the trimmed mean is read off the running sums in O(1). That
//! keeps a 50 000-solve session with an ao1000 on screen in the tens of
//! milliseconds instead of the repeated sorts an ao5/ao12-sized window could
//! afford.
//!
//! Units: everything in milliseconds, *effective* milliseconds — the caller
//! maps solves through [`effective_ms`] first, so +2 and DNF are already
//! folded in and DNF is [`f64::INFINITY`].

use super::session::Solve;
use super::time::effective_ms;

/// The averages we show. `Single` is a "window" of size 1 for the dialog.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum StatKind {
    Single,
    Mo3,
    Ao5,
    Ao12,
    Ao50,
    Ao100,
    Ao1000,
}

/// Every kind, shortest window first — the dialog's row order.
pub const STAT_KINDS: [StatKind; 7] = [
    StatKind::Single,
    StatKind::Mo3,
    StatKind::Ao5,
    StatKind::Ao12,
    StatKind::Ao50,
    StatKind::Ao100,
    StatKind::Ao1000,
];

const STAT_COUNT: usize = STAT_KINDS.len();

impl StatKind {
    /// Position of the kind in [`STAT_KINDS`]; also its array index in
    /// [`SessionStats`].
    pub fn index(self) -> usize {
        match self {
            StatKind::Single => 0,
            StatKind::Mo3 => 1,
            StatKind::Ao5 => 2,
            StatKind::Ao12 => 3,
            StatKind::Ao50 => 4,
            StatKind::Ao100 => 5,
            StatKind::Ao1000 => 6,
        }
    }

    /// The stable id used by persistent preferences and the UI.
    pub fn id(self) -> &'static str {
        match self {
            StatKind::Single => "single",
            StatKind::Mo3 => "mo3",
            StatKind::Ao5 => "ao5",
            StatKind::Ao12 => "ao12",
            StatKind::Ao50 => "ao50",
            StatKind::Ao100 => "ao100",
            StatKind::Ao1000 => "ao1000",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WindowSpec {
    /// Solves in the window.
    pub size: usize,
    /// Best and worst dropped from each end (WCA 9f8: [1,1] for every aoN).
    pub trim_l: usize,
    pub trim_r: usize,
}

pub fn window_spec(kind: StatKind) -> WindowSpec {
    match kind {
        StatKind::Single => WindowSpec {
            size: 1,
            trim_l: 0,
            trim_r: 0,
        },
        // mo3 is the plain mean of three: no trimming, so any DNF poisons it.
        StatKind::Mo3 => WindowSpec {
            size: 3,
            trim_l: 0,
            trim_r: 0,
        },
        // The larger averages are csTimer's: like ao5/ao12, one solve is
        // dropped from each end rather than a percentage.
        StatKind::Ao5 => WindowSpec {
            size: 5,
            trim_l: 1,
            trim_r: 1,
        },
        StatKind::Ao12 => WindowSpec {
            size: 12,
            trim_l: 1,
            trim_r: 1,
        },
        StatKind::Ao50 => WindowSpec {
            size: 50,
            trim_l: 1,
            trim_r: 1,
        },
        StatKind::Ao100 => WindowSpec {
            size: 100,
            trim_l: 1,
            trim_r: 1,
        },
        StatKind::Ao1000 => WindowSpec {
            size: 1000,
            trim_l: 1,
            trim_r: 1,
        },
    }
}

/// The scored times of a session, in order — the input to everything below.
pub fn effective_times(solves: &[Solve]) -> Vec<f64> {
    solves
        .iter()
        .map(|solve| effective_ms(solve.time_ms, solve.penalty))
        .collect()
}

/// Mean of `values` after dropping `trim_l` smallest and `trim_r` largest.
///
/// Sorted ascending, ∞ lands at the right end, so "did a DNF survive
/// trimming" is exactly "is an ∞ inside the kept span" — no sentinel values,
/// no special cases. Returns NaN only when the kept span is empty (a window
/// trimmed down to nothing, which our specs never do).
pub fn mean_window(values: &[f64], trim_l: usize, trim_r: usize) -> f64 {
    if values.is_empty() {
        return f64::NAN;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let end = sorted.len().saturating_sub(trim_r);
    let start = trim_l.min(end);
    let kept = &sorted[start..end];
    if kept.is_empty() {
        return f64::NAN;
    }
    let mut sum = 0.0;
    for &value in kept {
        if !value.is_finite() {
            return f64::INFINITY;
        }
        sum += value;
    }
    sum / kept.len() as f64
}

/// The current value of a window — the last `size` solves (what the strip
/// under the timer shows). NaN while the session is too short: the UI shows
/// an em dash, not a misleading partial average.
pub fn current_window(times: &[f64], kind: StatKind) -> f64 {
    let WindowSpec {
        size,
        trim_l,
        trim_r,
    } = window_spec(kind);
    if kind == StatKind::Single {
        return times.last().copied().unwrap_or(f64::NAN);
    }
    if times.len() < size {
        return f64::NAN;
    }
    mean_window(&times[times.len() - size..], trim_l, trim_r)
}

/// Index of the first element ≥ `value` (Infinity sorts last).
fn lower_bound(values: &[f64], value: f64) -> usize {
    let mut low = 0;
    let mut high = values.len();
    while low < high {
        let mid = (low + high) / 2;
        if values[mid] < value {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    low
}

/// A sliding window kept in ascending order, with its trimmed mean readable
/// in O(1): `finite_sum` and `infinity_count` make the kept span's sum a
/// couple of subtractions, because the trim count is tiny and fixed (1 for
/// every aoN).
///
/// DNFs are ∞ and therefore always occupy the end: if more of them survive
/// than `trim_r`, the window's mean is ∞ — exactly [`mean_window`]'s rule.
struct SortedWindow {
    values: Vec<f64>,
    finite_sum: f64,
    infinity_count: usize,
    trim_l: usize,
    trim_r: usize,
}

impl SortedWindow {
    fn new(trim_l: usize, trim_r: usize) -> Self {
        Self {
            values: Vec::new(),
            finite_sum: 0.0,
            infinity_count: 0,
            trim_l,
            trim_r,
        }
    }

    fn add(&mut self, value: f64) {
        let index = lower_bound(&self.values, value);
        self.values.insert(index, value);
        if value.is_finite() {
            self.finite_sum += value;
        } else {
            self.infinity_count += 1;
        }
    }

    fn remove(&mut self, value: f64) {
        let index = lower_bound(&self.values, value);
        if index >= self.values.len() {
            return; // callers remove what they added
        }
        self.values.remove(index);
        if value.is_finite() {
            self.finite_sum -= value;
        } else {
            self.infinity_count -= 1;
        }
    }

    fn mean(&self) -> f64 {
        let len = self.values.len();
        let kept = len as isize - self.trim_l as isize - self.trim_r as isize;
        if kept <= 0 {
            return f64::NAN;
        }
        if self.infinity_count > self.trim_r {
            return f64::INFINITY;
        }
        let mut sum = self.finite_sum;
        for &value in &self.values[..self.trim_l] {
            if value.is_finite() {
                sum -= value;
            }
        }
        for &value in &self.values[len - self.trim_r..] {
            if value.is_finite() {
                sum -= value;
            }
        }
        sum / kept as f64
    }
}

/// The value of `kind` **as of each solve**: `out[i]` is the window *ending*
/// at `times[i]`, in session order (oldest → newest) — the number the solve
/// list shows in its ao5/ao12 columns for that row, so every row reads the
/// average it belonged to rather than today's.
///
/// NaN until the window has filled, the same contract as [`current_window`]:
/// the caller decides what an incomplete window looks like (the list and the
/// strip both show an em dash), never a misleading partial average. `Single`
/// is the times themselves.
pub fn window_at_each(times: &[f64], kind: StatKind) -> Vec<f64> {
    let WindowSpec {
        size,
        trim_l,
        trim_r,
    } = window_spec(kind);
    if kind == StatKind::Single {
        return times.to_vec();
    }
    let mut out = vec![f64::NAN; times.len()];
    if times.len() < size {
        return out;
    }

    let mut window = SortedWindow::new(trim_l, trim_r);
    for end in 0..times.len() {
        window.add(times[end]);
        if end >= size {
            window.remove(times[end - size]);
        }
        if end + 1 >= size {
            out[end] = window.mean();
        }
    }
    out
}

/// The best (smallest) completed window, with the index of its last solve
/// (the list uses it to highlight the solves behind a best average). DNF
/// windows are ∞, so a finite window always wins; when *every* window is a
/// DNF the value is ∞ and the UI shows "DNF". `None` when no window has
/// completed yet.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BestWindow {
    pub value: f64,
    pub end_index: usize,
}

/// A single's first solve is "the best so far" even when it is a DNF, which
/// is why the `end_index` guard is there rather than a plain comparison.
pub fn best_window(times: &[f64], kind: StatKind) -> Option<BestWindow> {
    let mut best = f64::INFINITY;
    let mut end_index: Option<usize> = None;
    for (index, value) in window_at_each(times, kind).into_iter().enumerate() {
        if value.is_nan() {
            continue;
        }
        if end_index.is_none() || value < best {
            best = value;
            end_index = Some(index);
        }
    }
    end_index.map(|end_index| BestWindow {
        value: best,
        end_index,
    })
}

/// Best single (finite) time, or `None` when there is no finite solve.
pub fn best_single(times: &[f64]) -> Option<f64> {
    let mut best = f64::INFINITY;
    for &value in times {
        if value < best {
            best = value;
        }
    }
    best.is_finite().then_some(best)
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SessionMean {
    /// Mean of the non-DNF solves; NaN when every solve is a DNF (or none).
    pub mean: f64,
    pub dnf_count: usize,
    /// Solves that count towards the mean (total minus DNFs).
    pub count: usize,
}

/// The session mean: sum of the non-DNF effective times ÷ their count, plus
/// how many DNFs there are (csTimer's `getAllStats` — the mean excludes DNFs,
/// the count reports them).
pub fn session_mean(times: &[f64]) -> SessionMean {
    let mut sum = 0.0;
    let mut count = 0;
    let mut dnf_count = 0;
    for &value in times {
        if value.is_finite() {
            sum += value;
            count += 1;
        } else {
            dnf_count += 1;
        }
    }
    SessionMean {
        mean: if count > 0 {
            sum / count as f64
        } else {
            f64::NAN
        },
        dnf_count,
        count,
    }
}

/// Spread and consistency over the *finite* effective times — DNFs are
/// excluded rather than counted as ∞, because one DNF would otherwise make
/// every figure infinite and useless. `sigma` is the population standard
/// deviation (÷ n, the form csTimer's σ display uses); it is NaN when nothing
/// finite exists.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Spread {
    /// Fastest finite effective time; `None` when every solve is a DNF.
    pub best: Option<f64>,
    /// Slowest finite effective time; `None` likewise.
    pub worst: Option<f64>,
    /// worst − best, for one number that says how wide the range is.
    pub range: Option<f64>,
    /// Population standard deviation over the finite times; NaN if none.
    pub sigma: f64,
    /// How many solves the four figures above were computed over.
    pub count: usize,
}

pub fn spread(times: &[f64]) -> Spread {
    let mut best = f64::INFINITY;
    let mut worst = f64::NEG_INFINITY;
    let mut count = 0;
    let mut sum = 0.0;
    for &value in times {
        if !value.is_finite() {
            continue;
        }
        count += 1;
        sum += value;
        if value < best {
            best = value;
        }
        if value > worst {
            worst = value;
        }
    }
    if count == 0 {
        return Spread {
            best: None,
            worst: None,
            range: None,
            sigma: f64::NAN,
            count: 0,
        };
    }
    let mean = sum / count as f64;
    let mut squares = 0.0;
    for &value in times {
        if value.is_finite() {
            squares += (value - mean) * (value - mean);
        }
    }
    Spread {
        best: Some(best),
        worst: Some(worst),
        range: Some(worst - best),
        sigma: (squares / count as f64).sqrt(),
        count,
    }
}

/// What the next solve must score to break a record:
///
/// - [`PbTarget::Value`] — this time or better (a multiple of 10 ms)
/// - [`PbTarget::Always`] — no possible next result fails to break it (or
///   the record itself is a DNF and any finite result beats it)
/// - [`PbTarget::Never`] — no possible result breaks it
/// - [`PbTarget::None`] — not enough solves for the record to exist yet
///
/// For a window average the target is the *minimum* x with
/// `mean_window(kept ∪ {x}) < best`, searched over multiples of 10 —
/// monotone in x, so a plain binary search applies (this is csTimer's
/// `getThres` computed by arithmetic instead of by walking its tree).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PbTarget {
    Value(f64),
    Always,
    Never,
    None,
}

/// Smallest multiple of 10 that is ≥ `value` (clamped at 0).
fn ceil10(value: f64) -> f64 {
    ((value / 10.0).ceil() * 10.0).max(0.0)
}

pub fn pb_target(times: &[f64], kind: StatKind) -> PbTarget {
    let WindowSpec {
        size,
        trim_l,
        trim_r,
    } = window_spec(kind);
    let Some(best) = best_window(times, kind) else {
        return PbTarget::None;
    };

    if kind == StatKind::Single {
        // Best single is a whole centisecond; one tick faster beats it.
        if !best.value.is_finite() {
            return PbTarget::Always; // every solve so far is a DNF
        }
        if best.value <= 0.0 {
            return PbTarget::Never;
        }
        return PbTarget::Value(best.value - 10.0);
    }

    // The window the next solve will complete: the current last `size - 1`
    // solves (the oldest of today's last window drops out).
    let kept = &times[times.len().saturating_sub(size - 1)..];
    let mean_with = |x: f64| {
        let mut values = Vec::with_capacity(kept.len() + 1);
        values.extend_from_slice(kept);
        values.push(x);
        mean_window(&values, trim_l, trim_r)
    };

    // Every completed window is a DNF: any finite result sets a real best.
    if !best.value.is_finite() {
        return if mean_with(0.0).is_finite() {
            PbTarget::Always
        } else {
            PbTarget::Never
        };
    }

    if mean_with(f64::INFINITY) < best.value {
        return PbTarget::Always;
    }
    if mean_with(0.0) >= best.value {
        return PbTarget::Never;
    }

    // The target is the *largest* time that still beats the best — mean_with
    // is monotone non-decreasing, so P(x) = mean_with(x) < best holds on
    // [0, b] and fails after: binary-search the boundary over multiples of
    // 10. The upper bound must have P false: `keptMax + 10` covers the case
    // where a large enough x sits where ∞ would (and mean_with(∞) ≥ best was
    // checked above), and `neff·best + 10` covers every case where x stays
    // inside the kept span (mean ≥ x/neff > best there).
    let mut kept_max = 0.0_f64;
    for &value in kept {
        if value.is_finite() {
            kept_max = kept_max.max(value);
        }
    }
    let neff = (size - trim_l - trim_r) as f64;
    let hi = ceil10(kept_max + 10.0).max(ceil10(neff * best.value + 10.0));

    let mut low_ticks: i64 = 0; // P(low_ticks * 10) is known true
    let mut high_ticks: i64 = (hi / 10.0).round() as i64; // known false or boundary-beyond
    while low_ticks + 1 < high_ticks {
        let mid_ticks = low_ticks + (high_ticks - low_ticks) / 2;
        if mean_with(mid_ticks as f64 * 10.0) < best.value {
            low_ticks = mid_ticks;
        } else {
            high_ticks = mid_ticks;
        }
    }
    // low_ticks is the largest tick verified true (or 0, still true by the
    // check above); high_ticks is the first false — or low_ticks + 1 when the
    // whole range holds, in which case hi itself is a valid target.
    let answer = if mean_with(high_ticks as f64 * 10.0) < best.value {
        high_ticks
    } else {
        low_ticks
    };
    PbTarget::Value(answer as f64 * 10.0)
}

/// Everything the Statistics dialog and the strip need, in one pass.
#[derive(Clone, Debug, PartialEq)]
pub struct SessionStats {
    pub times: Vec<f64>,
    /// Current value per kind; NaN while incomplete. Index by
    /// [`StatKind::index`].
    pub current: [f64; STAT_COUNT],
    /// Best value per kind and the solve it ends at.
    pub best: [Option<BestWindow>; STAT_COUNT],
    /// Per-kind PB target.
    pub target: [PbTarget; STAT_COUNT],
    pub mean: SessionMean,
    pub best_single_ms: Option<f64>,
    pub spread: Spread,
    /// Sum of the measured times of every solve, DNFs included.
    pub total_ms: f64,
}

impl SessionStats {
    pub fn current_for(&self, kind: StatKind) -> f64 {
        self.current[kind.index()]
    }

    pub fn best_for(&self, kind: StatKind) -> Option<BestWindow> {
        self.best[kind.index()]
    }

    pub fn target_for(&self, kind: StatKind) -> PbTarget {
        self.target[kind.index()]
    }
}

pub fn session_stats(solves: &[Solve]) -> SessionStats {
    let times = effective_times(solves);
    let mut current = [f64::NAN; STAT_COUNT];
    let mut best = [None; STAT_COUNT];
    let mut target = [PbTarget::None; STAT_COUNT];
    for kind in STAT_KINDS {
        let index = kind.index();
        current[index] = current_window(&times, kind);
        best[index] = best_window(&times, kind);
        target[index] = pb_target(&times, kind);
    }
    let mut total_ms = 0.0;
    for solve in solves {
        if solve.time_ms.is_finite() {
            total_ms += solve.time_ms;
        }
    }
    SessionStats {
        current,
        best,
        target,
        mean: session_mean(&times),
        best_single_ms: best_single(&times),
        spread: spread(&times),
        total_ms,
        times,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::time::Penalty;

    const INF: f64 = f64::INFINITY;

    fn solve(time_ms: f64, penalty: Option<Penalty>) -> Solve {
        Solve {
            id: 1,
            time_ms,
            scramble: String::new(),
            scramble_type: "333".into(),
            created_at_ms: 0.0,
            penalty,
            comment: None,
        }
    }

    #[test]
    fn ao5_drops_the_best_and_the_worst() {
        // sorted: 9.80, 10.00, 10.20, 10.40, 12.00 → drop 9.80 and 12.00
        assert_eq!(
            mean_window(&[10_400.0, 12_000.0, 10_000.0, 9_800.0, 10_200.0], 1, 1),
            (10_000.0 + 10_200.0 + 10_400.0) / 3.0
        );
    }

    #[test]
    fn mo3_keeps_every_solve() {
        assert_eq!(
            mean_window(&[10_000.0, 11_000.0, 13_000.0], 0, 0),
            34_000.0 / 3.0
        );
    }

    #[test]
    fn trims_a_single_dnf_away() {
        // sorted: 10.00, 10.20, 10.40, 12.00, DNF → drop 10.00 and the DNF
        assert_eq!(
            mean_window(&[10_000.0, 10_200.0, 10_400.0, 12_000.0, INF], 1, 1),
            (10_200.0 + 10_400.0 + 12_000.0) / 3.0
        );
    }

    #[test]
    fn two_dnfs_poison_the_ao5() {
        assert_eq!(
            mean_window(&[10_000.0, 10_400.0, INF, INF, 12_000.0], 1, 1),
            INF
        );
    }

    #[test]
    fn one_dnf_poisons_an_untrimmed_mean() {
        assert_eq!(mean_window(&[10_000.0, 11_000.0, INF], 0, 0), INF);
    }

    #[test]
    fn an_empty_window_is_nan() {
        assert!(mean_window(&[], 1, 1).is_nan());
    }

    #[test]
    fn effective_times_fold_penalties_in() {
        let times = effective_times(&[
            solve(12_345.0, None),
            solve(12_345.0, Some(Penalty::Plus2)),
            solve(12_345.0, Some(Penalty::Dnf)),
        ]);
        assert_eq!(times, vec![12_340.0, 14_340.0, INF]);
    }

    #[test]
    fn current_window_is_nan_until_it_fills() {
        let five = [10_000.0, 10_200.0, 10_400.0, 10_600.0, 10_800.0];
        assert!(current_window(&five[..4], StatKind::Ao5).is_nan());
        assert_eq!(
            current_window(&five, StatKind::Ao5),
            (10_200.0 + 10_400.0 + 10_600.0) / 3.0
        );
    }

    #[test]
    fn current_window_reads_the_last_twelve_solves() {
        let times: Vec<f64> = (0..13).map(|i| 10_000.0 + i as f64 * 100.0).collect();
        // last 12: 10.10 … 11.30 → sorted, drop 10.10 and 11.30
        let kept: f64 = (0..10).map(|i| 10_200.0 + i as f64 * 100.0).sum();
        assert_eq!(current_window(&times, StatKind::Ao12), kept / 10.0);
    }

    #[test]
    fn current_window_of_a_single_is_the_last_time() {
        assert_eq!(
            current_window(&[9_000.0, 11_000.0], StatKind::Single),
            11_000.0
        );
        assert!(current_window(&[], StatKind::Single).is_nan());
    }

    #[test]
    fn window_at_each_is_nan_until_it_fills() {
        let times = [10_000.0, 10_200.0, 10_400.0, 10_600.0, 10_800.0];
        let ao5 = window_at_each(&times, StatKind::Ao5);
        assert_eq!(ao5.len(), 5);
        assert!(ao5[..4].iter().all(|value| value.is_nan()));
        assert_eq!(ao5[4], (10_200.0 + 10_400.0 + 10_600.0) / 3.0);
    }

    #[test]
    fn window_at_each_agrees_with_current_window_on_every_prefix() {
        // The property that makes the columns trustworthy: the value beside a
        // solve is exactly what the strip would have shown when that solve
        // was the newest — including a DNF sitting inside the window.
        let times = [
            10_000.0, 10_200.0, 10_400.0, 10_600.0, 10_800.0, INF, 11_200.0, 11_400.0, 11_600.0,
            11_800.0,
        ];
        for kind in [StatKind::Ao5, StatKind::Ao12] {
            let per_solve = window_at_each(&times, kind);
            assert_eq!(per_solve.len(), times.len());
            for (index, value) in per_solve.iter().enumerate() {
                let prefix = current_window(&times[..=index], kind);
                if prefix.is_nan() {
                    assert!(value.is_nan(), "{kind:?} row {index}");
                } else {
                    assert_eq!(*value, prefix, "{kind:?} row {index}");
                }
            }
        }
    }

    #[test]
    fn window_at_each_poisons_only_the_rows_inside_the_dnfs() {
        let times: Vec<f64> = (0..13).map(|i| 10_000.0 + i as f64 * 100.0).collect();
        let ao12 = window_at_each(&times, StatKind::Ao12);
        assert!(ao12[..11].iter().all(|value| value.is_nan()));
        assert_eq!(ao12[12], current_window(&times, StatKind::Ao12));

        // Two DNFs in the last five: ∞ survives trimming, so *that* row's
        // ao5 is a DNF — the rows before it are untouched.
        let dnfed = [10_000.0, 10_200.0, INF, INF, 10_400.0];
        let ao5 = window_at_each(&dnfed, StatKind::Ao5);
        assert_eq!(ao5[4], INF);
        assert!(ao5[1].is_nan()); // only two solves in: no window yet
    }

    #[test]
    fn window_at_each_of_an_empty_session_is_empty() {
        assert!(window_at_each(&[], StatKind::Ao5).is_empty());
        assert_eq!(
            window_at_each(&[9_000.0, 11_000.0], StatKind::Single),
            vec![9_000.0, 11_000.0]
        );
    }

    #[test]
    fn best_window_finds_the_smallest_completed_window() {
        let times = [
            12_000.0, 12_000.0, 12_000.0, 12_000.0, 10_000.0, 10_000.0, 10_000.0, 10_000.0,
            10_000.0,
        ];
        // w0 = [12,12,12,12,10] → trim → 12000; each window gains a 10.00
        // until w3 = [12,10,10,10,10] → (10+10+10)/3 = 10000 (ends at index
        // 7); w4 ties it, and only a strictly smaller value replaces the best.
        assert_eq!(
            best_window(&times, StatKind::Ao5),
            Some(BestWindow {
                value: 10_000.0,
                end_index: 7,
            })
        );
    }

    #[test]
    fn best_window_ignores_dnf_windows_while_a_finite_one_exists() {
        assert_eq!(
            best_window(&[INF, INF, 10_000.0, 10_200.0, 10_400.0], StatKind::Ao5),
            Some(BestWindow {
                value: INF,
                end_index: 4,
            })
        );
        let with_finite = [
            INF, 10_000.0, 10_200.0, 10_400.0, 12_000.0, 12_200.0, 12_400.0,
        ];
        // w0 = [∞,10.00,10.20,10.40,12.00] → drop 10.00 and ∞
        assert_eq!(
            best_window(&with_finite, StatKind::Ao5),
            Some(BestWindow {
                value: (10_200.0 + 10_400.0 + 12_000.0) / 3.0,
                end_index: 4,
            })
        );
    }

    #[test]
    fn best_window_is_none_while_no_window_has_completed() {
        assert_eq!(best_window(&[10_000.0, 10_200.0], StatKind::Ao5), None);
        assert_eq!(best_window(&[], StatKind::Single), None);
    }

    #[test]
    fn best_window_of_a_single_excludes_dnfs_but_keeps_the_earliest_dnf() {
        assert_eq!(
            best_window(&[12_000.0, 9_800.0, INF], StatKind::Single),
            Some(BestWindow {
                value: 9_800.0,
                end_index: 1,
            })
        );
        // Both are DNF, so the first one stands.
        assert_eq!(
            best_window(&[INF, INF], StatKind::Single),
            Some(BestWindow {
                value: INF,
                end_index: 0,
            })
        );
    }

    #[test]
    fn the_best_single_ignores_dnfs() {
        assert_eq!(best_single(&[12_000.0, 9_800.0, INF]), Some(9_800.0));
        assert_eq!(best_single(&[INF]), None);
        assert_eq!(best_single(&[]), None);
    }

    #[test]
    fn the_session_mean_covers_non_dnf_solves_only() {
        let mean = session_mean(&[10_000.0, 12_000.0, INF]);
        assert_eq!(mean.mean, 11_000.0);
        assert_eq!(mean.dnf_count, 1);
        assert_eq!(mean.count, 2);
    }

    #[test]
    fn an_all_dnf_session_has_no_mean() {
        let mean = session_mean(&[INF, INF]);
        assert!(mean.mean.is_nan());
        assert_eq!(mean.dnf_count, 2);
        assert_eq!(mean.count, 0);
    }

    #[test]
    fn an_empty_session_has_no_mean_either() {
        let mean = session_mean(&[]);
        assert!(mean.mean.is_nan());
        assert_eq!(mean.dnf_count, 0);
        assert_eq!(mean.count, 0);
    }

    #[test]
    fn pb_target_is_none_before_the_record_can_exist() {
        assert_eq!(pb_target(&[], StatKind::Ao5), PbTarget::None);
        assert_eq!(
            pb_target(&[10_000.0], StatKind::Single),
            PbTarget::Value(9_990.0)
        );
        assert_eq!(
            pb_target(&[10_000.0, 10_000.0], StatKind::Mo3),
            PbTarget::None
        );
        assert_eq!(pb_target(&[10_000.0], StatKind::Ao5), PbTarget::None);
    }

    #[test]
    fn pb_target_for_a_single_is_one_tick_faster() {
        assert_eq!(
            pb_target(&[12_340.0, 9_800.0], StatKind::Single),
            PbTarget::Value(9_790.0)
        );
        assert_eq!(pb_target(&[0.0], StatKind::Single), PbTarget::Never);
        assert_eq!(pb_target(&[INF, INF], StatKind::Single), PbTarget::Always);
    }

    #[test]
    fn pb_target_for_mo3_is_the_slowest_time_that_still_beats_the_best() {
        // (10.00 + 10.00 + x) / 3 < 10.00 → x < 10.00 → 9.99 at the tick
        assert_eq!(
            pb_target(&[10_000.0, 10_000.0, 10_000.0], StatKind::Mo3),
            PbTarget::Value(9_990.0)
        );
    }

    #[test]
    fn pb_target_for_mo3_cannot_recover_a_dnf_in_the_window() {
        assert_eq!(
            pb_target(&[10_000.0, 10_000.0, INF], StatKind::Mo3),
            PbTarget::Never
        );
    }

    #[test]
    fn pb_target_for_ao5_is_the_slowest_next_solve_that_still_wins() {
        // Best window (the only one): [10.40, 10.00, 10.10, 10.20, 10.30]
        //   sorted → drop 10.00 and 10.40 → 10.20
        // Next window keeps [10.00, 10.10, 10.20, 10.30]; the middle three of
        // the combined window sum to < 30.60 s exactly while x ≤ 10.29, so
        // the target is the largest tick below the boundary.
        let times = [10_400.0, 10_000.0, 10_100.0, 10_200.0, 10_300.0];
        assert_eq!(pb_target(&times, StatKind::Ao5), PbTarget::Value(10_290.0));
    }

    #[test]
    fn pb_target_is_never_when_the_kept_solves_already_floor_the_average() {
        // Four 10.00s in the window: any x leaves three 10.00s in the middle.
        assert_eq!(
            pb_target(
                &[10_000.0, 10_000.0, 10_000.0, 10_000.0, 10_000.0],
                StatKind::Ao5
            ),
            PbTarget::Never
        );
    }

    #[test]
    fn pb_target_is_always_when_every_completed_average_is_a_dnf() {
        assert_eq!(
            pb_target(&[INF, INF, 10_000.0, 10_000.0, 10_000.0], StatKind::Ao5),
            PbTarget::Always
        );
    }

    #[test]
    fn pb_target_holds_the_same_boundary_rule_at_twelve_solves() {
        // Only one window: [10.40, 10.00, 10.10, 10.20, 10.30] + 7×10.00
        // sorted: 8×10.00, 10.10, 10.20, 10.30, 10.40 → 100.60/10 = 10.06
        let mut times = vec![10_400.0, 10_000.0, 10_100.0, 10_200.0, 10_300.0];
        times.extend(std::iter::repeat_n(10_000.0, 7));
        assert_eq!(current_window(&times, StatKind::Ao12), 10_060.0);
        // With x = 10.29: 100.59/10 = 10.059 < 10.06 ✓; x = 10.30 ties ✗
        assert_eq!(pb_target(&times, StatKind::Ao12), PbTarget::Value(10_290.0));
    }

    #[test]
    fn every_pb_target_satisfies_the_boundary_against_brute_force() {
        // The binary search must land on exactly the boundary a scan over
        // ticks would find: P(x) = "x still beats the best" holds for every
        // tick ≤ target and fails at target + 10.
        let seeds: [&[f64]; 6] = [
            &[10_400.0, 10_000.0, 10_100.0, 10_200.0, 10_300.0],
            &[
                12_000.0, 12_000.0, 12_000.0, 12_000.0, 10_000.0, 10_000.0, 10_000.0, 10_000.0,
                10_000.0,
            ],
            &[
                15_000.0, 9_000.0, 9_100.0, 9_200.0, 9_300.0, 9_400.0, 30_000.0, 10_500.0,
            ],
            &[
                10_000.0, 10_100.0, 10_200.0, 10_300.0, 10_400.0, 10_500.0, 10_600.0, 10_700.0,
                10_800.0, 10_900.0, 11_000.0, 11_100.0,
            ],
            &[
                20_000.0, 20_000.0, 20_000.0, 8_000.0, 8_100.0, 8_200.0, 8_300.0,
            ],
            &[
                9_990.0, 10_010.0, 10_000.0, 10_000.0, 10_000.0, 10_000.0, 10_000.0, 10_000.0,
            ],
        ];
        for times in seeds {
            for kind in [StatKind::Mo3, StatKind::Ao5, StatKind::Ao12] {
                let target = pb_target(times, kind);
                let PbTarget::Value(ms) = target else {
                    continue;
                };
                let best = best_window(times, kind).expect("completed window").value;
                let WindowSpec {
                    size,
                    trim_l,
                    trim_r,
                } = window_spec(kind);
                let kept = &times[times.len() - (size - 1)..];
                let mean_with = |x: f64| {
                    let mut values = kept.to_vec();
                    values.push(x);
                    mean_window(&values, trim_l, trim_r)
                };
                assert!(mean_with(ms) < best, "{kind:?} {times:?} @ {ms}");
                assert!(
                    mean_with(ms + 10.0) >= best,
                    "{kind:?} {times:?} @ {}",
                    ms + 10.0
                );
                assert_eq!(ms % 10.0, 0.0);
            }
        }
    }

    #[test]
    fn session_stats_assembles_every_figure() {
        let solves: Vec<Solve> = [10_000.0, 12_000.0, 9_000.0, 11_000.0, 13_000.0]
            .into_iter()
            .enumerate()
            .map(|(i, time_ms)| Solve {
                id: i as u64 + 1,
                penalty: if i == 1 { Some(Penalty::Dnf) } else { None },
                ..solve(time_ms, None)
            })
            .collect();

        let stats = session_stats(&solves);

        assert_eq!(
            stats.times,
            vec![10_000.0, INF, 9_000.0, 11_000.0, 13_000.0]
        );
        assert_eq!(stats.best_single_ms, Some(9_000.0));
        // ao5 over all five: drop 9.00 and ∞ → (10.00+11.00+13.00)/3
        assert_eq!(
            stats.current_for(StatKind::Ao5),
            (10_000.0 + 11_000.0 + 13_000.0) / 3.0
        );
        // mo3 is the last three, which happen to be all finite
        assert_eq!(
            stats.current_for(StatKind::Mo3),
            (9_000.0 + 11_000.0 + 13_000.0) / 3.0
        );
        assert_eq!(
            stats.mean.mean,
            (10_000.0 + 9_000.0 + 11_000.0 + 13_000.0) / 4.0
        );
        assert_eq!(stats.mean.dnf_count, 1);
        assert_eq!(stats.mean.count, 4);
        assert!(stats.best_for(StatKind::Ao5).is_some());
        assert_eq!(stats.target_for(StatKind::Single), PbTarget::Value(8_990.0));
    }

    #[test]
    fn session_stats_covers_the_long_windows_and_the_spread() {
        let solves: Vec<Solve> = (0..1001)
            .map(|i| Solve {
                id: i + 1,
                ..solve(10_000.0 + i as f64 * 10.0, None)
            })
            .collect();
        let stats = session_stats(&solves);
        for (index, kind) in STAT_KINDS.into_iter().enumerate() {
            assert_eq!(kind.index(), index);
        }
        assert_eq!(
            stats.current_for(StatKind::Ao1000),
            (10_020.0 + 19_990.0) / 2.0
        );
        assert!(stats.best_for(StatKind::Ao1000).is_some());
        assert_eq!(stats.spread.best, Some(10_000.0));
        assert_eq!(stats.spread.worst, Some(20_000.0));
        assert_eq!(stats.spread.count, 1001);
        let total: f64 = solves.iter().map(|solve| solve.time_ms).sum();
        assert_eq!(stats.total_ms, total);
    }

    #[test]
    fn the_long_windows_use_cstimer_trim() {
        assert_eq!(
            window_spec(StatKind::Ao50),
            WindowSpec {
                size: 50,
                trim_l: 1,
                trim_r: 1
            }
        );
        assert_eq!(
            window_spec(StatKind::Ao100),
            WindowSpec {
                size: 100,
                trim_l: 1,
                trim_r: 1
            }
        );
        assert_eq!(
            window_spec(StatKind::Ao1000),
            WindowSpec {
                size: 1000,
                trim_l: 1,
                trim_r: 1
            }
        );
    }

    #[test]
    fn one_dnf_is_trimmable_and_two_poison_an_ao50() {
        let mut one_dnf: Vec<f64> = (0..50).map(|i| 10_000.0 + i as f64 * 10.0).collect();
        one_dnf[7] = INF;
        let mut sorted = one_dnf.clone();
        sorted.sort_by(f64::total_cmp);
        let kept = &sorted[1..sorted.len() - 1];
        let expected: f64 = kept.iter().sum::<f64>() / kept.len() as f64;
        assert_eq!(current_window(&one_dnf, StatKind::Ao50), expected);

        let mut two_dnfs = one_dnf[..49].to_vec();
        two_dnfs.push(INF);
        assert_eq!(current_window(&two_dnfs, StatKind::Ao50), INF);
    }

    #[test]
    fn the_long_windows_agree_with_current_window_on_every_prefix() {
        let times: Vec<f64> = (0..160)
            .map(|i| {
                if i % 17 == 5 {
                    INF
                } else {
                    9_000.0 + ((i * 137) % 4_000) as f64
                }
            })
            .collect();
        for kind in [StatKind::Ao50, StatKind::Ao100] {
            let per_solve = window_at_each(&times, kind);
            for (index, value) in per_solve.iter().enumerate() {
                let prefix = current_window(&times[..=index], kind);
                if prefix.is_nan() {
                    assert!(value.is_nan());
                } else {
                    assert_eq!(*value, prefix);
                }
            }
        }
    }

    #[test]
    fn best_window_matches_the_plain_mean_window_scan() {
        // A deterministic pseudo-random session with occasional DNFs: enough
        // to cross the incremental sorted window against the reference sort.
        let mut seed: u64 = 12345;
        let mut next = || {
            seed = (seed * 1_103_515_245 + 12345) % 2_u64.pow(31);
            seed as f64 / 2_f64.powi(31)
        };
        let times: Vec<f64> = (0..260)
            .map(|_| {
                let value = 8_000.0 + (next() * 8_000.0).floor();
                if next() < 0.08 {
                    INF
                } else {
                    (value / 10.0).floor() * 10.0
                }
            })
            .collect();
        for kind in STAT_KINDS {
            let WindowSpec {
                size,
                trim_l,
                trim_r,
            } = window_spec(kind);
            let mut reference: Option<BestWindow> = None;
            for end in 0..times.len() {
                if kind != StatKind::Single && end + 1 < size {
                    continue;
                }
                let value = if kind == StatKind::Single {
                    times[end]
                } else {
                    mean_window(&times[end + 1 - size..=end], trim_l, trim_r)
                };
                if reference.is_none_or(|best| value < best.value) {
                    reference = Some(BestWindow {
                        value,
                        end_index: end,
                    });
                }
            }
            assert_eq!(best_window(&times, kind), reference, "{kind:?}");
        }
    }

    #[test]
    fn renders_a_1000_window_run_in_a_few_milliseconds() {
        // Not a benchmark, just a guard against reintroducing the O(n·k log k)
        // scan: 20 000 solves would take seconds with the old bestWindow and
        // is well under the looser bound here with the incremental window.
        let times: Vec<f64> = (0..20_000)
            .map(|i| 10_000.0 + ((i * 37) % 3_000) as f64)
            .collect();
        let started = std::time::Instant::now();
        let best = best_window(&times, StatKind::Ao1000);
        assert!(best.is_some());
        assert!(started.elapsed().as_millis() < 2_000);
    }

    #[test]
    fn spread_uses_finite_times_only_and_reports_the_population_sigma() {
        let result = spread(&[10_000.0, 12_000.0, 14_000.0, INF]);
        assert_eq!(result.best, Some(10_000.0));
        assert_eq!(result.worst, Some(14_000.0));
        assert_eq!(result.range, Some(4_000.0));
        // mean 12 000; deviations -2000, 0, 2000 → 8 000 000 / 3
        assert_eq!(result.sigma, (8_000_000.0_f64 / 3.0).sqrt());
        assert_eq!(result.count, 3);
    }

    #[test]
    fn spread_has_no_figures_when_every_solve_is_a_dnf() {
        let result = spread(&[INF, INF]);
        assert_eq!(result.best, None);
        assert_eq!(result.worst, None);
        assert_eq!(result.range, None);
        assert!(result.sigma.is_nan());
        assert_eq!(result.count, 0);
        assert!(spread(&[]).sigma.is_nan());
    }

    #[test]
    fn spread_is_zero_width_when_every_finite_time_is_the_same() {
        let result = spread(&[12_000.0, 12_000.0]);
        assert_eq!(result.best, Some(12_000.0));
        assert_eq!(result.worst, Some(12_000.0));
        assert_eq!(result.range, Some(0.0));
        assert_eq!(result.sigma, 0.0);
        assert_eq!(result.count, 2);
    }
}
