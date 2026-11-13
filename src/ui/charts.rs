//! The statistics dialog's two drawings.
//!
//! Cairo lines and rectangles only: text stays in `Gtk.Label`, as the legacy
//! app did. `core/charts` decides the numbers; this module maps them to
//! pixels, and both charts share one frame so the axis labels, grid lines and
//! padding cannot drift apart.

use gtk4 as gtk;
use gtk4::prelude::*;

use crate::core::charts::{Histogram, Trend};
use crate::core::i18n::{MessageKey, t0};
use crate::core::time::format_time;

const CHART_HEIGHT: i32 = 170;
const PADDING_TOP: f64 = 8.0;
const PADDING_BOTTOM: f64 = 8.0;
const PADDING_SIDE: f64 = 6.0;
const LABEL_HEIGHT: f64 = 14.0;
/// Breathing room after the widest value label.
const Y_AXIS_GAP: f64 = 3.0;

/// The line colours; the swatches use the matching CSS classes.
const SINGLE: (f64, f64, f64, f64) = (0.55, 0.55, 0.55, 0.9);
const AO5: (f64, f64, f64, f64) = (0.87, 0.12, 0.16, 1.0);
const AO12: (f64, f64, f64, f64) = (0.1, 0.45, 0.82, 1.0);
const BAR: (f64, f64, f64, f64) = (0.21, 0.52, 0.89, 0.8);
const GRID: (f64, f64, f64, f64) = (0.5, 0.5, 0.5, 0.18);

fn set_source(cr: &gtk::cairo::Context, (red, green, blue, alpha): (f64, f64, f64, f64)) {
    cr.set_source_rgba(red, green, blue, alpha);
}

struct Plot {
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
}

struct YTick {
    label: String,
    /// 0 at the bottom, 1 at the top.
    y: f64,
}

/// The trend's value labels: whole seconds when a grid step is a second or
/// more, otherwise one decimal. Axis labels are guides, not results, so this
/// drops centiseconds and shortens the rail without hiding the scale.
fn axis_time_label(ms: f64, step_ms: f64) -> String {
    if step_ms >= 1000.0 {
        let total = (ms / 1000.0).round() as i64;
        let minutes = total / 60;
        let seconds = total % 60;
        if minutes > 0 {
            format!("{minutes}:{seconds:02}")
        } else {
            total.to_string()
        }
    } else {
        let tenths = (ms / 100.0).round() / 10.0;
        let minutes = (tenths / 60.0).floor() as i64;
        let seconds = tenths - minutes as f64 * 60.0;
        if minutes > 0 {
            format!("{minutes}:{seconds:04.1}")
        } else {
            format!("{tenths:.1}")
        }
    }
}

/// One chart: an optional y-label rail on the left, a `DrawingArea` that takes
/// the remaining width, and a three-cell x-label row underneath. No ticks
/// means no rail and no grid lines — the plot starts at the card's edge.
fn chart_frame(
    name: &str,
    ticks: Vec<YTick>,
    x_labels: [String; 3],
    draw: impl Fn(&gtk::cairo::Context, &Plot) + 'static,
) -> gtk::Widget {
    let plot_height = f64::from(CHART_HEIGHT) - PADDING_TOP - PADDING_BOTTOM;

    // The rail is only as wide as the widest value it holds: counts stay
    // narrow, times get the room their digits need. Measure before building
    // the row, because the x labels are inset by the same width.
    let mut widest = 0.0_f64;
    let mut labels = Vec::with_capacity(ticks.len());
    for tick in &ticks {
        let label = gtk::Label::builder()
            .label(&tick.label)
            .xalign(1.0)
            .css_classes(["caption", "dim-label"])
            .build();
        let (_, natural, _, _) = label.measure(gtk::Orientation::Horizontal, -1);
        widest = widest.max(f64::from(natural));
        labels.push((label, tick.y));
    }
    let axis_width = if labels.is_empty() {
        0.0
    } else {
        widest.ceil() + Y_AXIS_GAP
    };

    let mut axis: Option<gtk::Fixed> = None;
    if !labels.is_empty() {
        let fixed = gtk::Fixed::builder()
            .width_request(axis_width as i32)
            .height_request(CHART_HEIGHT)
            .valign(gtk::Align::Start)
            .build();
        for (label, y) in &labels {
            label.set_width_request(axis_width as i32);
            fixed.put(
                label,
                0.0,
                (PADDING_TOP + (1.0 - y) * plot_height - LABEL_HEIGHT / 2.0).round(),
            );
        }
        axis = Some(fixed);
    }

    let area = gtk::DrawingArea::builder()
        .name(name)
        .height_request(CHART_HEIGHT)
        .hexpand(true)
        .vexpand(false)
        .build();
    {
        let ticks: Vec<f64> = ticks.iter().map(|tick| tick.y).collect();
        area.set_draw_func(move |_area, cr, width, height| {
            let plot = Plot {
                left: PADDING_SIDE,
                top: PADDING_TOP,
                right: f64::from(width).max(PADDING_SIDE + 1.0) - PADDING_SIDE,
                bottom: f64::from(height).max(PADDING_TOP + 1.0) - PADDING_BOTTOM,
            };
            let height_px = plot.bottom - plot.top;

            cr.set_line_width(1.0);
            set_source(cr, GRID);
            for y in &ticks {
                let pixel = plot.top + (1.0 - y) * height_px;
                cr.move_to(plot.left, pixel);
                cr.line_to(plot.right, pixel);
                let _ = cr.stroke();
            }
            draw(cr, &plot);
        });
    }

    let row = gtk::Box::new(gtk::Orientation::Horizontal, 4);
    if let Some(axis) = &axis {
        row.append(axis);
    }
    row.append(&area);

    // The x labels belong to the plot, not to the whole row: inset them past
    // the y rail (when there is one) and the plot's own side padding so
    // "first time" starts under the first bar or point.
    let x_row = gtk::Box::builder()
        .orientation(gtk::Orientation::Horizontal)
        .name("chart-x-labels")
        .hexpand(true)
        .margin_start(
            ((if axis.is_some() {
                axis_width + 4.0
            } else {
                0.0
            }) + PADDING_SIDE) as i32,
        )
        .margin_end(PADDING_SIDE as i32)
        .build();
    for (index, text) in x_labels.iter().enumerate() {
        x_row.append(
            &gtk::Label::builder()
                .label(text)
                .xalign(index as f32 / (x_labels.len() - 1) as f32)
                .hexpand(true)
                .css_classes(["caption", "dim-label"])
                .build(),
        );
    }

    let root = gtk::Box::new(gtk::Orientation::Vertical, 2);
    root.append(&row);
    root.append(&x_row);
    root.upcast()
}

