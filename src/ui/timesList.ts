/*
 * timesList.ts — the sidebar's solve list.
 *
 * Component module (see timerLabel.ts): the top level only registers styles
 * and defines exports, so `styles.add()` hot-reloads the CSS below under
 * `npm run dev`.
 *
 * Gtk.ColumnView, not Gtk.ListBox (AGENTS.md): a session reaches thousands of
 * solves and ColumnView only builds the rows actually on screen.
 *
 * The model is a Gtk.StringList of solve *ids*, newest first. The cells read
 * their text from the session in `bind`, so rows are keyed on stable identity
 * rather than array position — a delete (and the undo toast that follows it)
 * can then never point at the wrong solve. Every change rebuilds the id list
 * in one `splice()`; that is one items-changed emission and ~n string copies,
 * which is nothing next to the widget work, and it keeps a single code path
 * for add / delete / restore.
 *
 * M3: the list follows the *active* session (src/core/sessionLibrary.ts).
 * Rows still key on ids, but ids are only unique within one session — so a
 * switch re-points `current` and rebuilds wholesale rather than trying to
 * diff two sessions' rows together.
 *
 * Layout F (2026-10-01): this sidebar carries the app's top chrome too —
 * a HeaderBar with the app name and the app menu (About / Keyboard
 * Shortcuts / Quit), and under it a row with the session switch button
 * (src/ui/sessionMenu.ts) that names the list below. The content header
 * keeps the timer's controls: sidebar toggle, category/type switchers,
 * refresh, and the (currently empty) app-functions menu.
 *
 * Interaction: clicking a row selects it (Shift/Ctrl-click builds a
 * selection, as GTK does for any multi-selection list), and a toolbar under
 * the list — a stock Gtk.ActionBar, the bottom bar Warehouse and other
 * libadwaita apps hang under a list — slides in to show the selection and
 * the buttons that act on it (Delete today; the edit / penalty buttons land
 * with M4 and go in the same row). The Delete key travels the same
 * `deleteSelected()` path as the button, so the two can never drift apart,
 * and deleting several rows at once is one undo toast for the lot.
 */
import Adw from 'gi:Adw-1'
import Gtk from 'gi:Gtk-4.0'

import { styles } from 'node-gtk/styles'

import type { Session, Solve } from '../core/session.js'
import type { SessionLibrary } from '../core/sessionLibrary.js'
import { formatTime, formatTimestamp } from '../core/time.js'

// Dimming goes through alpha(@window_fg_color): GTK3's @dim_label_color does
// not exist in GTK4 and silently renders white (see the risk table in PLAN.md).
styles.add(`
  .solve-index,
  .solve-clock {
    font-size: 13px;
    color: alpha(@window_fg_color, 0.55);
  }
  .solve-time {
    font-size: 14px;
    font-weight: 600;
    /* Tabular figures stop the digits jittering as times change width. */
    font-feature-settings: "tnum" 1;
  }
  /* The footer needs no CSS: Gtk.ActionBar carries its own chrome. */
`)

/*
 * The `gi:*` shims export a *value* namespace only (AGENTS.md), so widget
 * types come from InstanceType — this module only *places* the chrome it is
 * handed, so the base Widget type says enough.
 */
type Widget = InstanceType<typeof Gtk.Widget>

export interface TimesListOptions {
  /** Whose session is on show: the sidebar always follows the active one. */
  library: SessionLibrary
  /**
   * The session to read. Called live — not captured once — because a switch
   * hands the list a different Session with different solves.
   */
  getSession: () => Session
  /**
   * Called with every selected solve when the user asks to delete them —
   * one call for the whole selection, so the caller can offer one undo for
   * the batch instead of a queue of toasts.
   */
  onDelete: (solves: readonly Solve[]) => void
  /** App name, shown as the sidebar header's title. */
  appName: string
  /** The app menu (About / Keyboard Shortcuts / Quit), at the header's end. */
  appMenu: Widget
  /** The session switch button; a row between the header and the list. */
  sessionControl: Widget
}

/**
 * Build the solve sidebar. The return type is inferred: the `gi:*` shims
 * expose GTK as a value namespace, so widget types come from inference.
 */
