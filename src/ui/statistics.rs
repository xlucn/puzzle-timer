//! The statistics dialog: averages and records, then the charts.
//!
//! Everything on the page comes from `core` — `session_stats`, `activity`,
//! `pb_history`, `histogram`, `trend` — so the dialog only decides how the
//! numbers are arranged. Times are core-formatted; dates go through the
//! platform formatter, which is where the month names live.
//!
//! The tab strip sits in the header while there is room and moves to a bottom
//! bar with the dialog's own title above it when the dialog is squeezed.

use gtk4 as gtk;
use gtk4::prelude::*;
use libadwaita as adw;
use libadwaita::prelude::*;

use crate::core::activity::{Activity, activity, heatmap};
use crate::core::charts::{histogram, trend};
use crate::core::i18n::{MessageKey, Param, t, t0};
use crate::core::records::{PbRecord, held_days, held_solves, pb_history};
use crate::core::session::{Session, Solve};
use crate::core::stats::{PbTarget, STAT_KINDS, SessionStats, StatKind, session_stats};
use crate::core::time::{format_average, format_solve, format_time};
use crate::platform::date::{format_date, format_month, format_weekday};

use super::App;
use super::charts::{histogram_chart, trend_chart};

const DASH: &str = "—";

/// A quarter of weeks fits the dialog without horizontal scrolling.
const HEATMAP_WEEKS: usize = 13;

/// A history is a list of rows built lazily on the first expand and capped: a
/// beginner can set a PB on every one of thousands of solves, and building all
/// of those rows in a dialog would be the same mistake as putting the solve
/// list in a `ListBox`.
const HISTORY_LIMIT: usize = 250;

/// The history entries start this far above the total when the whole list
/// would be longer than the cap.
const fn history_start(len: usize) -> usize {
    len.saturating_sub(HISTORY_LIMIT)
}

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

/// The classes a value cell carries: plain for a label, semibold tabular for a
/// number, dim for a dash.
fn value_classes(text: &str) -> Vec<&'static str> {
    if text.is_empty() {
        Vec::new()
    } else if text == DASH {
        vec!["stats-cell", "incomplete"]
    } else {
        vec!["stats-cell", "numeric"]
    }
}

/// `Set 14 Mar 2025` / `Set at #143`, plus how long the record was held.
fn record_status(record: &PbRecord, next: Option<&PbRecord>, total: usize) -> String {
    let set = if record.set_at_ms > 0.0 {
        t(
            MessageKey::StatsRecordsSetDate,
            &[("date", Param::Text(&format_date(record.set_at_ms)))],
        )
    } else {
        t(
            MessageKey::StatsRecordsSetSolve,
            &[("number", Param::Number(record.index as f64 + 1.0))],
        )
    };

    let Some(next) = next else {
        return format!("{set} · {}", t0(MessageKey::StatsRecordsCurrent));
    };

    let held = match held_days(record) {
        None => t(
            MessageKey::StatsRecordsHeldSolves,
            &[(
                "count",
                Param::Number(held_solves(record, total, Some(next)) as f64),
            )],
        ),
        Some(0) => t0(MessageKey::StatsRecordsHeldSameDay),
        Some(days) => t(
            MessageKey::StatsRecordsHeldDays,
            &[("count", Param::Number(days as f64))],
        ),
    };
    format!("{set} · {held}")
}

fn row(title: &str, value: &str) -> adw::ActionRow {
    let action = adw::ActionRow::builder().title(title).build();
    action.set_use_markup(false);
    action.set_activatable(false);
    let suffix = gtk::Label::builder()
        .label(value)
        .css_classes(if value == DASH {
            vec!["dim-label"]
        } else {
            vec!["numeric"]
        })
        .build();
    action.add_suffix(&suffix);
    action
}

fn plural(key: MessageKey, count: usize) -> String {
    t(key, &[("count", Param::Number(count as f64))])
}

// ---- summary ---------------------------------------------------------------

