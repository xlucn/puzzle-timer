//! The statistics dialog: averages and records, then the charts.
//!
//! Everything on the page comes from `core` — `session_stats`, `activity`,
//! `pb_history`, `histogram`, `trend` — so the dialog only decides how the
//! numbers are arranged. Times are core-formatted; dates go through the
//! locale-aware formatter.

use gtk4 as gtk;
use gtk4::prelude::*;
use libadwaita as adw;
use libadwaita::prelude::*;

use crate::core::activity::{Activity, activity, heatmap};
use crate::core::charts::{Histogram, Trend, histogram, trend};
use crate::core::i18n::{MessageKey, Param, t, t0};
use crate::core::records::{PbRecord, pb_history};
use crate::core::session::Solve;
use crate::core::stats::{BestWindow, PbTarget, STAT_KINDS, SessionStats, StatKind, session_stats};
use crate::core::time::{format_average, format_solve, format_time, format_timestamp};

use super::App;

const DASH: &str = "—";

fn kind_label(kind: StatKind) -> String {
    t0(match kind {
        StatKind::Single => MessageKey::StatsSingle,
        StatKind::Mo3 => MessageKey::StatsMo3,
        StatKind::Ao5 => MessageKey::StatsAo5,
        StatKind::Ao12 => MessageKey::StatsAo12,
        StatKind::Ao50 => MessageKey::StatsAo50,
        StatKind::Ao100 => MessageKey::StatsAo100,
        StatKind::Ao1000 => MessageKey::StatsAo1000,
    })
}

fn target_text(target: PbTarget) -> String {
    match target {
        PbTarget::Value(ms) => format_time(ms, false),
        PbTarget::Always => t0(MessageKey::StatsAny),
        PbTarget::Never | PbTarget::None => DASH.to_string(),
    }
}

fn average_or_dash(value: f64) -> String {
    if value.is_nan() {
        DASH.to_string()
    } else {
        format_average(value)
    }
}

fn value_label(text: &str, dim: bool) -> gtk::Label {
    let mut classes = vec!["numeric"];
    if dim || text == DASH {
        classes.push("dim-label");
    }
    gtk::Label::builder()
        .label(text)
        .xalign(1.0)
        .hexpand(true)
        .css_classes(classes)
        .build()
}

fn heading_label(text: &str) -> gtk::Label {
    gtk::Label::builder()
        .label(text)
        .xalign(1.0)
        .hexpand(true)
        .css_classes(["caption", "dim-label"])
        .build()
}

fn group(title: MessageKey) -> adw::PreferencesGroup {
    adw::PreferencesGroup::builder().title(t0(title)).build()
}

fn row(title: &str, value: &str) -> adw::ActionRow {
    let row = adw::ActionRow::builder().title(title).build();
    let suffix = gtk::Label::builder()
        .label(value)
        .css_classes(["numeric", "dim-label"])
        .build();
    row.add_suffix(&suffix);
    row
}

fn plural_row(title: MessageKey, count: usize) -> adw::ActionRow {
    row(
        &t0(title),
        &t(
            MessageKey::StatsSolves,
            &[("count", Param::Number(count as f64))],
        ),
    )
}

