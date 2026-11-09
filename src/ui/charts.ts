/*
 * charts.ts — the Statistics dialog's two drawings.
 *
 * Cairo line/rectangle drawing only: text stays in Gtk.Label (AGENTS rule 6).
 * The core decides the numbers (`core/charts.ts`); this module maps them to
 * pixels. Both charts share one frame so the axis labels, grid lines and
 * padding cannot drift apart.
 */
import Gtk from 'gi:Gtk-4.0'

import { styles } from 'node-gtk/styles'

import type { Histogram, Trend, TrendKind } from '../core/charts.js'
import { formatCount, t } from '../core/i18n.js'
import { formatTime } from '../core/time.js'

type Widget = InstanceType<typeof Gtk.Widget>

const CHART_HEIGHT = 170
const PADDING_TOP = 8
const PADDING_BOTTOM = 8
const PADDING_SIDE = 6
const LABEL_HEIGHT = 14
/** Breathing room after the widest value label. */
const Y_AXIS_GAP = 3

/** The line colours; the swatches use the matching CSS classes below. */
const SINGLE: [number, number, number, number] = [0.55, 0.55, 0.55, 0.9]
const AO5: [number, number, number, number] = [0.87, 0.12, 0.16, 1]
const AO12: [number, number, number, number] = [0.1, 0.45, 0.82, 1]
const BAR: [number, number, number, number] = [0.21, 0.52, 0.89, 0.8]
const GRID: [number, number, number, number] = [0.5, 0.5, 0.5, 0.18]

styles.add(`
  .chart-swatch {
    min-width: 14px;
    min-height: 3px;
    border-radius: 2px;
  }
  .chart-swatch.single { background-color: alpha(@window_fg_color, 0.55); }
  .chart-swatch.ao5 { background-color: #e01b24; }
  .chart-swatch.ao12 { background-color: #1c71d8; }
`)

function setSource(
  cr: any,
  [red, green, blue, alpha]: [number, number, number, number],
): void {
  cr.setSourceRgba(red, green, blue, alpha)
}

interface Plot {
  left: number
  top: number
  right: number
  bottom: number
}

interface YTick {
  label: string
  /** 0 at the bottom, 1 at the top. */
  y: number
}

/**
 * One chart: a fixed y-label rail on the left, a DrawingArea that takes the
 * remaining width, and a three-cell x-label row underneath.
 */
function chartFrame(
  name: string,
  ticks: YTick[],
  xLabels: [string, string, string],
  draw: (cr: any, plot: Plot) => void,
): Widget {
  const plotHeight = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM
  // The rail is only as wide as the widest value it holds: counts stay
  // narrow, times get the room their digits need. Measure before building
  // the row, because the x labels are inset by the same width.
  const labels = ticks.map((tick) => {
    const label = new Gtk.Label({
      label: tick.label,
      xalign: 1,
      cssClasses: ['caption', 'dim-label'],
    })
    const [, natural] = label.measure(Gtk.Orientation.HORIZONTAL, -1)
    return { tick, label, width: natural }
  })
  const axisWidth = Math.ceil(Math.max(0, ...labels.map((entry) => entry.width))) + Y_AXIS_GAP

  const axis = new Gtk.Fixed({
    widthRequest: axisWidth,
    heightRequest: CHART_HEIGHT,
    valign: Gtk.Align.START,
  })
  for (const { tick, label } of labels) {
    label.widthRequest = axisWidth
    axis.put(label, 0, Math.round(PADDING_TOP + (1 - tick.y) * plotHeight - LABEL_HEIGHT / 2))
  }

  const area = new Gtk.DrawingArea({
    name,
    heightRequest: CHART_HEIGHT,
    hexpand: true,
    vexpand: false,
  })
  area.setDrawFunc((_area, cr: any, width, height) => {
    const plot: Plot = {
      left: PADDING_SIDE,
      top: PADDING_TOP,
      right: Math.max(PADDING_SIDE + 1, width - PADDING_SIDE),
      bottom: Math.max(PADDING_TOP + 1, height - PADDING_BOTTOM),
    }
    const plotHeightPx = plot.bottom - plot.top

    cr.setLineWidth(1)
    setSource(cr, GRID)
    for (const tick of ticks) {
      const y = plot.top + (1 - tick.y) * plotHeightPx
      cr.moveTo(plot.left, y)
      cr.lineTo(plot.right, y)
      cr.stroke()
    }
    draw(cr, plot)
  })

  const row = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 4 })
  row.append(axis)
  row.append(area)

  // The x labels belong to the plot, not to the whole row: inset them past
  // the y rail and the plot's own side padding so "first time" starts under
  // the first bar/point.
  const xRow = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    name: 'chart-x-labels',
    hexpand: true,
    marginStart: axisWidth + 4 + PADDING_SIDE,
    marginEnd: PADDING_SIDE,
  })
  xLabels.forEach((text, index) => {
    xRow.append(
      new Gtk.Label({
        label: text,
        xalign: index / (xLabels.length - 1),
        hexpand: true,
        cssClasses: ['caption', 'dim-label'],
      }),
    )
  })

  const root = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2 })
  root.append(row)
  root.append(xRow)
  return root
}