/// A small coloured line plus its label.
fn legend_item(label: MessageKey, swatch: &str) -> gtk::Box {
    let item = gtk::Box::new(gtk::Orientation::Horizontal, 5);
    item.append(
        &gtk::Box::builder()
            .width_request(14)
            .height_request(3)
            .valign(gtk::Align::Center)
            .css_classes(["chart-swatch", swatch])
            .build(),
    );
    item.append(
        &gtk::Label::builder()
            .label(t0(label))
            .css_classes(["caption", "dim-label"])
            .build(),
    );
    item
}

/// Time-distribution bars. Heights are relative to the busiest bin, so the y
/// axis carries no labels: the shape is the point, and dropping the rail gives
/// the bars the full card width.
pub fn histogram_chart(histogram: &Histogram) -> gtk::Widget {
    let max_count = histogram
        .bins
        .iter()
        .map(|bin| bin.count)
        .max()
        .unwrap_or(1)
        .max(1) as f64;

    let middle = &histogram.bins[(histogram.bins.len() - 1) / 2];
    let x_labels = [
        format_time(histogram.bins[0].start_ms, false),
        if histogram.bins.len() > 1 {
            format_time(middle.start_ms, false)
        } else {
            String::new()
        },
        format_time(histogram.bins[histogram.bins.len() - 1].end_ms, false),
    ];

    let bins: Vec<(f64, usize)> = histogram
        .bins
        .iter()
        .map(|bin| (bin.start_ms, bin.count))
        .collect();

    chart_frame("histogram-chart", Vec::new(), x_labels, move |cr, plot| {
        let width = plot.right - plot.left;
        let height = plot.bottom - plot.top;
        let slot = width / bins.len() as f64;
        let bar_width = (slot - 2.0).max(1.0);

        set_source(cr, BAR);
        for (index, (_, count)) in bins.iter().enumerate() {
            if *count == 0 {
                continue;
            }
            let bar_height = (*count as f64 / max_count) * height;
            cr.rectangle(
                plot.left + index as f64 * slot + 1.0,
                plot.bottom - bar_height,
                bar_width,
                bar_height.max(1.0),
            );
        }
        let _ = cr.fill();
    })
}

/// Single/ao5/ao12 lines over solve order, with the value axis on the left.
pub fn trend_chart(trend: &Trend) -> gtk::Widget {
    let ticks: Vec<YTick> = trend
        .ticks
        .iter()
        .map(|tick| YTick {
            label: axis_time_label(tick.value_ms, trend.step_ms),
            y: tick.y,
        })
        .collect();
    let x_labels = if trend.count == 1 {
        [String::new(), "1".to_string(), String::new()]
    } else {
        ["1".to_string(), String::new(), trend.count.to_string()]
    };

    let series: Vec<(crate::core::stats::StatKind, Vec<(f64, f64)>)> = trend
        .series
        .iter()
        .map(|series| {
            (
                series.kind,
                series
                    .points
                    .iter()
                    .map(|point| (point.x, point.y))
                    .collect(),
            )
        })
        .collect();

    let root = gtk::Box::new(gtk::Orientation::Vertical, 6);
    root.append(&chart_frame(
        "trend-chart",
        ticks,
        x_labels,
        move |cr, plot| {
            use crate::core::stats::StatKind;
            let width = plot.right - plot.left;
            let height = plot.bottom - plot.top;
            let x_at = |x: f64| plot.left + x * width;
            let y_at = |y: f64| plot.top + (1.0 - y) * height;

            for (kind, points) in &series {
                if points.is_empty() {
                    continue;
                }
                let colour = match kind {
                    StatKind::Ao5 => AO5,
                    StatKind::Ao12 => AO12,
                    _ => SINGLE,
                };
                set_source(cr, colour);
                cr.set_line_width(if *kind == StatKind::Single { 1.5 } else { 2.0 });
                if points.len() == 1 {
                    let (x, y) = points[0];
                    cr.arc(x_at(x), y_at(y), 2.0, 0.0, std::f64::consts::PI * 2.0);
                    let _ = cr.fill();
                    continue;
                }
                cr.move_to(x_at(points[0].0), y_at(points[0].1));
                for (x, y) in &points[1..] {
                    cr.line_to(x_at(*x), y_at(*y));
                }
                let _ = cr.stroke();
            }
        },
    ));

    let legend = gtk::Box::builder()
        .orientation(gtk::Orientation::Horizontal)
        .spacing(12)
        .halign(gtk::Align::Center)
        .build();
    legend.append(&legend_item(MessageKey::StatsSingle, "single"));
    legend.append(&legend_item(MessageKey::StatsAo5, "ao5"));
    legend.append(&legend_item(MessageKey::StatsAo12, "ao12"));
    root.append(&legend);
    root.upcast()
}