fn averages_group(stats: &SessionStats, solves: &[Solve]) -> adw::PreferencesGroup {
    let grid = gtk::Grid::builder()
        .column_spacing(18)
        .row_spacing(6)
        .margin_top(8)
        .margin_bottom(8)
        .margin_start(12)
        .margin_end(12)
        .build();

    for (column, title) in ["", "Current", "Best", "Target"].iter().enumerate() {
        let widget: gtk::Widget = if title.is_empty() {
            gtk::Label::new(None).upcast()
        } else {
            heading_label(title).upcast()
        };
        grid.attach(&widget, column as i32, 0, 1, 1);
    }

    let last = solves.last();
    let mut row_index = 1;
    for kind in STAT_KINDS {
        let name = gtk::Label::builder()
            .label(kind_label(kind))
            .xalign(0.0)
            .css_classes(["dim-label"])
            .build();
        grid.attach(&name, 0, row_index, 1, 1);

        let current = if kind == StatKind::Single {
            last.map_or_else(
                || DASH.to_string(),
                |solve| format_solve(solve.time_ms, solve.penalty),
            )
        } else {
            average_or_dash(stats.current_for(kind))
        };
        grid.attach(&value_label(&current, false), 1, row_index, 1, 1);

        let best = stats
            .best_for(kind)
            .map_or_else(|| DASH.to_string(), |best| average_display(best, kind));
        grid.attach(&value_label(&best, true), 2, row_index, 1, 1);

        grid.attach(
            &value_label(&target_text(stats.target_for(kind)), true),
            3,
            row_index,
            1,
            1,
        );
        row_index += 1;
    }

    let mean = gtk::Label::builder()
        .label(t0(MessageKey::StatsMean))
        .xalign(0.0)
        .css_classes(["dim-label"])
        .build();
    grid.attach(&mean, 0, row_index, 1, 1);
    grid.attach(
        &value_label(&average_or_dash(stats.mean.mean), false),
        1,
        row_index,
        1,
        1,
    );

    let caption = if solves.is_empty() {
        t0(MessageKey::StatsEmpty)
    } else if stats.mean.dnf_count == 0 {
        t(
            MessageKey::StatsSolves,
            &[("count", Param::Number(solves.len() as f64))],
        )
    } else {
        format!(
            "{} · {}",
            t(
                MessageKey::StatsCounted,
                &[
                    ("count", Param::Number(stats.mean.count as f64)),
                    ("total", Param::Number(solves.len() as f64)),
                ],
            ),
            t(
                MessageKey::StatsDnf,
                &[("count", Param::Number(stats.mean.dnf_count as f64))],
            )
        )
    };

    let table = gtk::Box::new(gtk::Orientation::Vertical, 6);
    table.append(&grid);
    table.append(
        &gtk::Label::builder()
            .label(caption)
            .xalign(0.0)
            .margin_start(12)
            .margin_bottom(8)
            .css_classes(["caption", "dim-label"])
            .build(),
    );

    let group = group(MessageKey::StatsTabSummary);
    group.add(&table);
    group
}

fn average_display(best: BestWindow, kind: StatKind) -> String {
    if kind == StatKind::Single {
        format_average(best.value)
    } else {
        average_or_dash(best.value)
    }
}

fn overview_group(stats: &SessionStats, days: &Activity) -> adw::PreferencesGroup {
    let group = group(MessageKey::StatsActivityOverview);
    group.add(&row(
        &t0(MessageKey::StatsBest),
        &stats
            .best_single_ms
            .map_or_else(|| DASH.to_string(), format_average),
    ));
    group.add(&row(
        &t0(MessageKey::StatsTotalTime),
        &format_time(stats.total_ms, false),
    ));
    group.add(&row(&t0(MessageKey::StatsWorst), &days_total_worst(stats)));
    group.add(&row(
        &t0(MessageKey::StatsSpread),
        &stats
            .spread
            .range
            .map_or_else(|| DASH.to_string(), format_average),
    ));
    group.add(&row(
        &t0(MessageKey::StatsSigma),
        &if stats.spread.sigma.is_nan() {
            DASH.to_string()
        } else {
            format_average(stats.spread.sigma)
        },
    ));

    group.add(&plural_row(
        MessageKey::StatsActivityToday,
        days.today.count,
    ));
    group.add(&row(
        &t0(MessageKey::StatsActivityLast7),
        &format!("{} / {}", days.last7.solves, days.last7.active_days),
    ));
    group.add(&row(
        &t0(MessageKey::StatsActivityLast30),
        &format!("{} / {}", days.last30.solves, days.last30.active_days),
    ));
    group.add(&row(
        &t0(MessageKey::StatsActivityCurrentStreak),
        &format!("{}", days.current_streak),
    ));
    group.add(&row(
        &t0(MessageKey::StatsActivityLongestStreak),
        &format!("{}", days.longest_streak),
    ));
    group.add(&plural_row(
        MessageKey::StatsActivityActiveDays,
        days.active_days,
    ));
    if let Some(best_day) = &days.best_day {
        group.add(&row(
            &t0(MessageKey::StatsActivityBestDay),
            &format!("{} ({})", best_day.key, best_day.count),
        ));
    }
    if days.undated > 0 {
        group.add(&plural_row(MessageKey::StatsActivityUndated, days.undated));
    }
    group
}

fn days_total_worst(stats: &SessionStats) -> String {
    stats
        .spread
        .worst
        .map_or_else(|| DASH.to_string(), format_average)
}

fn records_group(solves: &[Solve], now: f64) -> adw::PreferencesGroup {
    let group = group(MessageKey::StatsRecordsGroup);
    let mut any = false;
    for kind in STAT_KINDS {
        let history = pb_history(solves, kind);
        let Some(record) = history.last() else {
            continue;
        };
        any = true;
        group.add(&record_row(record, kind, now));
    }
    if !any {
        group.add(&row(&t0(MessageKey::StatsRecordsNone), ""));
    }
    group
}

