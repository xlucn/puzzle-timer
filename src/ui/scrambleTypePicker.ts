/*
 * scrambleTypePicker.ts — the selector row's scramble-type chooser (narrow).
 *
 * Two layouts, two controls (user call, 2026-10-03): the wide window keeps
 * the two Gtk.DropDowns of scrambleTypeSelect.ts, while the selector row —
 * ≤600px, or a header whose labels no longer fit — gets ONE button reading
 * `Category - type`. Two dropdowns at the 400px floor is how you end up with
 * neither of them readable; one ellipsised line is the whole selection
 * surface, and the choosing happens where there is room for it.
 *
 * Clicking it opens an Adw.Dialog with a boxed list, in the shape asked for:
 *
 *   types      what opens — the current category's types (✓ on the live one),
 *              because that is the list you are most likely to pick from;
 *   categories the up button swaps the same list for the categories, and
 *              picking one drills back into its types.
 *
 * Search keeps the capability the dropdowns had (a box of 206 types, found by
 * typing): while it has text it overrides both levels and lists matches from
 * *every* category, labelled `scrambleTypeLabel()` so a hit says where it
 * lives — "PLL" on its own would be ambiguous, there are two.
 *
 * The widget answers the same contract as the dropdowns — `{ widget,
 * selectType }`, silent and idempotent — so main.ts builds both, broadcasts a
 * choice to the other one, and does not care which control the user used.
 *
 * The dialog is built fresh on every open (house pattern: Preferences,
 * Shortcuts) — an AdwDialog is gone when it closes.
 */
import Adw from 'gi:Adw-1'
import Gdk from 'gi:Gdk-4.0'
import Gtk from 'gi:Gtk-4.0'

import { SCRAMBLE_GROUPS, SCRAMBLE_TYPES, scrambleTypeLabel } from '../core/scrambleTypes.js'

/*
 * The `gi:*` shims export a *value* namespace only (AGENTS.md), so widget
 * types come from InstanceType — this module only builds and presents its own
 * widgets, so the base types say enough.
 */
type Window = InstanceType<typeof Adw.ApplicationWindow>
type ActionRow = InstanceType<typeof Adw.ActionRow>
// The shims export a *value* namespace (AGENTS.md), so even the row type the
// .d.ts mentions has to come through InstanceType.
type ListBoxRow = InstanceType<typeof Gtk.ListBoxRow>

export interface ScrambleTypePickerOptions {
  /** Type the button opens on; must be the feed's starting type. */
  initialType: string
  /** Called whenever the user picks a different type (never for selectType). */
  onChange: (id: string) => void
  /** Toplevel the dialog is presented on. */
  window: Window
}

/** Which list the dialog is showing; search overrides both. */
type Level = 'types' | 'categories'

/** What a row will do when activated. */
type Payload = { kind: 'type'; id: string } | { kind: 'group'; index: number }

