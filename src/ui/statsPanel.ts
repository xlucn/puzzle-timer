/*
 * statsPanel.ts — the Statistics dialog behind the app menu.
 *
 * Three tabs over one session: Summary (the averages table),
 * Records (PB history — when each best was set and how long it stood) and
 * Activity (local-day buckets, streaks, a calendar heat map).
 *
 * Every number comes from src/core/stats.ts, records.ts and activity.ts, so
 * this view and the strip cannot disagree. The figures are computed when the
 * dialog opens: it blocks input to the window behind it, so nothing can
 * change while it is on screen.
 *
 * Layout note (probed against libadwaita 1.9.4): an Adw.Dialog does NOT render
 * its own title — only `child`, so the content carries its own Adw.HeaderBar.
 * That HeaderBar gets a close button for free inside a dialog, and Escape
 * closes natively.
 */
import Adw from 'gi:Adw-1'
import Gio from 'gi:Gio-2.0'
import GLib from 'gi:GLib-2.0'
import Gtk from 'gi:Gtk-4.0'

import { styles } from 'node-gtk/styles'

import { activity, heatmap } from '../core/activity.js'
import { formatCount, formatDate, t } from '../core/i18n.js'
import { heldDays, heldSolves, pbHistory, type PbRecord } from '../core/records.js'
import type { Session } from '../core/session.js'
import {
  type PbTarget,
  type StatKind,
  STAT_KINDS,
  sessionStats,
} from '../core/stats.js'
import { formatAverage, formatSolve, formatTime } from '../core/time.js'
import type { MessageKey } from '../locales/en.js'

/*
 * The `gi:*` shims export a *value* namespace only (AGENTS.md), so widget
 * types come from InstanceType.
 */
type Application = InstanceType<typeof Adw.Application>
type Window = InstanceType<typeof Adw.ApplicationWindow>

// Dimming goes through alpha(@window_fg_color) (GTK3's @dim_label does not
// exist in GTK4); tabular figures keep the value columns from jittering.
styles.add(`
  /* Small text and dimming come from built-ins on the cells: caption (82%
     size) and dim-label (55% dim) for the mean caption; numeric (tabular
     figures) keeps the value columns from jittering. Only the semibold stays
     a rule — no Adwaita class is 600. */
  .stats-cell {
    font-weight: 600;
  }
  .stats-cell.incomplete {
    font-weight: 400;
    color: alpha(@window_fg_color, 0.4);
  }
  /* Calendar heat map: empty days stay a faint card-coloured square, busy
     days step through the accent colour. The legend reuses the same classes
     so it cannot drift from the grid. */
  .heatmap-cell {
    min-width: 14px;
    min-height: 14px;
    border-radius: 3px;
    background-color: alpha(@window_fg_color, 0.1);
  }
  .heatmap-cell.level-1 { background-color: alpha(@accent_bg_color, 0.35); }
  .heatmap-cell.level-2 { background-color: alpha(@accent_bg_color, 0.55); }
  .heatmap-cell.level-3 { background-color: alpha(@accent_bg_color, 0.75); }
  .heatmap-cell.level-4 { background-color: @accent_bg_color; }
  .heatmap-cell.future { background-color: transparent; }
`)

export interface StatsPanelOptions {
  /** The application the `app.statistics` action is registered on. */
  app: Application
  /** Toplevel the dialog is presented on. */
  window: Window
  /** The session to read; called live, like every other session reader. */
  getSession: () => Session
}

/** Catalog key per kind — the labels stay the same as the strip's. */
const KIND_LABEL: Record<StatKind, MessageKey> = {
  single: 'stats.single',
  mo3: 'stats.mo3',
  ao5: 'stats.ao5',
  ao12: 'stats.ao12',
  ao50: 'stats.ao50',
  ao100: 'stats.ao100',
  ao1000: 'stats.ao1000',
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
}

const DASH = '—'

/** A quarter of weeks fits the dialog without horizontal scrolling. */
const HEATMAP_WEEKS = 13