fn record_row(record: &PbRecord, kind: StatKind, now: f64) -> adw::ActionRow {
    let set = if record.set_at_ms > 0.0 {
        t(
            MessageKey::StatsRecordsSetDate,
            &[(
                "date",
                Param::Text(&format_timestamp(record.set_at_ms, now)),
            )],
        )
    } else {
        t(
            MessageKey::StatsRecordsSetSolve,
            &[("number", Param::Number(record.index as f64 + 1.0))],
        )
    };
    let row = adw::ActionRow::builder()
        .title(kind_label(kind))
        .subtitle(format!("{set} · {}", t0(MessageKey::StatsRecordsCurrent)))
        .build();
    row.add_suffix(
        &gtk::Label::builder()
            .label(average_or_dash(record.value))
            .css_classes(["numeric", "dim-label"])
            .build(),
    );
    row
}

fn chart_area(draw: impl Fn(&gtk::cairo::Context, i32, i32) + 'static) -> gtk::DrawingArea {
    let area = gtk::DrawingArea::builder()
        .height_request(220)
        .hexpand(true)
        .build();
    area.set_draw_func(move |area, cr, width, height| {
        let color = area.color();
        cr.set_source_rgba(
            color.red() as f64,
            color.green() as f64,
            color.blue() as f64,
            0.5,
        );
        draw(cr, width, height);
    });
    area
}

fn histogram_chart(chart: Option<Histogram>) -> gtk::Box {
    let box_ = gtk::Box::new(gtk::Orientation::Vertical, 6);
    let Some(chart) = chart else {
        box_.append(
            &gtk::Label::builder()
                .label(DASH)
                .css_classes(["dim-label"])
                .build(),
        );
        return box_;
    };
    let max_count = chart.bins.iter().map(|bin| bin.count).max().unwrap_or(1) as f64;
    let bins: Vec<(f64, usize)> = chart
        .bins
        .iter()
        .map(|bin| (bin.start_ms, bin.count))
        .collect();
    let area = chart_area(move |cr, width, height| {
        let count = bins.len() as f64;
        if count == 0.0 || max_count == 0.0 {
            return;
        }
        let slot = width as f64 / count;
        let bar = (slot - 2.0).max(1.0);
        for (index, (_, value)) in bins.iter().enumerate() {
            let bar_height = (*value as f64 / max_count) * (height as f64 - 24.0);
            let x = index as f64 * slot + 1.0;
            let y = height as f64 - 4.0 - bar_height;
            cr.rectangle(x, y, bar, bar_height);
            cr.fill().expect("fill");
        }
    });
    let first = chart.bins.first().map(|bin| bin.start_ms).unwrap_or(0.0);
    let last = chart.bins.last().map(|bin| bin.end_ms).unwrap_or(0.0);
    let axis = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    axis.append(
        &gtk::Label::builder()
            .label(format_time(first, false))
            .xalign(0.0)
            .hexpand(true)
            .css_classes(["caption", "dim-label"])
            .build(),
    );
    axis.append(
        &gtk::Label::builder()
            .label(format_time(last, false))
            .xalign(1.0)
            .hexpand(true)
            .css_classes(["caption", "dim-label"])
            .build(),
    );
    box_.append(&area);
    box_.append(&axis);
    box_
}

fn trend_chart(chart: Option<Trend>) -> gtk::Box {
    let box_ = gtk::Box::new(gtk::Orientation::Vertical, 6);
    let Some(chart) = chart else {
        box_.append(
            &gtk::Label::builder()
                .label(DASH)
                .css_classes(["dim-label"])
                .build(),
        );
        return box_;
    };
    let series: Vec<Vec<(f64, f64)>> = chart
        .series
        .iter()
        .map(|series| {
            series
                .points
                .iter()
                .map(|point| (point.x, point.y))
                .collect()
        })
        .collect();
    let area = chart_area(move |cr, width, height| {
        for (index, points) in series.iter().enumerate() {
            if points.is_empty() {
                continue;
            }
            if index == 0 {
                cr.set_line_width(1.0);
            } else {
                cr.set_line_width(2.0);
            }
            for (i, (x, y)) in points.iter().enumerate() {
                let px = *x * (width as f64 - 8.0) + 4.0;
                let py = (1.0 - *y) * (height as f64 - 8.0) + 4.0;
                if i == 0 {
                    cr.move_to(px, py);
                } else {
                    cr.line_to(px, py);
                }
            }
            cr.stroke().expect("stroke");
        }
    });
    let legend = gtk::Box::new(gtk::Orientation::Horizontal, 18);
    for kind in [StatKind::Single, StatKind::Ao5, StatKind::Ao12] {
        legend.append(
            &gtk::Label::builder()
                .label(kind_label(kind))
                .css_classes(["caption", "dim-label"])
                .build(),
        );
    }
    box_.append(&area);
    box_.append(&legend);
    box_
}