/** A small coloured line plus its label. */
function legendItem(label: string, swatch: TrendKind): Widget {
  const item = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 5 })
  item.append(
    new Gtk.Box({
      widthRequest: 14,
      heightRequest: 3,
      valign: Gtk.Align.CENTER,
      cssClasses: ['chart-swatch', swatch],
    }),
  )
  item.append(
    new Gtk.Label({
      label,
      cssClasses: ['caption', 'dim-label'],
    }),
  )
  return item
}

/** Time-distribution bars, with count labels on the y axis. */
export function createHistogramChart(histogram: Histogram): Widget {
  const maxCount = Math.max(...histogram.bins.map((bin) => bin.count), 1)
  const countTicks = [...new Set([0, Math.round(maxCount / 2), maxCount])].map((value) => ({
    label: formatCount(value),
    y: value / maxCount,
  }))

  const middle = histogram.bins[Math.floor((histogram.bins.length - 1) / 2)]
  const xLabels: [string, string, string] = [
    formatTime(histogram.bins[0].startMs),
    histogram.bins.length > 1 ? formatTime(middle.startMs) : '',
    formatTime(histogram.bins[histogram.bins.length - 1].endMs),
  ]

  return chartFrame('histogram-chart', countTicks, xLabels, (cr, plot) => {
    const width = plot.right - plot.left
    const height = plot.bottom - plot.top
    const slot = width / histogram.bins.length
    const barWidth = Math.max(1, slot - 2)

    setSource(cr, BAR)
    histogram.bins.forEach((bin, index) => {
      if (bin.count === 0) return
      const barHeight = (bin.count / maxCount) * height
      cr.rectangle(
        plot.left + index * slot + 1,
        plot.bottom - barHeight,
        barWidth,
        Math.max(1, barHeight),
      )
    })
    cr.fill()
  })
}

/** Single/ao5/ao12 lines over solve order, with the value axis on the left. */
export function createTrendChart(trend: Trend): Widget {
  const ticks: YTick[] = trend.ticks.map((tick) => ({
    label: formatTime(tick.valueMs),
    y: tick.y,
  }))
  const xLabels: [string, string, string] =
    trend.count === 1
      ? ['', formatCount(1), '']
      : [formatCount(1), '', formatCount(trend.count)]

  const root = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6 })
  root.append(
    chartFrame('trend-chart', ticks, xLabels, (cr, plot) => {
      const width = plot.right - plot.left
      const height = plot.bottom - plot.top
      const xAt = (x: number): number => plot.left + x * width
      const yAt = (y: number): number => plot.top + (1 - y) * height

      const colours: Record<TrendKind, [number, number, number, number]> = {
        single: SINGLE,
        ao5: AO5,
        ao12: AO12,
      }
      for (const series of trend.series) {
        if (series.points.length === 0) continue
        setSource(cr, colours[series.kind])
        cr.setLineWidth(series.kind === 'single' ? 1.5 : 2)
        if (series.points.length === 1) {
          const point = series.points[0]
          cr.arc(xAt(point.x), yAt(point.y), 2, 0, Math.PI * 2)
          cr.fill()
          continue
        }
        cr.moveTo(xAt(series.points[0].x), yAt(series.points[0].y))
        for (let index = 1; index < series.points.length; index += 1) {
          const point = series.points[index]
          cr.lineTo(xAt(point.x), yAt(point.y))
        }
        cr.stroke()
      }
    }),
  )

  const legend = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 12,
    halign: Gtk.Align.CENTER,
  })
  legend.append(legendItem(t('stats.single'), 'single'))
  legend.append(legendItem(t('stats.ao5'), 'ao5'))
  legend.append(legendItem(t('stats.ao12'), 'ao12'))
  root.append(legend)
  return root
}