/**
 * A history is a ListBox of rows, so it is built lazily on the first expand
 * and capped: a beginner can set a PB on every one of thousands of solves,
 * and building all of those rows in a dialog would be the same mistake as
 * putting the solve list in a ListBox. The newest entries are the ones worth
 * reading; the cap row says how many older ones are hidden.
 */
const HISTORY_LIMIT = 250

export function createStatsPanel(options: StatsPanelOptions) {
  /** Target column text: a tick time, "Any", or the dimmed em dash. */
  const targetText = (target: PbTarget): string => {
    switch (target.kind) {
      case 'value':
        return formatTime(target.ms)
      case 'always':
        return t('stats.any')
      case 'never':
      case 'none':
        return DASH
    }
  }

  /** Value cells: plain for labels, semibold tabular for numbers, dim for a dash. */
  const valueClasses = (text: string) =>
    text === '' ? [] : text === DASH ? ['stats-cell', 'incomplete'] : ['stats-cell', 'numeric']

  /** `Set 14 Mar 2025` / `Set at #143`, plus held duration or "current". */
  const recordStatus = (
    record: PbRecord,
    next: PbRecord | undefined,
    total: number,
  ): string => {
    const set =
      record.setAtMs > 0
        ? t('stats.records.setDate', { date: formatDate(record.setAtMs, DATE_OPTIONS) })
        : t('stats.records.setSolve', { number: formatCount(record.index + 1) })

    if (next === undefined) return `${set} · ${t('stats.records.current')}`

    const days = heldDays(record)
    const held =
      days === null
        ? t('stats.records.heldSolves', { count: heldSolves(record, total, next) })
        : days === 0
          ? t('stats.records.heldSameDay')
          : t('stats.records.heldDays', { count: days })
    return `${set} · ${held}`
  }

  // ---- summary -----------------------------------------------------------
  const summaryPage = (session: Session, stats: ReturnType<typeof sessionStats>) => {
    const total = session.size
    const last = session.solves[total - 1]

    const rows = STAT_KINDS.map((kind) => {
      // The newest single keeps its +2 suffix (formatSolve), unlike the
      // averages, which are penalised numbers without a notation of their own.
      const current =
        kind === 'single'
          ? last === undefined
            ? DASH
            : formatSolve(last.timeMs, last.penalty)
          : Number.isNaN(stats.current[kind])
            ? DASH
            : formatAverage(stats.current[kind])

      const best = stats.best[kind] === null ? DASH : formatAverage(stats.best[kind]!.value)
      const target = targetText(stats.target[kind])

      return {
        label: t(KIND_LABEL[kind]),
        values: [current, best, target].map((text) => ({ text, classes: valueClasses(text) })),
      }
    })

    const { mean, dnfCount, count } = stats.mean
    const meanValue = total === 0 ? DASH : formatAverage(mean)
    const caption =
      total === 0
        ? t('stats.empty')
        : dnfCount === 0
          ? t('stats.solves', { count: total })
          : `${t('stats.counted', { count, total })} · ${t('stats.dnf', { count: dnfCount })}`

    // The mean is not one of STAT_KINDS, but it still belongs in the table:
    // one row with only its current value filled, followed by the count/DNF
    // caption that would not fit a single cell.
    rows.push({
      label: t('stats.mean'),
      values: [
        { text: meanValue, classes: valueClasses(meanValue) },
        { text: '', classes: [] },
        { text: '', classes: [] },
      ],
    })

    // A Gtk.StringList carries the row labels; each cell factory reads the
    // real value from `rows` by the item's position, so no custom GObject
    // subtype (and no unproven registerClass) is needed.
    const model = Gtk.StringList.new(rows.map((row) => row.label))
    const view = Gtk.ColumnView.new(Gtk.NoSelection.new(model))
    view.setShowRowSeparators(true)
    view.setHexpand(true)
    view.setVexpand(false)
    view.setValign(Gtk.Align.START)

    const makeColumn = (title: string, index: number) => {
      const factory = Gtk.SignalListItemFactory.new()

      factory.on('setup', (object) => {
        const cell: any = object
        cell.setChild(new Gtk.Label({ xalign: 0, hexpand: true }))
      })

      factory.on('bind', (object) => {
        const cell: any = object
        const label: any = cell.getChild()
        if (label === null) return
        const position = cell.getPosition()
        if (position < 0 || position >= rows.length) return
        const value =
          index < 0 ? { text: rows[position].label, classes: [] } : rows[position].values[index]
        label.setLabel(value.text)
        label.setCssClasses(value.classes)
      })

      factory.on('teardown', (object) => {
        const cell: any = object
        cell.setChild(null)
      })

      const column = Gtk.ColumnViewColumn.new(title, factory)
      column.setResizable(false)
      // The kind column keeps its content width; the three value columns
      // share the rest, so the table reaches both sides of the dialog.
      column.setExpand(index >= 0)
      return column
    }

    view.appendColumn(makeColumn('', -1))
    view.appendColumn(makeColumn(t('stats.current'), 0))
    view.appendColumn(makeColumn(t('stats.best'), 1))
    view.appendColumn(makeColumn(t('stats.target'), 2))

    const table = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 6,
      marginStart: 12,
      marginEnd: 12,
      marginTop: 12,
      marginBottom: 12,
    })
    table.append(view)
    table.append(
      new Gtk.Label({
        label: caption,
        xalign: 0,
        cssClasses: ['caption', 'dim-label'],
      }),
    )

    // The other tabs carry an Adw.PreferencesGroup title; the Summary table
    // gets one for the same reason — the dialog header is the switcher in
    // wide mode, so the page itself has to name its section.
    const tableRow = new Gtk.ListBoxRow({ selectable: false, activatable: false })
    tableRow.setChild(table)
    const group = new Adw.PreferencesGroup({ title: t('stats.tab.summary') })
    group.add(tableRow)

    const body = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      marginStart: 24,
      marginEnd: 24,
      marginBottom: 18,
    })
    body.append(group)
    return { body }
  }

  // ---- records -----------------------------------------------------------
  const recordsPage = (session: Session) => {
    const total = session.size
    const group = new Adw.PreferencesGroup({
      title: t('stats.records.group'),
      description: t('stats.records.description'),
    })

    for (const kind of STAT_KINDS) {
      const history = pbHistory(session.solves, kind)
      const current = history.at(-1)

      const row = new Adw.ExpanderRow({
        title: t(KIND_LABEL[kind]),
        subtitle:
          current === undefined
            ? t('stats.records.none')
            : recordStatus(current, undefined, total),
        useMarkup: false,
        enableExpansion: history.length > 1,
      })
      row.addSuffix(
        new Gtk.Label({
          label: current === undefined ? DASH : formatAverage(current.value),
          cssClasses: current === undefined ? ['dim-label'] : ['numeric'],
        }),
      )

      if (history.length > 1) {
        let populated = false
        row.on('notify::expanded', () => {
          if (populated || !row.expanded) return
          populated = true
          const first = Math.max(0, history.length - HISTORY_LIMIT)
          // Newest first: the current PB leads the list.
          for (let i = history.length - 1; i >= first; i -= 1) {
            const record = history[i]
            const next = history[i + 1]
            const entry = new Adw.ActionRow({
              title: formatAverage(record.value),
              subtitle: recordStatus(record, next, total),
              useMarkup: false,
              activatable: false,
            })
            entry.addSuffix(
              new Gtk.Label({
                label: `#${formatCount(record.index + 1)}`,
                cssClasses: ['numeric', 'dim-label'],
              }),
            )
            row.addRow(entry)
          }
          if (first > 0) {
            row.addRow(
              new Adw.ActionRow({
                title: t('stats.records.older', { count: first }),
                useMarkup: false,
                activatable: false,
                cssClasses: ['dim-label'],
              }),
            )
          }
        })
      }

      group.add(row)
    }

    const body = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 18,
      marginStart: 12,
      marginEnd: 12,
      marginBottom: 18,
      marginTop: 12,
    })
    body.append(group)
    return body
  }

  // ---- activity ----------------------------------------------------------
  const activityPage = (
    session: Session,
    summary: ReturnType<typeof sessionStats>,
    now: number,
  ) => {
    const stats = activity(session.solves, now)

    // Two sections: the map leads, the figures read as the detail below it.
    // Adw.PreferencesGroup supplies both the section title and the boxed
    // card, so neither is hand-built.
    const figures = new Adw.PreferencesGroup({ title: t('stats.activity.overview') })
    let recent: InstanceType<typeof Adw.PreferencesGroup> | null = null

    const addFigure = (label: string, value: string) => {
      const row = new Adw.ActionRow({
        title: label,
        useMarkup: false,
        activatable: false,
      })
      row.addSuffix(
        new Gtk.Label({
          label: value,
          cssClasses: value === DASH ? ['dim-label'] : ['numeric'],
        }),
      )
      figures.add(row)
    }

    // A new session would otherwise show a blank quarter. Once there is any
    // dated activity, the empty days become the gaps that make a streak
    // legible, so they are worth keeping.
    if (stats.days.length > 0) {
      const map = heatmap(stats, now, HEATMAP_WEEKS)
      const grid = new Gtk.Grid({ columnSpacing: 3, rowSpacing: 3, hexpand: true })
      const cellBoxes: InstanceType<typeof Gtk.Box>[] = []
      // Row 0 carries month names, rows 1..7 the Monday-first weekday labels
      // on the left and one cell per day. A month label spans every week of
      // its month: a one-column label is wider than a 14 px cell and would
      // stretch that column, which is exactly what made the cells uneven.
      const monthStarts: number[] = []
      let previousMonth = -1
      for (let column = 0; column < map.weeks.length; column += 1) {
        const month = new Date(map.weeks[column][0].startMs).getMonth()
        if (column === 0 || month !== previousMonth) monthStarts.push(column)
        previousMonth = month
      }
      for (const [index, start] of monthStarts.entries()) {
        const end = monthStarts[index + 1] ?? map.weeks.length
        const span = end - start
        // A one-week tail cannot absorb the label without widening its cell.
        if (span < 2) continue
        grid.attach(
          new Gtk.Label({
            label: formatDate(map.weeks[start][0].startMs, { month: 'short' }),
            xalign: 0,
            cssClasses: ['caption', 'dim-label'],
          }),
          start + 1,
          0,
          span,
          1,
        )
      }
      for (let column = 0; column < map.weeks.length; column += 1) {
        for (let day = 0; day < 7; day += 1) {
          const cell = map.weeks[column][day]
          const level = cell.inRange ? cell.level : 0
          const box = new Gtk.Box({
            cssClasses: ['heatmap-cell', `level-${level}`].concat(
              cell.inRange ? [] : ['future'],
            ),
          })
          cellBoxes.push(box)
          // node-gtk cannot box an undefined property, so the tooltip is set
          // only for the days that exist.
          if (cell.inRange) {
            const date = formatDate(cell.startMs, DATE_OPTIONS)
            box.setTooltipText(
              cell.count === 0
                ? `${date} · ${t('stats.activity.noSolves')}`
                : `${date} · ${t('stats.solves', { count: cell.count })}`,
            )
          }
          grid.attach(box, column + 1, day + 1, 1, 1)
        }
      }
      for (const day of [0, 2, 4]) {
        grid.attach(
          new Gtk.Label({
            label: formatDate(map.weeks[0][day].startMs, { weekday: 'short' }),
            xalign: 1,
            cssClasses: ['caption', 'dim-label'],
            marginEnd: 3,
          }),
          0,
          day + 1,
          1,
          1,
        )
      }

      // A day cell grows into the width it is given instead of leaving the
      // extra space between columns. The size comes from the allocated grid:
      // 13 week cells share the width left by the weekday rail and the 13
      // column gaps. The surface layout signal re-runs it on every resize.
      let cellSize = 0
      const fitCells = () => {
        const width = grid.getWidth()
        if (width <= 0) return
        const labelWidth = grid.getChildAt(0, 1)?.getWidth() ?? 30
        const gaps = HEATMAP_WEEKS * 3
        // The 4 px leaves room for the card's border/padding; without it the
        // final column can tip the dialog's natural width past contentWidth.
        const size = Math.max(
          14,
          Math.floor((width - labelWidth - gaps - 4) / HEATMAP_WEEKS),
        )
        if (size === cellSize) return
        cellSize = size
        for (const box of cellBoxes) box.setSizeRequest(size, size)
      }
      let listening = false
      grid.on('map', () => {
        if (!listening) {
          const surface = grid.getNative()?.getSurface() ?? null
          surface?.on('layout', fitCells)
          listening = true
        }
        GLib.idleAdd(GLib.PRIORITY_DEFAULT, () => {
          fitCells()
          return GLib.SOURCE_REMOVE
        })
      })

      const legend = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 4,
        halign: Gtk.Align.CENTER,
        marginTop: 8,
      })
      legend.append(
        new Gtk.Label({
          label: t('stats.activity.less'),
          cssClasses: ['caption', 'dim-label'],
        }),
      )
      for (let level = 0; level <= 4; level += 1) {
        legend.append(
          new Gtk.Box({
            widthRequest: 11,
            heightRequest: 11,
            valign: Gtk.Align.CENTER,
            cssClasses: ['heatmap-cell', `level-${level}`],
          }),
        )
      }
      legend.append(
        new Gtk.Label({
          label: t('stats.activity.more'),
          cssClasses: ['caption', 'dim-label'],
        }),
      )

      const heatRow = new Gtk.ListBoxRow({ selectable: false, activatable: false })
      const heatBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        hexpand: true,
        marginStart: 12,
        marginEnd: 12,
        marginTop: 12,
        marginBottom: 12,
      })
      heatBox.append(grid)
      heatBox.append(legend)
      heatRow.setChild(heatBox)
      recent = new Adw.PreferencesGroup({ title: t('stats.activity.recent') })
      recent.add(heatRow)
    }

    addFigure(t('stats.activity.totalSolves'), formatCount(stats.totalSolves))
    addFigure(
      t('stats.totalTime'),
      session.size === 0 ? DASH : formatTime(summary.totalMs),
    )
    addFigure(
      t('stats.activity.today'),
      `${t('stats.solves', { count: stats.today.count })} · ${formatTime(stats.today.totalMs)}`,
    )
    addFigure(
      t('stats.activity.last7'),
      `${t('stats.solves', { count: stats.last7.solves })} · ${t('stats.activity.activeCount', { count: stats.last7.activeDays })}`,
    )
    addFigure(
      t('stats.activity.last30'),
      `${t('stats.solves', { count: stats.last30.solves })} · ${t('stats.activity.activeCount', { count: stats.last30.activeDays })}`,
    )
    addFigure(
      t('stats.activity.currentStreak'),
      t('stats.activity.days', { count: stats.currentStreak }),
    )
    addFigure(
      t('stats.activity.longestStreak'),
      t('stats.activity.days', { count: stats.longestStreak }),
    )
    addFigure(t('stats.activity.activeDays'), formatCount(stats.activeDays))
    addFigure(
      t('stats.activity.perDay'),
      formatCount(Math.round(stats.perActiveDay * 10) / 10),
    )
    addFigure(
      t('stats.activity.bestDay'),
      stats.bestDay === null
        ? DASH
        : `${t('stats.solves', { count: stats.bestDay.count })} · ${formatDate(stats.bestDay.startMs, DATE_OPTIONS)}`,
    )
    if (stats.undated > 0) {
      addFigure(t('stats.activity.undated'), formatCount(stats.undated))
    }

    const body = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 18,
      marginStart: 12,
      marginEnd: 12,
      marginBottom: 18,
      marginTop: 12,
    })
    if (recent !== null) body.append(recent)
    body.append(figures)
    return body
  }

  const buildDialog = () => {
    const session = options.getSession()
    const now = Date.now()
    const stats = sessionStats(session.solves)

    const stack = new Adw.ViewStack()
    const summary = summaryPage(session, stats)
    stack.addTitledWithIcon(
      scroll(summary.body),
      'summary',
      t('stats.tab.summary'),
      'view-grid-symbolic',
    )
    stack.addTitledWithIcon(
      scroll(recordsPage(session)),
      'records',
      t('stats.tab.records'),
      'starred-symbolic',
    )
    stack.addTitledWithIcon(
      scroll(activityPage(session, stats, now)),
      'activity',
      t('stats.tab.activity'),
      'document-open-recent-symbolic',
    )

    // The documented ViewSwitcher pairing: the tabs live in the header while
    // there is room, and the breakpoint below swaps them for a bottom
    // ViewSwitcherBar rather than squeezing the header strip. Both widgets
    // point at the same stack, so switching either one moves the page.
    const switcher = new Adw.ViewSwitcher({
      stack,
      policy: Adw.ViewSwitcherPolicy.WIDE,
    })
    const switcherBar = new Adw.ViewSwitcherBar({ stack, reveal: false })

    // Adw.ToolbarView is the container the bottom bar is designed for: the
    // ViewSwitcherBar's `reveal` hands its height back to the stack when the
    // bar is hidden, instead of leaving a gap.
    const toolbar = new Adw.ToolbarView({ content: stack })
    toolbar.addTopBar(new Adw.HeaderBar({ titleWidget: switcher, showTitle: true }))
    toolbar.addBottomBar(switcherBar)

    // Adaptive width: a fixed contentWidth, not followsContentSize — with
    // the latter the dialog width always *equals* the content, so a width
    // breakpoint could never tell a roomy window from a squeezed one (it
    // would fire permanently). The gap between dialog (480) and content
    // natural (~365) is the "there is room" signal; the breakpoint reads the
    // content box and tightens spacing/margins below 450, which is what
    // keeps the table inside a 360px window, and moves the tab strip to the
    // bottom bar. A breakpoint-bearing AdwDialog has no implicit minimum
    // size (AdwDialog docs) — ask for one.
    const dialog = new Adw.Dialog({
      title: t('stats.title'),
      child: toolbar,
      contentWidth: 480,
      contentHeight: 560,
      widthRequest: 280,
      heightRequest: 240,
    })
    const squeeze = Adw.Breakpoint.new(
      Adw.BreakpointCondition.newLength(
        Adw.BreakpointConditionLengthType.MAX_WIDTH,
        450,
        Adw.LengthUnit.PX,
      ),
    )
    // apply/unapply, not addSetter: node-gtk can't box the GValue (AGENTS).
    squeeze.on('apply', () => {
      // The documented setter is `title-widget = NULL`; node-gtk cannot box
      // a null GValue, so hiding the switcher is the equivalent (the header
      // then has no tab strip and the bottom bar takes over).
      switcher.setVisible(false)
      switcherBar.reveal = true
      summary.body.marginStart = 12
      summary.body.marginEnd = 12
    })
    squeeze.on('unapply', () => {
      switcher.setVisible(true)
      switcherBar.reveal = false
      summary.body.marginStart = 24
      summary.body.marginEnd = 24
    })
    dialog.addBreakpoint(squeeze)
    dialog.present(options.window)
    return dialog
  }

  const action = Gio.SimpleAction.new('statistics', null)
  action.on('activate', () => buildDialog())
  options.app.addAction(action)

  return { open: buildDialog }
}

/**
 * A tab page scrolls vertically and never sideways; the dialog owns the
 * width. `vexpand` lets the stack hand the whole content area to the page, so
 * a long records history scrolls instead of stretching the dialog past the
 * screen.
 */
function scroll(child: InstanceType<typeof Gtk.Widget>) {
  const scroller = new Gtk.ScrolledWindow({
    vexpand: true,
    hexpand: true,
    hscrollbarPolicy: Gtk.PolicyType.NEVER,
    vscrollbarPolicy: Gtk.PolicyType.AUTOMATIC,
  })
  scroller.setChild(child)
  return scroller
}
