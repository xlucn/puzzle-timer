/*
 * timesList.ts — the sidebar's solve list.
 *
 * Component module (see timerLabel.ts): the top level only defines exports —
 * this module owns no CSS: the platform's own hierarchy (Time at default size
 * in full foreground, the averages at the same size but dimmed (`dim-label`),
 * the # index smaller (`caption`), tabular figures via `numeric`) is
 * reasonable enough on its own.
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
 * The list follows the *active* session (src/core/sessionLibrary.ts). Rows
 * still key on ids, but ids are only unique within one session — so a switch
 * re-points `current` and rebuilds wholesale rather than trying to diff two
 * sessions' rows together.
 *
 * The sidebar carries the app's top chrome too — a HeaderBar with the app
 * name and the app menu, and under it a row with the session switch button
 * (src/ui/sessionMenu.ts) that names the list below. The app menu is the
 * app's one menu: Statistics, then Preferences / About / Keyboard Shortcuts /
 * Quit. The content header keeps the timer's controls: sidebar toggle,
 * type title/button, refresh, and the image toggle.
 *
 * Interaction: clicking a row selects it (Shift/Ctrl-click builds a
 * selection, as GTK does for any multi-selection list), and a toolbar under
 * the list — a stock Gtk.ActionBar, the bottom bar Warehouse and other
 * libadwaita apps hang under a list — slides in to show the selection and
 * the buttons that act on it (Edit, Delete). The Delete key travels the same
 * `deleteSelected()` path as the button, so the two can never drift apart,
 * and deleting several rows at once is one undo toast for the lot.
 *
 * A solve is graded through *one* edit dialog — penalty (OK / +2 / DNF) and
 * comment together, never as separate buttons — opened three ways: the
 * footer's Edit button (exactly one row selected), a double-click on a row,
 * or Ctrl+E (the selection when exactly one row is on it, else the newest
 * solve). The keybinding is the test path — see the no-mouse-clicks rule in
 * AGENTS.md.
 */
import Adw from 'gi:Adw-1'
import Gdk from 'gi:Gdk-4.0'
import GLib from 'gi:GLib-2.0'
import Gtk from 'gi:Gtk-4.0'
import Pango from 'gi:Pango-1.0'

import { MAX_COMMENT_LENGTH, type Session, type Solve } from '../core/session.js'
import type { SessionLibrary } from '../core/sessionLibrary.js'
import { effectiveTimes, windowAtEach } from '../core/stats.js'
import { type Penalty, formatAverage, formatFullTimestamp, formatSolve } from '../core/time.js'

/*
 * The `gi:*` shims export a *value* namespace only (AGENTS.md), so widget
 * types come from InstanceType — this module only *places* the chrome it is
 * handed, so the base Widget type says enough.
 */
type Widget = InstanceType<typeof Gtk.Widget>

/*
 * `Adw.ApplicationWindow` as a type (the shims export values only) — the
 * toplevel the comment dialog is presented on.
 */
type Window = InstanceType<typeof Adw.ApplicationWindow>