fn heatmap_chart(days: &Activity, now: f64) -> gtk::Box {
    let map = heatmap(days, now, 20);
    let levels: Vec<Vec<(u8, bool)>> = map
        .weeks
        .iter()
        .map(|week| {
            week.iter()
                .map(|cell| (cell.level, cell.in_range))
                .collect()
        })
        .collect();
    let area = chart_area(move |cr, width, height| {
        let columns = levels.len() as f64;
        if columns == 0.0 {
            return;
        }
        let cell = (width as f64 / columns).min(height as f64 / 7.0);
        for (column, week) in levels.iter().enumerate() {
            for (row, (level, in_range)) in week.iter().enumerate() {
                if !in_range {
                    continue;
                }
                let alpha = match level {
                    0 => 0.08,
                    1 => 0.25,
                    2 => 0.45,
                    3 => 0.7,
                    _ => 1.0,
                };
                cr.set_source_rgba(
                    0.2,
                    0.5,
                    0.9,
                    f64::from(*level) * 0.2 + if *level == 0 { 0.06 } else { 0.15 },
                );
                let _ = alpha;
                cr.rectangle(
                    column as f64 * cell + 1.0,
                    row as f64 * cell + 1.0,
                    cell - 2.0,
                    cell - 2.0,
                );
                cr.fill().expect("fill");
            }
        }
    });
    let wrapper = gtk::Box::new(gtk::Orientation::Vertical, 6);
    wrapper.append(&area);
    wrapper.append(
        &gtk::Label::builder()
            .label(map.max_count.to_string())
            .xalign(0.0)
            .css_classes(["caption", "dim-label"])
            .build(),
    );
    wrapper
}

pub fn open(parent: &impl IsA<gtk::Widget>, app: &App) {
    let session = app.state.active_session();
    let solves = session.borrow().solves().to_vec();
    let now = super::wall_now_ms();
    let stats = session_stats(&solves);
    let days = activity(&solves, now);

    let dialog = adw::Dialog::builder()
        .title(t0(MessageKey::StatsTitle))
        .content_width(680)
        .content_height(720)
        .build();

    let stack = gtk::Stack::builder()
        .transition_type(gtk::StackTransitionType::Crossfade)
        .vexpand(true)
        .build();
    let switcher = gtk::StackSwitcher::builder().stack(&stack).build();
    let header = adw::HeaderBar::new();
    header.set_title_widget(Some(&switcher));

    // ---- summary -----------------------------------------------------------
    let summary = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(18)
        .margin_top(12)
        .margin_bottom(18)
        .margin_start(18)
        .margin_end(18)
        .build();
    summary.append(&averages_group(&stats, &solves));
    summary.append(&overview_group(&stats, &days));
    summary.append(&records_group(&solves, now));

    let summary_scroll = gtk::ScrolledWindow::builder()
        .child(&summary)
        .hscrollbar_policy(gtk::PolicyType::Never)
        .vexpand(true)
        .build();
    stack.add_titled(
        &summary_scroll,
        Some("summary"),
        &t0(MessageKey::StatsTabSummary),
    );

    // ---- charts ------------------------------------------------------------
    let charts = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(18)
        .margin_top(12)
        .margin_bottom(18)
        .margin_start(18)
        .margin_end(18)
        .build();

    let distribution = group(MessageKey::StatsChartsDistribution);
    distribution.add(&histogram_chart(histogram(&stats.times)));
    charts.append(&distribution);

    let trend_group = group(MessageKey::StatsChartsTrend);
    trend_group.add(&trend_chart(trend(&stats.times)));
    charts.append(&trend_group);

    let recent = group(MessageKey::StatsActivityRecent);
    recent.add(&heatmap_chart(&days, now));
    charts.append(&recent);

    let charts_scroll = gtk::ScrolledWindow::builder()
        .child(&charts)
        .hscrollbar_policy(gtk::PolicyType::Never)
        .vexpand(true)
        .build();
    stack.add_titled(
        &charts_scroll,
        Some("charts"),
        &t0(MessageKey::StatsTabCharts),
    );

    let toolbar = adw::ToolbarView::new();
    toolbar.add_top_bar(&header);
    toolbar.set_content(Some(&stack));
    dialog.set_child(Some(&toolbar));

    dialog.present(Some(parent));
}
