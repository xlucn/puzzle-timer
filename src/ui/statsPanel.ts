/*
 * statsPanel.ts — the Statistics dialog behind the app menu.
 *
 * Three tabs over one session: Summary (the full averages table plus spread),
 * Records (PB history — when each best was set and how long it stood) and
 * Activity (local-day buckets, streaks, recent days).
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
import Gtk from 'gi:Gtk-4.0'

import { styles } from 'node-gtk/styles'

import { activity, recentDays } from '../core/activity.js'
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
     size) and dim-label (55% dim) for the column heads, the mean caption and
     the names; numeric (tabular figures) keeps the value columns from
     jittering. Only the semibold stays a rule — no Adwaita class is 600. */
  .stats-cell {
    font-weight: 600;
  }
  .stats-cell.incomplete {
    font-weight: 400;
    color: alpha(@window_fg_color, 0.4);
  }
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

  /** One grid cell; `dim` is for every "not available yet" dash. */
  const cell = (text: string, classes: string[]) =>
    new Gtk.Label({ label: text, cssClasses: classes, xalign: 0 })

  const valueCell = (text: string) =>
    cell(text, text === DASH ? ['stats-cell', 'incomplete'] : ['stats-cell', 'numeric'])

  /** A value or "not available" pair used by both summary and activity. */
  const figure = (label: string, value: string) => {
    const name = cell(label, [])
    const number = cell(value, value === DASH ? ['dim-label'] : ['numeric'])
    number.xalign = 1
    return { name, number }
  }

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
    const grid = new Gtk.Grid({ columnSpacing: 28, rowSpacing: 8 })
    const attach = (column: number, row: number, widget: InstanceType<typeof Gtk.Widget>) => {
      grid.attach(widget, column, row, 1, 1)
    }

    // Built-ins instead of rules: caption (82% + 400 weight) + dim-label
    // (55%) is the platform's small secondary text.
    attach(0, 0, cell('', ['caption', 'dim-label']))
    attach(1, 0, cell(t('stats.current'), ['caption', 'dim-label']))
    attach(2, 0, cell(t('stats.best'), ['caption', 'dim-label']))
    attach(3, 0, cell(t('stats.target'), ['caption', 'dim-label']))

    STAT_KINDS.forEach((kind, index) => {
      const label = t(KIND_LABEL[kind])
      const row = index + 1

      // The newest single keeps its +2 suffix (formatSolve), unlike the
      // averages, which are penalised numbers without a notation of their own.
      const last = session.solves[total - 1]
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

      attach(0, row, cell(label, [])) // default size — the platform's plain row label
      attach(1, row, valueCell(current))
      attach(2, row, valueCell(best))
      attach(3, row, valueCell(target))
    })

    // ---- mean -------------------------------------------------------------
    const { mean, dnfCount, count } = stats.mean
    const meanValue = total === 0 ? DASH : formatAverage(mean)
    const caption =
      total === 0
        ? t('stats.empty')
        : dnfCount === 0
          ? t('stats.solves', { count: total })
          : `${t('stats.counted', { count, total })} · ${t('stats.dnf', { count: dnfCount })}`

    const meanRow = STAT_KINDS.length + 1
    attach(0, meanRow, cell(t('stats.mean'), []))
    attach(1, meanRow, valueCell(meanValue))
    grid.attach(cell(caption, ['caption', 'dim-label']), 2, meanRow, 2, 1)

    // ---- spread -----------------------------------------------------------
    const spreadGrid = new Gtk.Grid({ columnSpacing: 28, rowSpacing: 8 })
    const spreadRows: [string, string][] = [
      [t('stats.best'), stats.spread.best === null ? DASH : formatAverage(stats.spread.best)],
      [t('stats.worst'), stats.spread.worst === null ? DASH : formatAverage(stats.spread.worst)],
      [t('stats.range'), stats.spread.range === null ? DASH : formatAverage(stats.spread.range)],
      [
        t('stats.sigma'),
        Number.isNaN(stats.spread.sigma) ? DASH : formatAverage(stats.spread.sigma),
      ],
      [t('stats.totalTime'), total === 0 ? DASH : formatTime(stats.totalMs)],
    ]
    spreadRows.forEach(([label, value], index) => {
      const { name, number } = figure(label, value)
      spreadGrid.attach(name, 0, index, 1, 1)
      spreadGrid.attach(number, 1, index, 1, 1)
    })

    const body = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 18,
      marginStart: 24,
      marginEnd: 24,
      marginBottom: 18,
    })
    body.append(grid)
    const spreadLabel = new Gtk.Label({
      label: t('stats.spread'),
      cssClasses: ['caption', 'dim-label'],
      xalign: 0,
      marginTop: 6,
    })
    body.append(spreadLabel)
    body.append(spreadGrid)
    return { body, grid }
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
  const activityPage = (session: Session, now: number) => {
    const stats = activity(session.solves, now)
    const days = recentDays(stats, now, 14)
    const maxCount = Math.max(1, ...days.map((day) => day.count))

    // One list for the whole tab: the summary figures and the day rows are
    // the same kind of data, so they share one Gtk.ListBox and its card
    // (`boxed-list`, the class Adw.PreferencesGroup puts on its own list).
    const list = new Gtk.ListBox({
      selectionMode: Gtk.SelectionMode.NONE,
      cssClasses: ['boxed-list'],
    })

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
      list.append(row)
    }

    addFigure(t('stats.activity.totalSolves'), formatCount(stats.totalSolves))
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

    // A new session would otherwise show fourteen "No solves" rows. Once
    // there is any dated activity, the zero days become the gaps that make a
    // streak legible, so they are worth keeping.
    if (stats.days.length > 0) {
      const heading = new Gtk.ListBoxRow({ selectable: false, activatable: false })
      heading.setChild(
        new Gtk.Label({
          label: t('stats.activity.recent'),
          xalign: 0,
          cssClasses: ['heading'],
          marginStart: 12,
          marginEnd: 12,
          marginTop: 12,
          marginBottom: 6,
        }),
      )
      list.append(heading)

      for (const day of days) {
        const row = new Adw.ActionRow({
          title: formatDate(day.startMs, { weekday: 'short', month: 'short', day: 'numeric' }),
          subtitle:
            day.count === 0
              ? t('stats.activity.noSolves')
              : `${t('stats.solves', { count: day.count })} · ${formatTime(day.totalMs)}`,
          useMarkup: false,
          activatable: false,
        })
        const bar = new Gtk.LevelBar({
          minValue: 0,
          maxValue: maxCount,
          value: day.count,
          widthRequest: 120,
          valign: Gtk.Align.CENTER,
        })
        bar.setVisible(day.count > 0)
        row.addSuffix(bar)
        list.append(row)
      }
    }

    const body = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 18,
      marginStart: 12,
      marginEnd: 12,
      marginBottom: 18,
      marginTop: 12,
    })
    body.append(list)
    return body
  }

  const buildDialog = () => {
    const session = options.getSession()
    const now = Date.now()
    const stats = sessionStats(session.solves)

    const stack = new Adw.ViewStack()
    const summary = summaryPage(session, stats)
    stack.addTitled(scroll(summary.body), 'summary', t('stats.tab.summary'))
    stack.addTitled(scroll(recordsPage(session)), 'records', t('stats.tab.records'))
    stack.addTitled(scroll(activityPage(session, now)), 'activity', t('stats.tab.activity'))

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
      summary.grid.columnSpacing = 12
      summary.body.marginStart = 12
      summary.body.marginEnd = 12
    })
    squeeze.on('unapply', () => {
      switcher.setVisible(true)
      switcherBar.reveal = false
      summary.grid.columnSpacing = 28
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