fn averages_group(stats: &SessionStats, solves: &[Solve]) -> adw::PreferencesGroup {
    let total = solves.len();
    let last = solves.last();

    // Label and value per row, then the mean row: a `StringList` carries the
    // labels and each cell reads its value by position, so no custom GObject
    // subtype is needed.
    let mut rows: Vec<(String, [String; 3])> = Vec::with_capacity(STAT_KINDS.len() + 1);
    for kind in STAT_KINDS {
        let current = if kind == StatKind::Single {
            last.map_or_else(
                || DASH.to_string(),
                |solve| format_solve(solve.time_ms, solve.penalty),
            )
        } else {
            average_or_dash(stats.current_for(kind))
        };
        let best = stats
            .best_for(kind)
            .map_or_else(|| DASH.to_string(), |best| format_average(best.value));
        rows.push((
            kind_label(kind),
            [current, best, target_text(stats.target_for(kind))],
        ));
    }
    let mean_value = if total == 0 {
        DASH.to_string()
    } else {
        format_average(stats.mean.mean)
    };
    rows.push((
        t0(MessageKey::StatsMean),
        [mean_value, String::new(), String::new()],
    ));

    let labels: Vec<&str> = rows.iter().map(|(label, _)| label.as_str()).collect();
    let model = gtk::StringList::new(&labels);
    let view = gtk::ColumnView::new(Some(gtk::NoSelection::new(Some(model))));
    view.set_show_row_separators(true);
    view.set_hexpand(true);
    view.set_vexpand(false);
    view.set_valign(gtk::Align::Start);

    let make_column = |title: &str, index: Option<usize>| {
        let factory = gtk::SignalListItemFactory::new();
        {
            let rows = rows.clone();
            factory.connect_setup(move |_, item| {
                let Some(item) = item.downcast_ref::<gtk::ListItem>() else {
                    return;
                };
                let label = gtk::Label::builder().xalign(0.0).hexpand(true).build();
                item.set_child(Some(&label));
                let _ = &rows;
            });
        }
        {
            let rows = rows.clone();
            factory.connect_bind(move |_, item| {
                let Some(item) = item.downcast_ref::<gtk::ListItem>() else {
                    return;
                };
                let Some(label) = item.child().and_downcast::<gtk::Label>() else {
                    return;
                };
                let position = item.position() as usize;
                let Some(entry) = rows.get(position) else {
                    return;
                };
                let (text, classes) = match index {
                    None => (entry.0.clone(), Vec::new()),
                    Some(index) => {
                        let text = entry.1[index].clone();
                        let classes = value_classes(&text);
                        (text, classes)
                    }
                };
                label.set_label(&text);
                label.set_css_classes(&classes);
            });
        }
        factory.connect_teardown(|_, item| {
            if let Some(item) = item.downcast_ref::<gtk::ListItem>() {
                item.set_child(gtk::Widget::NONE);
            }
        });

        let column = gtk::ColumnViewColumn::new(Some(title), Some(factory));
        column.set_resizable(false);
        // The kind column keeps its content width; the three value columns
        // share the rest, so the table reaches both sides of the dialog.
        column.set_expand(index.is_some());
        column
    };

    view.append_column(&make_column("", None));
    view.append_column(&make_column(&t0(MessageKey::StatsCurrent), Some(0)));
    view.append_column(&make_column(&t0(MessageKey::StatsBest), Some(1)));
    view.append_column(&make_column(&t0(MessageKey::StatsTarget), Some(2)));

    let caption = if total == 0 {
        t0(MessageKey::StatsEmpty)
    } else if stats.mean.dnf_count == 0 {
        plural(MessageKey::StatsSolves, total)
    } else {
        format!(
            "{} · {}",
            t(
                MessageKey::StatsCounted,
                &[
                    ("count", Param::Number(stats.mean.count as f64)),
                    ("total", Param::Number(total as f64)),
                ],
            ),
            plural(MessageKey::StatsDnf, stats.mean.dnf_count),
        )
    };

    let table = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(6)
        .margin_start(12)
        .margin_end(12)
        .margin_top(12)
        .margin_bottom(12)
        .build();
    table.append(&view);
    table.append(
        &gtk::Label::builder()
            .label(&caption)
            .xalign(0.0)
            .css_classes(["caption", "dim-label"])
            .build(),
    );

    let group = adw::PreferencesGroup::builder()
        .title(t0(MessageKey::StatsTabSummary))
        .build();
    let wrapper = gtk::ListBoxRow::builder()
        .child(&table)
        .selectable(false)
        .activatable(false)
        .build();
    group.add(&wrapper);
    group
}