export function createScrambleTypePicker(options: ScrambleTypePickerOptions) {
  const groups = SCRAMBLE_GROUPS
  /** The group a level of types is *browsing* (may differ from the live one). */
  const groupIndex = (id: string): number =>
    groups.findIndex((group) => group.choices.some((choice) => choice.id === id))

  let currentId = options.initialType

  /**
   * The control itself: `Adw.ButtonRow` (user call, 2026-10-03) rather than a
   * Gtk.Button in a box — it is a list row that *is* a button, so it carries
   * the boxed-list styling of the list it opens and sits in it visually.
   * `title` is the whole label (`Category - type`), `endIconName` the chevron
   * that says there is a list behind it. Plain text, not markup: a type name
   * may contain `<` and `>` ("3x3x3 Roux - LSE <M, U>").
   */
  const typeRow = new Adw.ButtonRow({
    title: scrambleTypeLabel(currentId),
    useMarkup: false,
    endIconName: 'pan-down-symbolic',
    tooltipText: 'Choose the scramble type',
    // main.ts owns the container (the selector row) and wires activation —
    // row-activated for the mouse and its own key controller for Return/Space,
    // since GTK4's GtkListBox does not activate rows from the keyboard (see
    // the dialog's controller) and two paths would open two dialogs.
    activatable: true,
  })

  const openDialog = (): void => {
    let level: Level = 'types'
    let browse = Math.max(0, groupIndex(currentId))

    const dialog = new Adw.Dialog({ title: 'Scramble type' })

    const title = new Adw.WindowTitle({ title: 'Scramble type', subtitle: '' })
    const headerBar = new Adw.HeaderBar({ titleWidget: title })
    // The up button: A header bar inside a dialog draws the close button and
    // the title for us (AdwDialog docs), so this is the only chrome added.
    const up = new Gtk.Button({
      iconName: 'pan-up-symbolic',
      tooltipText: 'All categories',
    })
    headerBar.packStart(up)

    const search = new Gtk.SearchEntry({
      hexpand: true,
      placeholderText: 'Search all 206 types',
    })
    const searchBar = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      marginStart: 12,
      marginEnd: 12,
      marginTop: 6,
    })
    searchBar.append(search)

    const list = new Gtk.ListBox({
      // SINGLE, not NONE: arrow keys need a selection to move, and Return
      // activates the selected row — the whole dialog is keyboard-drivable
      // that way (AGENTS: never aim a mouse at it).
      selectionMode: Gtk.SelectionMode.SINGLE,
      activateOnSingleClick: true,
      cssClasses: ['boxed-list'],
      marginStart: 12,
      marginEnd: 12,
      marginBottom: 12,
    })
    const scroller = new Gtk.ScrolledWindow({
      child: list,
      vexpand: true,
      hscrollbarPolicy: Gtk.PolicyType.NEVER,
      // The dialog sizes itself to its content (AdwDialog:followsContentSize),
      // and a scrolled window's *natural* height is nothing — with no floor
      // the sheet sizes to exactly one row (measured: 20 types, one visible).
      // Floor it to the height the window can spare — header and search take
      // about 106 of it — and let the list scroll past that.
      minContentHeight: Math.max(180, options.window.getSize(Gtk.Orientation.VERTICAL) - 140),
    })

    const toolbar = new Adw.ToolbarView()
    toolbar.addTopBar(headerBar)
    toolbar.addTopBar(searchBar)
    toolbar.content = scroller
    dialog.child = toolbar

    /** Row → what it does; dropped wholesale on every re-render. */
    const payloads = new Map<ListBoxRow, Payload>()
    /** The rows currently in the list, in order — navigation needs indexes. */
    let currentRows: ListBoxRow[] = []

    const addRow = (title_: string, payload: Payload, extra?: 'current' | 'drill'): ActionRow => {
      // useMarkup: false — a type name may contain `<` and `>` (measured:
      // "3x3x3 Roux - LSE <M, U>" made AdwActionRow try to parse it as Pango
      // markup and log a Gtk-WARNING for the parse error). Titles here are
      // always plain text; nothing in this dialog is meant to be markup.
      const row = new Adw.ActionRow({ title: title_, activatable: true, useMarkup: false })
      if (extra === 'current') {
        row.addSuffix(new Gtk.Image({ iconName: 'object-select-symbolic', valign: Gtk.Align.CENTER }))
      } else if (extra === 'drill') {
        row.addSuffix(new Gtk.Image({ iconName: 'go-next-symbolic', valign: Gtk.Align.CENTER }))
      }
      payloads.set(row, payload)
      list.append(row)
      currentRows.push(row)
      return row
    }

    const clearRows = (): void => {
      payloads.clear()
      currentRows = []
      let row = list.getRowAtIndex(0)
      while (row !== null) {
        list.remove(row)
        row = list.getRowAtIndex(0)
      }
    }

    /** One list, three shapes — see the header comment. */
    const render = (): void => {
      clearRows()
      const query = search.text.trim().toLowerCase()
      /** The row to preselect: the live type, the browsed category, else the first. */
      let first: ActionRow | null = null
      let live: ActionRow | null = null
      const remember = (row: ActionRow, isCurrent: boolean): void => {
        first ??= row
        if (isCurrent) live = row
      }

      if (query.length > 0) {
        title.title = 'Search results'
        title.subtitle = 'Scramble type'
        up.visible = false
        for (const type of SCRAMBLE_TYPES) {
          const full = scrambleTypeLabel(type.id)
          if (!full.toLowerCase().includes(query)) continue
          const isCurrent = type.id === currentId
          remember(addRow(full, { kind: 'type', id: type.id }, isCurrent ? 'current' : undefined), isCurrent)
        }
        if (first === null) addRow('No matches', { kind: 'group', index: -1 })
      } else if (level === 'categories') {
        title.title = 'Scramble type'
        title.subtitle = 'All categories'
        up.visible = false
        // Land on the category the types came from, not on the first one
        // (user call, 2026-10-03): pressing Up from "3x3x3 CFOP" should put
        // you back in front of 3x3x3 CFOP — otherwise the list starts at
        // "WCA" every time and the arrow keys have to walk back. No ✓ here:
        // that mark means "the live type", and this is only where you are
        // browsing; the chevron already says this row drills in.
        groups.forEach((group, index) =>
          remember(addRow(group.name, { kind: 'group', index }, 'drill'), index === browse),
        )
      } else {
        const group = groups[browse]
        title.title = group.name
        title.subtitle = 'Scramble type'
        up.visible = true
        for (const choice of group.choices) {
          const isCurrent = choice.id === currentId
          remember(addRow(choice.label, { kind: 'type', id: choice.id }, isCurrent ? 'current' : undefined), isCurrent)
        }
      }

      list.unselectAll()
      // Focus starts on a row, not on the up button or the search entry: the
      // dialog's whole point is picking one, so Return should be one arrow
      // press away from doing that.
      const target = live ?? first
      if (target !== null) list.selectRow(target)
    }

    /** One row doing its job: drill in, or take the type and close. */
    const activate = (payload: Payload | undefined): void => {
      if (payload === undefined) return
      if (payload.kind === 'group') {
        if (payload.index < 0) return // the "No matches" placeholder
        browse = payload.index
        level = 'types'
        search.text = '' // a category choice ends the search it did not start
        render()
        // The rows under the old level are gone with their focus: put it back
        // on the list, or Down/Return has nothing to move or activate.
        list.grabFocus()
        return
      }
      const changed = payload.id !== currentId
      currentId = payload.id
      typeRow.title = scrambleTypeLabel(currentId)
      // The dialog's own pick, announced once: main.ts moves the *other*
      // selector and the feed with it (selectType here would be a no-op —
      // currentId is already this — so nothing echoes).
      if (changed) options.onChange(payload.id)
      dialog.close()
    }

    // Bound here rather than left to the widget: GTK4's GtkListBox moves
    // nothing and activates nothing on its own in this dialog (measured: Down
    // and Return both reach this controller and no row-activated ever
    // follows), so the dialog's "pick one" is the binding below — and Return
    // without a selection takes the first row.
    const keys = new Gtk.EventControllerKey()
    list.addController(keys)
    keys.on('key-pressed', (keyval) => {
      const at = (): number => {
        const row = list.getSelectedRow()
        return row === null ? -1 : currentRows.indexOf(row)
      }
      const selectAt = (index: number): void => {
        if (currentRows.length === 0) return
        const clamped = Math.max(0, Math.min(index, currentRows.length - 1))
        list.selectRow(currentRows[clamped])
      }
      if (keyval === Gdk.KEY_Down) {
        selectAt(at() + 1)
        return true
      }
      if (keyval === Gdk.KEY_Up) {
        selectAt(at() <= 0 ? 0 : at() - 1)
        return true
      }
      if (keyval === Gdk.KEY_End) {
        selectAt(currentRows.length - 1)
        return true
      }
      if (keyval === Gdk.KEY_Home) {
        selectAt(0)
        return true
      }
      if (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_KP_Enter || keyval === Gdk.KEY_space) {
        const row = list.getSelectedRow() ?? currentRows[0]
        if (row !== undefined && row !== null) activate(payloads.get(row))
        return true
      }
      return false
    })

    // node-gtk signal handlers get the signal's *parameters* only — the
    // emitter is not passed (AGENTS: look the overload up in the .d.ts
    // rather than guessing), so this one arrives as just the row.
    list.on('row-activated', (row) => {
      activate(payloads.get(row))
    })

    up.on('clicked', () => {
      level = 'categories'
      render()
      // Hiding the focused up button hands focus to the sheet's background
      // (measured: AdwGizmo), which leaves the keyboard with nowhere to go —
      // the list is the thing the user is navigating, so it takes it back.
      list.grabFocus()
    })
    search.on('search-changed', render)

    // Escape, in capture phase so it wins over whatever has focus: a plain
    // AdwDialog does *not* close on Escape (only specialised ones such as
    // AdwShortcutsDialog do — measured: three Escapes with the search entry
    // focused left this dialog up), which would strand a keyboard user with
    // no way out. First Escape clears the query, second closes — the search
    // entry's own convention.
    const escapeKeys = new Gtk.EventControllerKey({
      propagationPhase: Gtk.PropagationPhase.CAPTURE,
    })
    dialog.addController(escapeKeys)
    escapeKeys.on('key-pressed', (keyval) => {
      if (keyval !== Gdk.KEY_Escape) return false
      if (search.text.length > 0) {
        search.text = ''
        return true
      }
      dialog.close()
      return true
    })

    render()
    // Keyboard first: arrows + Return pick (bound in the key controller above),
    // Escape out (capture controller above).
    dialog.focusWidget = list
    dialog.present(options.window)
  }

  // Activation lives in main.ts — the container wires row-activated for the
  // pointer and a key controller for Return/Space (GTK4's GtkListBox does not
  // activate rows from the keyboard), so there is one way in and no chance of
  // a double-open.

  /**
   * Point the row at `id` — same contract as the dropdowns' selectType:
   * silent (never announces the choice back), idempotent, and false for an id
   * this catalogue does not have (a hand-edited session index), so the caller
   * leaves the feed alone too.
   */
  const selectType = (id: string): boolean => {
    if (id === currentId) return true
    if (groupIndex(id) < 0) return false
    currentId = id
    typeRow.title = scrambleTypeLabel(id)
    return true
  }

  /** The row, and the way in — main.ts owns the container it sits in. */
  return { widget: typeRow, open: openDialog, selectType }
}
