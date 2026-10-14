/*
 * timesList.ts — the sidebar's solve list.
 *
 * Component module (see timerLabel.ts): the top level only defines exports —
 * this module owns no CSS; the platform's own hierarchy (Time in full
 * foreground, averages dimmed via `dim-label`, the # index smaller via
 * `caption`, tabular figures via `numeric`) is enough.
 *
 * Gtk.ColumnView, not Gtk.ListBox (AGENTS.md): sessions reach thousands of
 * solves and ColumnView only builds the rows on screen.
 *
 * The model is a Gtk.StringList of solve *ids*, newest first; cells read
 * their text from the session in `bind`, so rows key on stable identity and
 * a delete (and its undo) can never point at the wrong solve. Every change
 * rebuilds the id list in one `splice()` — one code path for add/delete/
 * restore. A session switch re-points `current` and rebuilds wholesale
 * (ids are only unique within one session).
 *
 * The sidebar carries the app chrome — HeaderBar with the app name and app
 * menu, the session switch row under it, then the list. A Gtk.ActionBar
 * footer slides in on selection (Edit, Delete); Delete travels the same
 * path as the button. Deleting several rows is one undo toast for the lot.
 *
 * A solve is graded through one edit dialog — penalty and comment together —
 * opened from the footer's Edit button, a double-click, or Ctrl+E. The
 * keybinding is the test path — see the no-mouse-clicks rule in AGENTS.md.
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
      // xalign 0 everywhere: ColumnView headers are always left-aligned (no
      // API to change it), so right-aligned values would strand the header.
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
    // No setFixedWidth(): the default (-1) is GTK's native "size to content";
    // an explicit width is used regardless of content, which is what made
    // hardcoded widths static (tools/colview_probe.mjs). Not resizable: GTK's
    // drag is a raw 1:1 gesture with no sensitivity setting — jumpy on
    // narrow columns; content-fit plus tabular figures keeps it stable.
    column.setResizable(false)
    return column
  }

  /**
   * ao5/ao12 **as of** each solve, keyed by id — filled by `rebuild()` on
   * every kind of change, so a row is never painted against averages from
   * before it. One pass over the whole run, not one per cell: a bind still
   * runs per visible row on every repaint.
   */
  let trailing: Map<number, { ao5: number; ao12: number }> = new Map()

  const indexColumn = makeColumn('#', ['caption', 'dim-label', 'numeric'], (solve) => String(current.indexOf(solve.id) + 1))
  // formatSolve, not formatTime: shows what the solve actually scored (the
  // "+" suffix or a bare "DNF").
  const timeColumn = makeColumn('Time', ['numeric'], (solve) => formatSolve(solve.timeMs, solve.penalty))
  // The window *ending* at each solve, so the column reads as the history of
  // the run instead of today's number on every row. Incomplete window: em
  // dash, never a partial average (NaN means "not yet" — core/stats.ts).
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
  // Window controls are not here: GTK puts those in the content header, the
  // first HeaderBar in the toplevel.
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
  // Gtk.ActionBar, `revealed` collapsing it to nothing: the bar costs list
  // height only while a row is selected. Two buttons, not a battery —
  // grading lives in the one edit dialog behind Edit. Edit goes insensitive
  // over a multi-selection rather than hiding (one record, one dialog; the
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
   * The edit dialog: penalty and comment in one form — the only way to grade
   * a solve, opened from the footer's Edit button, a double-click, or Ctrl+E.
   * Close and Escape discard; only Save ever writes. The session is captured
   * at open: switching sessions while the dialog sits there must not retarget
   * the write onto a different session's solve.
   */
  const openEdit = (solve: Solve): void => {
    const session = current
    const solveNumber = session.indexOf(solve.id) + 1
    const datetime = formatFullTimestamp(solve.createdAtMs)
    // The effective time per formatSolve, re-read on every toggle step so
    // the number always matches the group. DNF keeps the solved time in
    // view as "DNF(12.34)".
    const timeText = (penalty: Penalty | undefined): string =>
      penalty === 'dnf' ? `DNF(${formatSolve(solve.timeMs)})` : formatSolve(solve.timeMs, penalty)

    // A segmented control: all three choices visible at a glance, and
    // Adw.ToggleGroup owns the single-selection rule. Each toggle is
    // addressed by *name*, so the save path survives a reordering. valign
    // CENTER: GTK's default (fill) would hand the group the row's height.
    // Mnemonics (Alt+O / Alt+2 / Alt+D) reach the internal GtkButtons —
    // the test path (AGENTS.md: never aim a mouse at it).
    const penaltyGroup = new Adw.ToggleGroup({ valign: Gtk.Align.CENTER })
    penaltyGroup.add(new Adw.Toggle({ label: '_OK', name: 'ok', useUnderline: true }))
    penaltyGroup.add(new Adw.Toggle({ label: '+_2', name: 'plus2', useUnderline: true }))
    penaltyGroup.add(new Adw.Toggle({ label: '_DNF', name: 'dnf', useUnderline: true }))
    // Toggles first, selection second: naming a toggle the group does not
    // hold yet sets nothing (adw-toggle-group.c).
    penaltyGroup.activeName = solve.penalty ?? 'ok'
    // Read back by name, not index; 'ok' (no penalty) is the absence of a
    // name match.
    const penaltyFromGroup = (): Penalty | undefined => {
      const activeName = penaltyGroup.getActiveName()
      return activeName === 'plus2' || activeName === 'dnf' ? activeName : undefined
    }
    const penaltyRow = new Adw.ActionRow({ title: 'Penalty', halign: Gtk.Align.FILL })
    penaltyRow.addSuffix(penaltyGroup)

    // maxLength caps the text natively; the save path keeps its slice as
    // the read-side guard. Deliberately NO activatesDefault: Enter in the
    // comment must not save-and-close — only Save does that (the internal
    // text never carries activates-default, so this property is the sole
    // gate; the text widget consumes Return itself).
    const commentRow = new Adw.EntryRow({
      title: 'Comment',
      text: solve.comment ?? '',
      maxLength: MAX_COMMENT_LENGTH,
    })
    // Same writer as the header copy button (main.ts): `set_text` is
    // unintrospectable, so the clipboard takes a content provider.
    const copyToClipboard = (text: string): void => {
      const bytes = GLib.Bytes.new(Array.from(new TextEncoder().encode(text)))
      options.window
        .getDisplay()
        .getClipboard()
        .setContent(Gdk.ContentProvider.newForBytes('text/plain;charset=utf-8', bytes))
    }
    // Flat copy suffix; valign CENTER keeps it compact against a wrapped
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

    // Display-only history: knowing which scramble a bad time was on is half
    // of what a comment is for. Above EXPAND_SCRAMBLE_ABOVE the row becomes
    // an ExpanderRow — one ellipsized line collapsed, the full text in a
    // bounded scroller when expanded — so the dialog grows by at most 160px
    // on demand. The `property` class cannot follow it in: its selectors
    // need box.header directly on the row and the expander nests its header.
    // Omitted entirely when a solve has none.
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
            // Bounded (~9 lines): a whole 7x7 fits unscrolled, the 234567
            // relay scrolls — and the dialog grows by at most this.
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

    // `property` is Adwaita's label/value row: it dims the title and
    // restores the subtitle to full size, so the value is the emphasized
    // half.
    const dateRow = new Adw.ActionRow({
      title: 'Date',
      subtitle: datetime,
      halign: Gtk.Align.FILL,
      cssClasses: ['property'],
    })
    dateRow.addSuffix(copySuffix(datetime, 'Copy the date'))

    // One libadwaita list: display rows first, controls below — what you
    // *do* sits under what you read. `boxed-list` draws the card (a bare
    // `list` is only GtkListBox's CSS node, which every list already is).
    // Selection off: rows are controls here, not selectable items.
    const formList = new Gtk.ListBox({
      cssClasses: ['boxed-list'],
      selectionMode: Gtk.SelectionMode.NONE,
    })
    formList.append(dateRow)
    if (scrambleRow !== null) formList.append(scrambleRow)
    formList.append(penaltyRow)
    formList.append(commentRow)

    // The record's headline: title-1 (Adwaita's largest built-in heading,
    // no custom styles), `numeric` keeping the digits tabular as it changes.
    // Follows the penalty toggle live — always the *effective* time.
    const timeLabel = new Gtk.Label({
      label: timeText(solve.penalty),
      halign: Gtk.Align.CENTER,
      cssClasses: ['title-1', 'numeric'],
    })
    // `active` notifies on every selection change, click or programmatic —
    // one hook covers both.
    penaltyGroup.on('notify::active', () => {
      timeLabel.label = timeText(penaltyFromGroup())
    })

    // 12px inset so the card frame floats inside the dialog (same inset as
    // the type picker's list); 6px on top, where the header bar supplies
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

    // Suggested Save at the bar's left; Adw.HeaderBar adds the close button
    // at the right and Escape closes — both discard; only Save writes.
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
      // (adw-header-bar.c), so the string lives here and nowhere else.
      title: `Edit solve #${solveNumber}`,
      child: box,
      // Fixed width: a GtkLabel's natural width is its text on one line, so
      // a long scramble would stretch the dialog across the screen.
      contentWidth: 480,
      // No focusWidget: the dialog opens without grabbing the comment line —
      // Tab or Alt+O/2/D gets there. defaultWidget so Return still resolves
      // to Save from outside the entry; the comment row does not route Enter
      // here — only the Save button closes the dialog.
      defaultWidget: saveButton,
    })
    saveButton.on('clicked', () => {
      session.setPenalty(solve.id, penaltyFromGroup())
      // Trim: an empty comment means "no comment". The slice is the
      // read-side guard under MAX_COMMENT_LENGTH.
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

  // Double-click to edit: ColumnView's own activation (rows activate on
  // double click while single-click-activate is off), so the first click's
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
    // While collapsed the bar's buttons must not take keyboard focus
    // (Warehouse binds the same way).
    footerRow.setSensitive(hasSelection)
    // One edit dialog, one record; a child's sensitivity only ever restricts
    // its parents', so set it after the row's flag.
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
  // rebuild() calls it again: a splice can repoint positions without the
  // set changing.
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

  // A session switch hands the list a different Session to read: re-point
  // the subscription first so the old one's changes stop arriving, then
  // rebuild. Rename/create trigger an idempotent extra pass — two passes,
  // not two code paths.
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