/// The label/value overview rows, a card of their own on the Summary tab.
fn overview_group(stats: &SessionStats, days: &Activity, total: usize) -> adw::PreferencesGroup {
    let group = adw::PreferencesGroup::builder()
        .title(t0(MessageKey::StatsActivityOverview))
        .build();

    group.add(&row(
        &t0(MessageKey::StatsActivityTotalSolves),
        &days.total_solves.to_string(),
    ));
    group.add(&row(
        &t0(MessageKey::StatsTotalTime),
        &if total == 0 {
            DASH.to_string()
        } else {
            format_time(stats.total_ms, false)
        },
    ));
    group.add(&row(
        &t0(MessageKey::StatsActivityToday),
        &format!(
            "{} · {}",
            plural(MessageKey::StatsSolves, days.today.count),
            format_time(days.today.total_ms, false)
        ),
    ));
    group.add(&row(
        &t0(MessageKey::StatsActivityLast7),
        &format!(
            "{} · {}",
            plural(MessageKey::StatsSolves, days.last7.solves),
            plural(MessageKey::StatsActivityActiveCount, days.last7.active_days)
        ),
    ));
    group.add(&row(
        &t0(MessageKey::StatsActivityLast30),
        &format!(
            "{} · {}",
            plural(MessageKey::StatsSolves, days.last30.solves),
            plural(
                MessageKey::StatsActivityActiveCount,
                days.last30.active_days
            )
        ),
    ));
    group.add(&row(
        &t0(MessageKey::StatsActivityCurrentStreak),
        &plural(MessageKey::StatsActivityDays, days.current_streak),
    ));
    group.add(&row(
        &t0(MessageKey::StatsActivityLongestStreak),
        &plural(MessageKey::StatsActivityDays, days.longest_streak),
    ));
    group.add(&row(
        &t0(MessageKey::StatsActivityActiveDays),
        &days.active_days.to_string(),
    ));
    group.add(&row(
        &t0(MessageKey::StatsActivityPerDay),
        &format!("{}", (days.per_active_day * 10.0).round() / 10.0),
    ));
    group.add(&row(
        &t0(MessageKey::StatsActivityBestDay),
        &days.best_day.as_ref().map_or_else(
            || DASH.to_string(),
            |best| {
                format!(
                    "{} · {}",
                    plural(MessageKey::StatsSolves, best.count),
                    format_date(best.start_ms)
                )
            },
        ),
    ));
    if days.undated > 0 {
        group.add(&row(
            &t0(MessageKey::StatsActivityUndated),
            &days.undated.to_string(),
        ));
    }
    group
}

fn records_group(solves: &[Solve]) -> adw::PreferencesGroup {
    let total = solves.len();
    let group = adw::PreferencesGroup::builder()
        .title(t0(MessageKey::StatsRecordsGroup))
        .description(t0(MessageKey::StatsRecordsDescription))
        .build();

    for kind in STAT_KINDS {
        let history = pb_history(solves, kind);
        let current = history.last();

        let action = adw::ExpanderRow::builder()
            .title(kind_label(kind))
            .subtitle(current.map_or_else(
                || t0(MessageKey::StatsRecordsNone),
                |record| record_status(record, None, total),
            ))
            .enable_expansion(history.len() > 1)
            .build();
        action.set_use_markup(false);
        action.add_suffix(
            &gtk::Label::builder()
                .label(
                    current.map_or_else(|| DASH.to_string(), |record| format_average(record.value)),
                )
                .css_classes(if current.is_none() {
                    vec!["dim-label"]
                } else {
                    vec!["numeric"]
                })
                .build(),
        );

        if history.len() > 1 {
            // Built on the first expand, then left alone: a history can be
            // thousands of rows long.
            let populated = std::rc::Rc::new(std::cell::Cell::new(false));
            let action_ = action.clone();
            let history = history.clone();
            action.connect_expanded_notify(move |row| {
                if populated.get() || !row.is_expanded() {
                    return;
                }
                populated.set(true);
                let first = history_start(history.len());
                // Newest first: the current PB leads the list.
                for index in (first..history.len()).rev() {
                    let record = &history[index];
                    let next = history.get(index + 1);
                    let entry = adw::ActionRow::builder()
                        .title(format_average(record.value))
                        .subtitle(record_status(record, next, total))
                        .activatable(false)
                        .build();
                    entry.set_use_markup(false);
                    entry.add_suffix(
                        &gtk::Label::builder()
                            .label(format!("#{}", record.index + 1))
                            .css_classes(["numeric", "dim-label"])
                            .build(),
                    );
                    action_.add_row(&entry);
                }
                if first > 0 {
                    action_.add_row(
                        &adw::ActionRow::builder()
                            .title(plural(MessageKey::StatsRecordsOlder, first))
                            .activatable(false)
                            .css_classes(["dim-label"])
                            .build(),
                    );
                }
            });
        }

        group.add(&action);
    }
    group
}