export function createTimesList(options: TimesListOptions) {
  /** The session every row reads from; re-pointed by the library listener. */
  let current = options.getSession()

  // ---- model + view ------------------------------------------------------
  const model = Gtk.StringList.new([])
  // Multi-select: cleaning up a run of mis-solves is the common case, so the
  // toolbar has to be able to act on more than one row. GTK supplies the
  // interaction itself — click replaces the selection, Shift/Ctrl-click
  // extends it — and the list starts with nothing selected: it is a log, not
  // a form.
  const selection = Gtk.MultiSelection.new(model)

  const view = Gtk.ColumnView.new(selection)
  view.setShowRowSeparators(true)

  /** One column: a factory that paints `text(solve)` into a single label. */
  const makeColumn = (title: string, classes: string[], text: (solve: Solve) => string) => {
    const factory = Gtk.SignalListItemFactory.new()

    factory.on('setup', (object) => {
      const cell: any = object
      // xalign: 0 for every column: GTK's ColumnView headers are always
      // left-aligned (no API to change it — probe-verified), so cells
      // left-align to sit directly under their headers (user call,
      // 2026-10-01). Right-aligned values would strand the header.
      cell.setChild(new Gtk.Label({ xalign: 0, hexpand: true }))
    })

    factory.on('bind', (object) => {
      const cell: any = object
      const label: any = cell.getChild()
      if (label === null) return

      const position = cell.getPosition()
      if (position >= model.nItems) return // GTK_INVALID_LIST_POSITION
      const solve = current.find(Number(model.getString(position)))
      if (solve === undefined) return

      label.setLabel(text(solve))
      label.setCssClasses(classes)
    })

    factory.on('teardown', (object) => {
      const cell: any = object
      cell.setChild(null)
    })

    const column = Gtk.ColumnViewColumn.new(title, factory)
    // No setFixedWidth() on purpose: the default (-1) is GTK's native
    // "size to content" — an explicit width is used "regardless of the size
    // of its content" (GtkColumnViewColumn:fixed-width), which is exactly
    // what made the old hardcoded widths static. Verified by
    // tools/colview_probe.mjs (short content 136px → long content 168px,
    // explicit width overrides content). Not resizable: GTK's drag is a raw
    // 1:1 pointer gesture with no sensitivity setting, which felt jumpy on
    // narrow columns (user call, 2026-10-01) — this list is a log, not a
    // spreadsheet; content-fit plus tabular figures keeps it stable.
    column.setResizable(false)
    return column
  }

  const indexColumn = makeColumn('#', ['solve-index'], (solve) => String(current.indexOf(solve.id) + 1))
  const timeColumn = makeColumn('Time', ['solve-time'], (solve) => formatTime(solve.timeMs))
  const solvedColumn = makeColumn('Solved', ['solve-clock'], (solve) => formatTimestamp(solve.createdAtMs))
  // Time and Solved expand: GTK splits the *extra* width equally between
  // them, so the columns span the whole sidebar instead of clumping left.
  // `#` deliberately does not — it is a digit column and an equal share of
  // the slack (100+ px for one glyph) buys nothing; it keeps its
  // content-fit floor and grows on its own when the ids reach 2-3 digits.
  timeColumn.setExpand(true)
  solvedColumn.setExpand(true)
  view.appendColumn(indexColumn)
  view.appendColumn(timeColumn)
  view.appendColumn(solvedColumn)

  const scroller = new Gtk.ScrolledWindow({
    child: view,
    hexpand: true,
    vexpand: true,
    hscrollbarPolicy: Gtk.PolicyType.NEVER,
  })

  const empty = new Adw.StatusPage({
    iconName: 'view-list-symbolic',
    title: 'No solves yet',
    description: 'Finish a solve and it will appear here.',
    vexpand: true,
  })

  // ---- sidebar chrome: header, then the session row ----------------------
  // Layout F: the app name and the app menu are this sidebar's header (the
  // app's "where am I" column starts with the app itself). Window controls
  // are not here — GTK puts those in the content header, the first HeaderBar
  // in the toplevel, which is where they stay.
  const title = new Adw.WindowTitle({ title: options.appName, subtitle: '' })
  const header = new Adw.HeaderBar({ titleWidget: title, showTitle: true })
  header.packEnd(options.appMenu)

  // The session switch labels the list below it, so it sits between header
  // and list as a full-width flat row — not as a third header button (user
  // call, layout F, 2026-10-01). The margins keep the hover highlight off
  // the sidebar's edges.
  const sessionRow = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    marginTop: 4,
    marginBottom: 4,
    marginStart: 6,
    marginEnd: 6,
  })
  sessionRow.append(options.sessionControl)

  // ---- footer: the actions available on the selected row -----------------
  // Gtk.ActionBar is the stock GTK4 bottom bar — the one Warehouse and other
  // libadwaita apps hang under a list (there it also arrives as
  // Adw.ToolbarView's [bottom] slot). Adwaita paints its inner box with the
  // headerbar background and a top shade line, and `revealed` collapses the
  // whole bar to nothing, so the toolbar costs list height only while a row
  // is actually selected. With nothing selected there is no record to act on;
  // an always-present row of insensitive buttons would just be dead weight.
  const footerInfo = new Gtk.Label({
    xalign: 0,
    hexpand: true,
    cssClasses: ['dim-label'],
  })

  const deleteButton = new Gtk.Button({
    tooltipText: 'Delete the selected solve (Delete)',
  })
  deleteButton.setChild(
    new Adw.ButtonContent({ iconName: 'user-trash-symbolic', label: 'Delete' }),
  )
  deleteButton.on('clicked', () => deleteSelected())

  // M4: the edit / +2 / DNF buttons pack into this same row.

  const footerRow = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 6,
    hexpand: true,
  })
  footerRow.append(footerInfo)
  footerRow.append(deleteButton)

  const footer = new Gtk.ActionBar({ revealed: false })
  footer.setCenterWidget(footerRow)

  const widget = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    cssClasses: ['sidebar'],
  })
  widget.append(header)
  widget.append(sessionRow)
  widget.append(scroller)
  widget.append(empty)
  widget.append(footer)

  // ---- actions -----------------------------------------------------------
  /**
   * Every selected solve, newest first (the order the list is in). A plain
   * position walk rather than BitsetIter: the set is fetched per click, the
   * session is an array, and a GObject round-trip per row is nothing next to
   * the relayout that follows the delete.
   */
  const selectedSolves = (): Solve[] => {
    const solves: Solve[] = []
    for (let position = 0; position < model.nItems; position += 1) {
      if (!selection.isSelected(position)) continue
      const solve = current.find(Number(model.getString(position)))
      if (solve !== undefined) solves.push(solve)
    }
    return solves
  }

  /** Delete the whole selection; false when nothing is selected. */
  const deleteSelected = (): boolean => {
    const solves = selectedSolves()
    if (solves.length === 0) return false
    options.onDelete(solves)
    return true
  }

  deleteButton.on('clicked', () => deleteSelected())

  /** Reflect the current selection in the footer toolbar. */
  const syncFooter = () => {
    const solves = selectedSolves()
    const hasSelection = solves.length > 0
    footer.setRevealed(hasSelection)
    // Belt and braces (Warehouse binds the same way): while the bar is
    // collapsed its button must not be able to take keyboard focus.
    footerRow.setSensitive(hasSelection)
    if (!hasSelection) return
    footerInfo.setLabel(
      solves.length === 1
        ? `#${current.indexOf(solves[0].id) + 1}  ·  ${formatTime(solves[0].timeMs)}`
        : `${solves.length} selected`,
    )
  }

  // MultiSelection has no `selected` property to watch — the selection is a
  // bitset — so the interface's own signal is the change notification.
  // rebuild() calls this again because splicing the model can leave the same
  // positions pointing at different solves without the set itself changing.
  selection.on('selection-changed', syncFooter)

  // ---- rendering ---------------------------------------------------------
  const rebuild = () => {
    const solves = current.solves
    const ids: string[] = []
    for (let i = solves.length - 1; i >= 0; i -= 1) ids.push(String(solves[i].id))
    model.splice(0, model.nItems, ids)
    scroller.setVisible(solves.length > 0)
    empty.setVisible(solves.length === 0)
    syncFooter()
  }

  let unsubscribe = current.subscribe(rebuild)

  // One listener covers every way the list can change direction. A switch
  // hands it a different Session to read — re-point the subscription first,
  // so the old session's changes stop arriving and the new session's start;
  // a rename now lands on the session row's own label and needs nothing
  // here, but the rebuild it triggers is idempotent and cheap. So is a
  // create (which emits created *and* switched): two passes, not two code
  // paths.
  options.library.subscribe(() => {
    const next = options.getSession()
    if (next !== current) {
      unsubscribe()
      current = next
      unsubscribe = current.subscribe(rebuild)
    }
    rebuild()
  })

  rebuild()

  return {
    /** Container to hand to Adw.OverlaySplitView as its sidebar. */
    widget,
    /** Delete the selected row; false when nothing is selected. */
    deleteSelected,
  }
}