// A scramble longer than this becomes an ExpanderRow instead of a plain
// row. Measured through cstimer_module: 555wca tops out at 198 chars in
// five samples — the tall row that still read fine — while 666wca starts at
// 269, 777wca at 355 and the 234567 relay runs 943–1072, i.e. 17 to 19
// wrapped lines, which would push the dialog off any window. 200 keeps
// everything already seen as it was.
const EXPAND_SCRAMBLE_ABOVE = 200

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
  /** The app's one menu — Statistics, then Preferences / About / Shortcuts / Quit — at the header's end. */
  appMenu: Widget
  /** The session switch button; a row between the header and the list. */
  sessionControl: Widget
  /** Toplevel the comment dialog is presented on. */
  window: Window
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
      // left-align to sit directly under their headers. Right-aligned values
      // would strand the header.
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
    // what made hardcoded widths static. Verified by
    // tools/colview_probe.mjs (short content 136px → long content 168px,
    // explicit width overrides content). Not resizable: GTK's drag is a raw
    // 1:1 pointer gesture with no sensitivity setting, which felt jumpy on
    // narrow columns — this list is a log, not a spreadsheet; content-fit
    // plus tabular figures keeps it stable.
    column.setResizable(false)
    return column
  }

  /**
   * ao5/ao12 **as of** each solve, keyed by id — filled by `rebuild()`, which
   * the session calls for every kind of change (append, penalty, comment,
   * delete, switch), so a row is never painted against averages from before
   * it. Computed there because it is a property of the whole run: one pass
   * over the session, not one per cell (the ColumnView only builds the rows
   * on screen, but a bind still runs for each of them on every repaint).
   */
  let trailing: Map<number, { ao5: number; ao12: number }> = new Map()

  const indexColumn = makeColumn('#', ['caption', 'dim-label', 'numeric'], (solve) => String(current.indexOf(solve.id) + 1))
  // formatSolve, not formatTime: the raw centiseconds with the penalty
  // suffix ("14.34+") or a bare "DNF" — csTimer's `pretty()` parity, so the
  // list shows what the solve actually scored.
  // Default weight/size; the averages share it and differ only by dim-label,
  // the index is smaller via caption — the platform's hierarchy again.
  const timeColumn = makeColumn('Time', ['numeric'], (solve) => formatSolve(solve.timeMs, solve.penalty))
  // The averages beside their own solve: the window *ending* there, so the
  // column reads as the history of the run instead of repeating today's
  // number on every row. Incomplete window (fewer solves than the average
  // needs) is an em dash — the same rule as the strip under the timer, never
  // a partial average (src/core/stats.ts: NaN means "not yet").
  const average = (solve: Solve, kind: 'ao5' | 'ao12'): string => {
    const value = trailing.get(solve.id)?.[kind]
    return value === undefined || Number.isNaN(value) ? '—' : formatAverage(value)
  }
  // Hierarchy: see the module header — same default size, brightness only.
  const ao5Column = makeColumn('ao5', ['dim-label', 'numeric'], (solve) => average(solve, 'ao5'))
  const ao12Column = makeColumn('ao12', ['dim-label', 'numeric'], (solve) => average(solve, 'ao12'))
  // Time and the averages expand: GTK splits the *extra* width equally between
  // them, so the columns span the whole sidebar instead of clumping left.
  // `#` deliberately does not — it is a digit column and an equal share of
  // the slack (100+ px for one glyph) buys nothing; it keeps its
  // content-fit floor and grows on its own when the ids reach 2-3 digits.
  timeColumn.setExpand(true)
  ao5Column.setExpand(true)
  ao12Column.setExpand(true)
  view.appendColumn(indexColumn)
  view.appendColumn(timeColumn)
  view.appendColumn(ao5Column)
  view.appendColumn(ao12Column)

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
  // The app name and the app menu are this sidebar's header (the app's
  // "where am I" column starts with the app itself). Window controls are not
  // here — GTK puts those in the content header, the first HeaderBar in the
  // toplevel, which is where they stay.
  const title = new Adw.WindowTitle({ title: options.appName, subtitle: '' })
  const header = new Adw.HeaderBar({ titleWidget: title, showTitle: true })
  header.packEnd(options.appMenu)

  // The session switch labels the list below it, so it sits between header
  // and list as a full-width flat row. The margins keep the hover highlight
  // off the sidebar's edges.
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
  //
  // Two buttons, not a battery: grading (+2, DNF, comment) lives in the one
  // edit dialog behind Edit; Delete is the only other thing a row can ask
  // for. Edit needs exactly one row — one record, one dialog — and says so
  // by going insensitive over a multi-selection rather than by hiding (the
  // row must not shift under the pointer).
  const footerInfo = new Gtk.Label({
    xalign: 0,
    hexpand: true,
    cssClasses: ['dim-label'],
    // The label is context, not data: shrink it (with an ellipsis) rather
    // than squeeze the buttons when the sidebar is narrow.
    ellipsize: Pango.EllipsizeMode.END,
  })

  const editButton = new Gtk.Button({
    tooltipText: 'Edit the selected solve — penalty and comment (Ctrl+E)',
  })
  editButton.setChild(
    new Adw.ButtonContent({ iconName: 'document-edit-symbolic', label: 'Edit' }),
  )
  editButton.on('clicked', () => {
    const solve = singleSelected()
    if (solve !== null) openEdit(solve)
  })

  const deleteButton = new Gtk.Button({
    // Icon-only: the trash is unambiguous, and the label's ~45px is what
    // lets the info label show "#12 · 3.35+" in full instead of "#12 …".
    iconName: 'user-trash-symbolic',
    tooltipText: 'Delete the selected solve(s) (Delete)',
  })
  deleteButton.on('clicked', () => deleteSelected())

  const footerRow = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 6,
    hexpand: true,
  })
  footerRow.append(footerInfo)
  footerRow.append(editButton)
  footerRow.append(deleteButton)

  const footer = new Gtk.ActionBar({ revealed: false })
  footer.setCenterWidget(footerRow)

  // The sidebar as a ToolbarView: header → top bar, ActionBar → bottom bar —
  // both are first-class bar kinds in adw-toolbar-view.c, whose docs say
  // "windows with sidebars should always use this style" (FLAT by default,
  // so the bars render as they would in a plain box). What it buys: the
  // footer is pinned by the container instead of leaning on the scroller's
  // vexpand, revealTopBars/revealBottomBars become available the way the
  // content side already uses them, and the sidebar matches the main
  // content's structure. The session row stays *content* — it labels the
  // list, so it must not leave with the header — and the `sidebar` class
  // moves to this root: its rules match descendants, so the list keeps them.
  const widget = new Adw.ToolbarView({ cssClasses: ['sidebar'] })
  widget.addTopBar(header)
  const body = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
  body.append(sessionRow)
  body.append(scroller)
  body.append(empty)
  widget.content = body
  widget.addBottomBar(footer)

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

  /** The one selected solve — null unless exactly one row is on it. */
  const singleSelected = (): Solve | null => {
    const solves = selectedSolves()
    return solves.length === 1 ? solves[0] : null
  }

  /**
   * The edit dialog: penalty (OK / +2 / DNF) and comment in one form — the
   * only way to grade a solve, opened from the footer's Edit button, a
   * double-click on the row, or Ctrl+E. A normal dialog with a header bar:
   * the bar carries the title — "Edit solve #id" — a suggested Save packed
   * at its left, and — for free, from AdwDialog's header integration — the
   * close button that, exactly like Escape, discards; only Save ever writes.
   * Above the card the scored time stands as a centered number (title-1)
   * that follows the penalty toggle live — the effective time, DNF reading
   * "DNF(solved time)" — and the rows are one libadwaita list: the Date row
   * first — stamp as subtitle, `property`-classed so the value is the
   * emphasized half rather than the title, stamp copyable — then the
   * scramble: a plain row below EXPAND_SCRAMBLE_ABOVE, an ExpanderRow above
   * it (one ellipsized line collapsed, the full text in a bounded scroller
   * when expanded), either way with a copy of this solve's scramble; the
   * penalty ActionRow below the scramble, and the comment EntryRow last,
   * whose title is the placeholder and whose text is capped at
   * MAX_COMMENT_LENGTH in the widget as well as on the save path; saving an
   * empty comment clears it — that is what "no comment" should cost. The
   * session is captured at open: switching sessions while the dialog sits
   * there must not retarget the write onto a different session's solve.
   */
  const openEdit = (solve: Solve): void => {
    const session = current
    // The solve's number lives in the dialog title — "Edit solve #id" — the
    // scored time on the line above the list, and the moment is the Date row
    // below.
    const solveNumber = session.indexOf(solve.id) + 1
    const datetime = formatFullTimestamp(solve.createdAtMs)
    // What the big number reads for a given penalty: the effective time per
    // formatSolve — and DNF keeps the solved time in view as "DNF(12.34)".
    // Used at open and re-read on every step of the toggle, so the number
    // always matches the group.
    const timeText = (penalty: Penalty | undefined): string =>
      penalty === 'dnf' ? `DNF(${formatSolve(solve.timeMs)})` : formatSolve(solve.timeMs, penalty)

    // A segmented control, not a dropdown and not a radio group: OK / +2 /
    // DNF are all three visible at a glance and one click away, and
    // Adw.ToggleGroup owns the single-selection rule; each choice is an
    // Adw.Toggle addressed by *name*, so the save path survives a reordering
    // of the three. The group keeps its natural width as the ActionRow's
    // suffix — the row's halign is what fills the row, not an hexpand on the
    // group — and valign: CENTER is the same choice in height: GTK's default
    // is fill, which would hand the group the row's height instead of its
    // own. The labels keep their mnemonics (Alt+O / Alt+2 / Alt+D —
    // useUnderline reaches the group's internal GtkButtons,
    // adw-toggle-group.c) so the penalty can also be switched by key: the
    // test path (AGENTS.md: never aim a mouse at it).
    const penaltyGroup = new Adw.ToggleGroup({ valign: Gtk.Align.CENTER })
    penaltyGroup.add(new Adw.Toggle({ label: '_OK', name: 'ok', useUnderline: true }))
    penaltyGroup.add(new Adw.Toggle({ label: '+_2', name: 'plus2', useUnderline: true }))
    penaltyGroup.add(new Adw.Toggle({ label: '_DNF', name: 'dnf', useUnderline: true }))
    // Toggles first, selection second: naming a toggle the group does not
    // hold yet sets nothing (adw-toggle-group.c), and solve.penalty's values
    // are the toggle names by construction ('plus2' | 'dnf' | undefined→'ok').
    penaltyGroup.activeName = solve.penalty ?? 'ok'
    // Read back by name, not index — the group's order is not the save
    // format's business, and 'ok' (no penalty) is the absence of a name
    // match just as it was the absence of a checked radio. Shared by the
    // save path and the live time label.
    const penaltyFromGroup = (): Penalty | undefined => {
      const activeName = penaltyGroup.getActiveName()
      return activeName === 'plus2' || activeName === 'dnf' ? activeName : undefined
    }
    const penaltyRow = new Adw.ActionRow({ title: 'Penalty', halign: Gtk.Align.FILL })
    penaltyRow.addSuffix(penaltyGroup)

    // Single-line, in the same list as the penalty: the row's title doubles
    // as its placeholder, and maxLength caps the text natively. Setting
    // .text truncates a hand-edited over-long comment at the cap, so the
    // save path keeps its slice as the read-side guard.
    // Deliberately NO activatesDefault: Enter in the comment must not
    // save-and-close the dialog — only the Save button does that. The
    // internal text never carries activates-default (adw-entry-row.ui
    // doesn't set it), so the row's property is the sole gate — dropping it
    // disconnects Return from the dialog's default completely; the text
    // widget consumes Return itself.
    const commentRow = new Adw.EntryRow({
      title: 'Comment',
      text: solve.comment ?? '',
      maxLength: MAX_COMMENT_LENGTH,
    })
    // The clipboard path is the header copy button's verbatim (main.ts):
    // Gdk's set_text is unintrospectable, so the text goes as bytes under a
    // content provider. Both row copies — the stamp and the scramble — go
    // through this one writer.
    const copyToClipboard = (text: string): void => {
      const bytes = GLib.Bytes.new(Array.from(new TextEncoder().encode(text)))
      options.window
        .getDisplay()
        .getClipboard()
        .setContent(Gdk.ContentProvider.newForBytes('text/plain;charset=utf-8', bytes))
    }
    // The suffix both copies share: same icon and flat look, valign CENTER
    // so the button stays compact and centers itself against a wrapped
    // subtitle's height.
    const copySuffix = (text: string, tooltipText: string) => {
      const button = new Gtk.Button({
        iconName: 'edit-copy-symbolic',
        tooltipText,
        cssClasses: ['flat'],
        valign: Gtk.Align.CENTER,
      })
      button.on('clicked', () => copyToClipboard(text))
      return button
    }

    // The scramble as a row before the comment — still shown, not editable:
    // it is history, and knowing which scramble a bad time was on is half of
    // what a comment is for. The row carries a copy of *this solve's*
    // scramble. Above EXPAND_SCRAMBLE_ABOVE the row becomes an ExpanderRow:
    // collapsed shows one ellipsized line — subtitleLines: 1, libadwaita's
    // native cap — and expanding reveals the whole scramble in a bounded
    // scroller, so the dialog grows by 160px on demand instead of by a
    // relay's 17 lines. The `property` class cannot follow it in: its
    // selectors need box.header directly on the row and the expander nests
    // its header, so the collapsed subtitle keeps Adwaita's dim preview
    // styling. The copy suffix stays either way — it always carries the full
    // text. Omitted entirely when a solve has none.
    const scrambleRow = (() => {
      if (solve.scramble.length === 0) return null

      if (solve.scramble.length <= EXPAND_SCRAMBLE_ABOVE) {
        const row = new Adw.ActionRow({
          title: 'Scramble',
          subtitle: solve.scramble,
          halign: Gtk.Align.FILL,
          cssClasses: ['property'],
        })
        row.addSuffix(copySuffix(solve.scramble, 'Copy the scramble'))
        return row
      }

      const row = new Adw.ExpanderRow({
        title: 'Scramble',
        subtitle: solve.scramble,
        subtitleLines: 1,
        halign: Gtk.Align.FILL,
      })
      row.addSuffix(copySuffix(solve.scramble, 'Copy the scramble'))
      row.addRow(
        new Gtk.ListBoxRow({
          child: new Gtk.ScrolledWindow({
            // Bounded on purpose: ~9 lines — a whole 7x7 (≤365 chars)
            // fits without scrolling, the 234567 relay scrolls — and the
            // dialog grows by at most this when the row expands.
            heightRequest: 160,
            child: new Gtk.Label({
              label: solve.scramble,
              wrap: true,
              xalign: 0,
              marginStart: 12,
              marginEnd: 12,
              marginTop: 6,
              marginBottom: 6,
            }),
          }),
        }),
      )
      return row
    })()

    // The moment as the list's first row: title "Date", subtitle the value,
    // and the stamp gets the same copy suffix. The `property` class is
    // Adwaita's label/value row — it shrinks and dims the title while
    // restoring the subtitle to full size and opacity, so the value is the
    // emphasized half instead of the title (adw stylesheet: row.property >
    // … > .title / .subtitle). halign FILL, as on the penalty row: the row
    // spans the card.
    const dateRow = new Adw.ActionRow({
      title: 'Date',
      subtitle: datetime,
      halign: Gtk.Align.FILL,
      cssClasses: ['property'],
    })
    dateRow.addSuffix(copySuffix(datetime, 'Copy the date'))

    // The rows live in one list: the native libadwaita form — ActionRow and
    // EntryRow are both Gtk.ListBoxRows — the display-only Date and Scramble
    // rows first (each with its copy suffix), then the penalty below the
    // scramble and the comment last: what you *do* sits under what you read.
    // `boxed-list` draws the card it sits in (background, 12px corners, row
    // rules — the picker's list has the same class); `list` alone would be
    // only GtkListBox's CSS node, which every list already is. Selection is
    // off: rows are controls here, not selectable items.
    const formList = new Gtk.ListBox({
      cssClasses: ['boxed-list'],
      selectionMode: Gtk.SelectionMode.NONE,
    })
    formList.append(dateRow)
    if (scrambleRow !== null) formList.append(scrambleRow)
    formList.append(penaltyRow)
    formList.append(commentRow)

    // The scored time, centered over the card: title-1 — Adwaita's largest
    // built-in heading (~26px, weight 800), so no custom styles — with
    // `numeric` keeping the digits tabular as the number changes. The
    // solve's number is in the title and the moment in the Date row; this
    // is the record's headline. It follows the penalty toggle live: the
    // number is always the *effective* time of the penalty on screen —
    // DNF reading "DNF(solved time)".
    const timeLabel = new Gtk.Label({
      label: timeText(solve.penalty),
      halign: Gtk.Align.CENTER,
      cssClasses: ['title-1', 'numeric'],
    })
    // set_active_toggle notifies `active` on every selection change
    // (adw-toggle-group.c) — click or programmatic, one hook covers both,
    // and the mapping is name-based like the save path's.
    penaltyGroup.on('notify::active', () => {
      timeLabel.label = timeText(penaltyFromGroup())
    })

    // 12px around the boxed list — the same inset the type picker's list
    // has (AGENTS.md): the frame floats inside the dialog instead of
    // touching its edge. 6px on top, where the header bar already supplies
    // the rest of the gap.
    const form = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 12,
      marginStart: 12,
      marginEnd: 12,
      marginTop: 6,
      marginBottom: 12,
    })
    form.append(timeLabel)
    form.append(formList)

    // Save at the left of the header bar, suggested. Adw.HeaderBar adds the
    // dialog close button at the right for free, and Escape closes through
    // adw-dialog.c's own shortcut — both discard; the button below is the
    // only writer.
    const saveButton = new Gtk.Button({
      label: 'Save',
      cssClasses: ['suggested-action'],
    })
    const header = new Adw.HeaderBar()
    header.packStart(saveButton)

    const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
    box.append(header)
    box.append(form)

    const dialog = new Adw.Dialog({
      // A plain HeaderBar picks the dialog's title up itself when it roots
      // (adw-header-bar.c: update_title reads adw_dialog_get_title), so the
      // string lives here and nowhere else — the solve's number included.
      title: `Edit solve #${solveNumber}`,
      child: box,
      // Fixed width, as the stats dialog's: the scramble row's subtitle
      // wraps, but a GtkLabel's natural width is its text on one line —
      // uncapped, a long scramble would stretch the dialog across the
      // screen.
      contentWidth: 480,
      // Deliberately no focusWidget: the dialog opens without grabbing the
      // comment line — Tab or Alt+O/2/D gets you there when you want it.
      // (An AdwAlertDialog's default response button claims focus on map,
      // which is what needed a claim-dance once; a plain AdwDialog has no
      // response button.)
      // defaultWidget stays so Return still resolves to Save from *outside*
      // the comment entry (the dialog's own binding) — with focus on Save,
      // the button focused at open, Enter presses that very button. The
      // comment row does not route Enter here: only the save button closes
      // the dialog.
      defaultWidget: saveButton,
    })
    saveButton.on('clicked', () => {
      session.setPenalty(solve.id, penaltyFromGroup())
      // getText over the .text property: same string, clearer intent. The
      // trim is the real filter — an empty comment means "no comment" — and
      // the slice is the read-side guard under MAX_COMMENT_LENGTH.
      const text = commentRow.getText().trim().slice(0, MAX_COMMENT_LENGTH)
      session.setComment(solve.id, text.length > 0 ? text : undefined)
      dialog.close()
    })
    dialog.present(options.window)
  }

  /**
   * The dialog's keyboard path (Ctrl+E, wired by main.ts): the selection
   * when exactly one row is on it, else the newest solve. False when the
   * session is empty.
   */
  const editSelected = (): boolean => {
    const single = singleSelected()
    const solves = current.solves
    const solve = single ?? (solves.length > 0 ? solves[solves.length - 1] : null)
    if (solve === null) return false
    openEdit(solve)
    return true
  }

  // The third way in: double-click a row to edit it. This is
  // GtkColumnView's own activation — rows activate on double click while
  // single-click-activate is off (the default) — so the first click's
  // selection, the footer, and the dialog all agree on the record.
  view.on('activate', (position) => {
    if (position >= model.nItems) return // GTK_INVALID_LIST_POSITION
    const solve = current.find(Number(model.getString(position)))
    if (solve !== undefined) openEdit(solve)
  })

  /** Reflect the current selection in the footer toolbar. */
  const syncFooter = () => {
    const solves = selectedSolves()
    const hasSelection = solves.length > 0
    footer.setRevealed(hasSelection)
    // Belt and braces (Warehouse binds the same way): while the bar is
    // collapsed its button must not be able to take keyboard focus.
    footerRow.setSensitive(hasSelection)
    // The row's own flag narrows the whole bar further: one edit dialog,
    // one record (set after the row's flag — a child's own sensitivity only
    // ever restricts, never lifts, what its parents allow).
    editButton.setSensitive(solves.length === 1)
    if (!hasSelection) return
    footerInfo.setLabel(
      solves.length === 1
        ? `#${current.indexOf(solves[0].id) + 1}  ·  ${formatSolve(solves[0].timeMs, solves[0].penalty)}`
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
    // The averages are a property of the whole run in order: session solves
    // are oldest → newest, which is exactly the order windowAtEach wants, so
    // solve i reads the ao5/ao12 that ended with it.
    const scored = effectiveTimes(solves)
    const ao5 = windowAtEach(scored, 'ao5')
    const ao12 = windowAtEach(scored, 'ao12')
    trailing = new Map(
      solves.map((solve, index) => [solve.id, { ao5: ao5[index], ao12: ao12[index] }]),
    )
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
    /** Open the edit dialog on the selected (or newest) solve. */
    editSelected,
  }
}