// ---- charts ----------------------------------------------------------------

fn chart_section(title: MessageKey, chart: gtk::Widget) -> adw::PreferencesGroup {
    let row = gtk::ListBoxRow::builder()
        .selectable(false)
        .activatable(false)
        .build();
    let body = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .margin_start(12)
        .margin_end(12)
        .margin_top(12)
        .margin_bottom(12)
        .build();
    body.append(&chart);
    row.set_child(Some(&body));
    let group = adw::PreferencesGroup::builder().title(t0(title)).build();
    group.add(&row);
    group
}

/// The calendar heat map, or `None` when no solve carries a date.
fn heatmap_section(days: &Activity, now: f64) -> Option<adw::PreferencesGroup> {
    if days.days.is_empty() {
        return None;
    }

    // An empty session has no quarter to show; once there is any dated
    // activity, the empty days become the gaps that make a streak legible.
    let map = heatmap(days, now, HEATMAP_WEEKS);
    let grid = gtk::Grid::builder()
        .column_spacing(3)
        .row_spacing(3)
        .hexpand(true)
        .build();

    // Row 0 carries month names, rows 1..7 the Monday-first weekday labels on
    // the left and one cell per day. A month label spans every week of its
    // month: a one-column label is wider than a 14 px cell and would stretch
    // that column.
    let mut month_starts: Vec<usize> = Vec::new();
    let mut previous_month = -1;
    for (column, week) in map.weeks.iter().enumerate() {
        let month = crate::core::calendar::civil_time(week[0].start_ms as f64).month as i32;
        if column == 0 || month != previous_month {
            month_starts.push(column);
        }
        previous_month = month;
    }
    for (index, start) in month_starts.iter().enumerate() {
        let end = month_starts
            .get(index + 1)
            .copied()
            .unwrap_or(map.weeks.len());
        let span = end - start;
        // A one-week tail cannot absorb the label without widening its cell.
        if span < 2 {
            continue;
        }
        grid.attach(
            &gtk::Label::builder()
                .label(format_month(map.weeks[*start][0].start_ms as f64))
                .xalign(0.0)
                .css_classes(["caption", "dim-label"])
                .build(),
            (*start + 1) as i32,
            0,
            span as i32,
            1,
        );
    }

    let mut cells: Vec<gtk::Box> = Vec::with_capacity(map.weeks.len() * 7);
    for (column, week) in map.weeks.iter().enumerate() {
        for (day, cell) in week.iter().enumerate() {
            let level = if cell.in_range { cell.level } else { 0 };
            let mut classes = vec!["heatmap-cell".to_string(), format!("level-{level}")];
            if !cell.in_range {
                classes.push("future".to_string());
            }
            let class_refs: Vec<&str> = classes.iter().map(String::as_str).collect();
            let square = gtk::Box::builder()
                .hexpand(true)
                .vexpand(true)
                .halign(gtk::Align::Fill)
                .valign(gtk::Align::Fill)
                .css_classes(class_refs)
                .build();
            if cell.in_range {
                let date = format_date(cell.start_ms as f64);
                let tooltip = if cell.count == 0 {
                    format!("{date} · {}", t0(MessageKey::StatsActivityNoSolves))
                } else {
                    format!("{date} · {}", plural(MessageKey::StatsSolves, cell.count))
                };
                square.set_tooltip_text(Some(&tooltip));
            }
            cells.push(square.clone());
            grid.attach(&square, (column + 1) as i32, (day + 1) as i32, 1, 1);
        }
    }

    for day in [0usize, 2, 4] {
        grid.attach(
            &gtk::Label::builder()
                .label(format_weekday(map.weeks[0][day].start_ms as f64))
                .xalign(1.0)
                .margin_end(3)
                .css_classes(["caption", "dim-label"])
                .build(),
            0,
            (day + 1) as i32,
            1,
            1,
        );
    }

    // A day cell grows into the width it is given instead of leaving the extra
    // space between columns. The size comes from the allocated grid: the week
    // cells share the width left by the weekday rail and the gaps.
    let cell_size = std::rc::Rc::new(std::cell::Cell::new(0));
    {
        let grid = grid.clone();
        let cells = cells.clone();
        let cell_size = std::rc::Rc::clone(&cell_size);
        grid.connect_map(move |grid| {
            fit_cells(grid, &cells, &cell_size);
        });
    }
    {
        let grid = grid.clone();
        let cells = cells.clone();
        let cell_size = std::rc::Rc::clone(&cell_size);
        grid.connect_notify_local(Some("width"), move |grid, _| {
            fit_cells(grid, &cells, &cell_size);
        });
    }

    let legend = gtk::Box::builder()
        .orientation(gtk::Orientation::Horizontal)
        .spacing(4)
        .halign(gtk::Align::Center)
        .margin_top(8)
        .build();
    legend.append(
        &gtk::Label::builder()
            .label(t0(MessageKey::StatsActivityLess))
            .css_classes(["caption", "dim-label"])
            .build(),
    );
    for level in 0..=4 {
        let class = format!("level-{level}");
        legend.append(
            &gtk::Box::builder()
                .width_request(11)
                .height_request(11)
                .valign(gtk::Align::Center)
                .css_classes(["heatmap-cell", class.as_str()])
                .build(),
        );
    }
    legend.append(
        &gtk::Label::builder()
            .label(t0(MessageKey::StatsActivityMore))
            .css_classes(["caption", "dim-label"])
            .build(),
    );

    let body = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .hexpand(true)
        .margin_start(12)
        .margin_end(12)
        .margin_top(12)
        .margin_bottom(12)
        .build();
    body.append(&grid);
    body.append(&legend);

    let heat_row = gtk::ListBoxRow::builder()
        .child(&body)
        .selectable(false)
        .activatable(false)
        .build();
    let group = adw::PreferencesGroup::builder()
        .title(t0(MessageKey::StatsActivityRecent))
        .build();
    group.add(&heat_row);
    Some(group)
}

