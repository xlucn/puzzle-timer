/*
 * statsPanel.ts — the Statistics dialog behind the app-functions menu (M4).
 *
 * The full table the strip under the timer deliberately leaves out (user
 * call, 2026-10-01): current / best / PB target per record — Single, mo3,
 * ao5, ao12 — plus the session mean with its DNF count. Every number comes
 * from src/core/stats.ts, computed on the effective (penalised) times, so
 * this view and the strip cannot disagree.
 *
 * Layout note (probed 2026-10-01 against libadwaita 1.9.4): an Adw.Dialog
 * does NOT render its own title or close button — only `child`. So the
 * content carries its own Adw.HeaderBar for the title and a Close button at
 * the end; Escape closes the dialog on top of that (Adw.Dialog default).
 *
 * The figures are computed when the dialog opens: it blocks input to the
 * window behind it, so nothing can change while it is on screen.
 */
import Adw from 'gi:Adw-1'
import Gio from 'gi:Gio-2.0'
import Gtk from 'gi:Gtk-4.0'

import { styles } from 'node-gtk/styles'

import type { Session } from '../core/session.js'
import type { SessionLibrary } from '../core/sessionLibrary.js'
import { type PbTarget, type StatKind, sessionStats } from '../core/stats.js'
import { formatAverage, formatSolve, formatTime } from '../core/time.js'

/*
 * The `gi:*` shims export a *value* namespace only (AGENTS.md), so widget
 * types come from InstanceType.
 */
type Application = InstanceType<typeof Adw.Application>
type Window = InstanceType<typeof Adw.ApplicationWindow>

// Dimming goes through alpha(@window_fg_color) (GTK3's @dim_label does not
// exist in GTK4); tabular figures keep the value columns from jittering.
styles.add(`
  .stats-col-head,
  .stats-caption {
    font-size: 13px;
    color: alpha(@window_fg_color, 0.55);
  }
  .stats-name {
    font-size: 15px;
  }
  .stats-cell {
    font-size: 15px;
    font-weight: 600;
    font-feature-settings: "tnum" 1;
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
  /** Only used for the dialog's subtitle (the session's name). */
  library: SessionLibrary
  /** The session to read; called live, like every other session reader. */
  getSession: () => Session
}

/** Row order — records from shortest window to longest, single first. */
const ROWS: { kind: StatKind; name: string }[] = [
  { kind: 'single', name: 'Single' },
  { kind: 'mo3', name: 'mo3' },
  { kind: 'ao5', name: 'ao5' },
  { kind: 'ao12', name: 'ao12' },
]

export function createStatsPanel(options: StatsPanelOptions) {
  /** Target column text: a tick time, "Any", or the dimmed em dash. */
  const targetText = (target: PbTarget): string => {
    switch (target.kind) {
      case 'value':
        return formatTime(target.ms)
      case 'always':
        return 'Any'
      case 'never':
      case 'none':
        return '—'
    }
  }

  const buildDialog = () => {
    const session = options.getSession()
    const stats = sessionStats(session.solves)
    const total = session.size

    /** One grid cell; `dim` is for every "not available yet" dash. */
    const cell = (text: string, classes: string[]) =>
      new Gtk.Label({ label: text, cssClasses: classes, xalign: 0 })

    const grid = new Gtk.Grid({ columnSpacing: 28, rowSpacing: 8 })
    const attach = (col: number, row: number, widget: ReturnType<typeof cell>) => {
      grid.attach(widget, col, row, 1, 1)
    }

    // ---- header ----------------------------------------------------------
    attach(0, 0, cell('', ['stats-col-head']))
    attach(1, 0, cell('Current', ['stats-col-head']))
    attach(2, 0, cell('Best', ['stats-col-head']))
    attach(3, 0, cell('Target', ['stats-col-head']))

    // ---- one row per record ----------------------------------------------
    ROWS.forEach(({ kind, name }, index) => {
      const row = index + 1

      let current: string
      if (kind === 'single') {
        const last = session.solves[total - 1]
        current = last === undefined ? '—' : formatSolve(last.timeMs, last.penalty)
      } else {
        current = Number.isNaN(stats.current[kind]) ? '—' : formatAverage(stats.current[kind])
      }

      const best = stats.best[kind] === null ? '—' : formatAverage(stats.best[kind]!.value)
      const target = targetText(stats.target[kind])

      attach(0, row, cell(name, ['stats-name']))
      attach(1, row, cell(current, current === '—' ? ['stats-cell', 'incomplete'] : ['stats-cell']))
      attach(2, row, cell(best, best === '—' ? ['stats-cell', 'incomplete'] : ['stats-cell']))
      attach(3, row, cell(target, target === '—' ? ['stats-cell', 'incomplete'] : ['stats-cell']))
    })

    // ---- mean -------------------------------------------------------------
    const { mean, dnfCount, count } = stats.mean
    const meanValue = total === 0 ? '—' : formatAverage(mean)
    const caption =
      total === 0
        ? 'No solves yet'
        : dnfCount === 0
          ? `${total} solve${total === 1 ? '' : 's'}`
          : `${count} of ${total} counted · ${dnfCount} DNF${dnfCount === 1 ? '' : 's'}`

    const meanRow = ROWS.length + 1
    attach(0, meanRow, cell('Session mean', ['stats-name']))
    attach(1, meanRow, cell(meanValue, meanValue === '—' ? ['stats-cell', 'incomplete'] : ['stats-cell']))
    const captionLabel = cell(caption, ['stats-caption'])
    grid.attach(captionLabel, 2, meanRow, 2, 1)

    // ---- frame ------------------------------------------------------------
    const content = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      marginStart: 24,
      marginEnd: 24,
      marginBottom: 18,
    })
    content.append(grid)

    const closeButton = new Gtk.Button({ label: 'Close' })
    closeButton.on('clicked', () => dialog.close())
    const buttonRow = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      halign: Gtk.Align.END,
      marginTop: 18,
    })
    buttonRow.append(closeButton)
    content.append(buttonRow)

    const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
    box.append(
      new Adw.HeaderBar({
        titleWidget: new Adw.WindowTitle({
          title: 'Statistics',
          subtitle: options.library.active.name,
        }),
        showTitle: true,
      }),
    )
    box.append(content)

    const dialog = new Adw.Dialog({ child: box, followsContentSize: true })
    dialog.present(options.window)
  }

  const action = Gio.SimpleAction.new('statistics', null)
  action.on('activate', () => buildDialog())
  options.app.addAction(action)

  return { open: buildDialog }
}