fn fit_cells(grid: &gtk::Grid, cells: &[gtk::Box], cell_size: &std::cell::Cell<i32>) {
    let width = grid.width();
    if width <= 0 {
        return;
    }
    let label_width = grid.child_at(0, 1).map(|child| child.width()).unwrap_or(30);
    let gaps = (HEATMAP_WEEKS * 3) as i32;
    // The 4 px leaves room for the card's border/padding; without it the
    // final column can tip the dialog's natural width past its content width.
    let size = ((width - label_width - gaps - 4) / HEATMAP_WEEKS as i32).max(14);
    if size == cell_size.get() {
        return;
    }
    cell_size.set(size);
    for cell in cells {
        cell.set_size_request(size, size);
    }
}

// ---- dialog ----------------------------------------------------------------

fn scroll(child: &impl IsA<gtk::Widget>) -> gtk::ScrolledWindow {
    gtk::ScrolledWindow::builder()
        .vexpand(true)
        .hexpand(true)
        .hscrollbar_policy(gtk::PolicyType::Never)
        .vscrollbar_policy(gtk::PolicyType::Automatic)
        .child(child)
        .build()
}

pub fn open(parent: &impl IsA<gtk::Widget>, app: &App) {
    let session = app.state.active_session();
    let session = session.borrow();
    build(parent, &session)
}

fn build(parent: &impl IsA<gtk::Widget>, session: &Session) {
    let solves = session.solves();
    let now = super::wall_now_ms();
    let stats = session_stats(solves);
    let days = activity(solves, now);

    // ---- summary -----------------------------------------------------------
    let summary = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(18)
        .margin_start(24)
        .margin_end(24)
        .margin_bottom(18)
        .build();
    summary.append(&averages_group(&stats, solves));
    summary.append(&overview_group(&stats, &days, solves.len()));
    summary.append(&records_group(solves));

    // ---- charts ------------------------------------------------------------
    let charts = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(18)
        .margin_start(12)
        .margin_end(12)
        .margin_top(12)
        .margin_bottom(18)
        .build();
    let distribution = histogram(&stats.times);
    let trend_data = trend(&stats.times);
    if let Some(distribution) = &distribution {
        charts.append(&chart_section(
            MessageKey::StatsChartsDistribution,
            histogram_chart(distribution),
        ));
    }
    if let Some(trend_data) = &trend_data {
        charts.append(&chart_section(
            MessageKey::StatsChartsTrend,
            trend_chart(trend_data),
        ));
    }
    let recent = heatmap_section(&days, now);
    if let Some(recent) = &recent {
        charts.append(recent);
    }
    if distribution.is_none() && trend_data.is_none() && recent.is_none() {
        charts.append(
            &gtk::Label::builder()
                .label(t0(MessageKey::StatsEmpty))
                .css_classes(["dim-label"])
                .margin_top(24)
                .build(),
        );
    }

    // ---- tabs --------------------------------------------------------------
    let stack = adw::ViewStack::new();
    stack.add_titled_with_icon(
        &scroll(&summary),
        Some("summary"),
        &t0(MessageKey::StatsTabSummary),
        "view-list-ordered-symbolic",
    );
    stack.add_titled_with_icon(
        &scroll(&charts),
        Some("charts"),
        &t0(MessageKey::StatsTabCharts),
        "decrease-symbolic",
    );

    // The documented ViewSwitcher pairing: the tabs live in the header while
    // there is room, and the breakpoint swaps them for a bottom bar rather
    // than squeezing the header strip. Both point at the same stack.
    let switcher = adw::ViewSwitcher::builder()
        .stack(&stack)
        .policy(adw::ViewSwitcherPolicy::Wide)
        .build();
    let switcher_bar = adw::ViewSwitcherBar::builder()
        .stack(&stack)
        .reveal(false)
        .build();
    let narrow_title = adw::WindowTitle::new(&t0(MessageKey::StatsTitle), "");
    let header = adw::HeaderBar::builder()
        .title_widget(&switcher)
        .show_title(true)
        .build();

    let toolbar = adw::ToolbarView::new();
    toolbar.add_top_bar(&header);
    toolbar.add_bottom_bar(&switcher_bar);
    toolbar.set_content(Some(&stack));

    // Adaptive width: a fixed content width, not follows-content-size — with
    // the latter the dialog width always equals the content, so a width
    // breakpoint could never tell a roomy window from a squeezed one.
    let dialog = adw::Dialog::builder()
        .title(t0(MessageKey::StatsTitle))
        .content_width(480)
        .content_height(560)
        .width_request(280)
        .height_request(240)
        .build();
    dialog.set_child(Some(&toolbar));

    let squeeze = adw::Breakpoint::new(adw::BreakpointCondition::new_length(
        adw::BreakpointConditionLengthType::MaxWidth,
        450.0,
        adw::LengthUnit::Px,
    ));
    {
        // The documented setter is `title-widget = NULL`; a real title widget
        // stands in, so the narrow header is not an empty bar above the bottom
        // switcher.
        let header = header.clone();
        let switcher = switcher.clone();
        let switcher_bar = switcher_bar.clone();
        let narrow_title = narrow_title.clone();
        let summary = summary.clone();
        squeeze.connect_apply(move |_| {
            header.set_title_widget(Some(&narrow_title));
            switcher_bar.set_reveal(true);
            summary.set_margin_start(12);
            summary.set_margin_end(12);
        });
        let _ = switcher;
    }
    {
        let header = header.clone();
        let switcher = switcher.clone();
        let switcher_bar = switcher_bar.clone();
        let summary = summary.clone();
        squeeze.connect_unapply(move |_| {
            header.set_title_widget(Some(&switcher));
            switcher_bar.set_reveal(false);
            summary.set_margin_start(24);
            summary.set_margin_end(24);
        });
    }
    dialog.add_breakpoint(squeeze);

    dialog.present(Some(parent));
}
