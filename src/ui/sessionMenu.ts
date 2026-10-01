/*
 * sessionMenu.ts — the sidebar's session control (M3, layout F).
 *
 * One widget does both jobs (user call, 2026-10-01): a Gtk.MenuButton whose
 * label is the *current* session's name, with a Gio.Menu underneath that
 * lists every session as a radio item — GTK checks the active one itself,
 * because the action is stateful and the menu item's target is compared with
 * the action's state — followed by a second section holding New / Rename /
 * Delete. A dropdown plus a row of separate buttons would have put the same
 * three actions in a second place to hunt for.
 *
 * Placement (layout F, 2026-10-01): a full-width row in the sidebar, between
 * the sidebar's header (app name + app menu) and the solve list — it labels
 * the list below it, so it lives with the list. It is *not* in the content
 * header anymore, which means Ctrl+S can be pressed while the sidebar is
 * closed; `ensureVisible` lets the open path reveal the sidebar first,
 * because a popover cannot anchor to an unmapped widget.
 *
 * Everything here is UI only: dialogs call `library.create/rename/remove`
 * and the library announces the change. Persistence (index write, session
 * file removal) belongs to whoever owns the store — src/main.ts subscribes to
 * the same library.
 */
import Adw from 'gi:Adw-1'
import Gio from 'gi:Gio-2.0'
import GLib from 'gi:GLib-2.0'
import Gtk from 'gi:Gtk-4.0'
import Pango from 'gi:Pango-1.0'

import { MAX_NAME_LENGTH, SessionLibrary, type NameError } from '../core/sessionLibrary.js'

export interface SessionMenuOptions {
  /** The session list this control reads and mutates. */
  library: SessionLibrary
  /** The application the menu's actions are registered on. */
  app: Application
  /** Toplevel the dialogs are presented on. */
  window: Window
  /** Solve count, for the delete confirmation (may load the session). */
  getSolveCount: (id: string) => number
  /**
   * Make this control's host visible (the sidebar). Called by the
   * Ctrl+S / app.sessionOpen path when the button is off-screen: the caller
   * only has to reveal the host — the menu pops itself once the button maps.
   */
  ensureVisible: () => void
}

/*
 * The `gi:*` shims export a *value* namespace only (AGENTS.md), so
 * `Adw.Application` is not usable as a type annotation — the class values
 * are, and InstanceType turns them back into types.
 */
type Application = InstanceType<typeof Adw.Application>
type Window = InstanceType<typeof Adw.ApplicationWindow>

/** Longest session name shown in the sidebar row before it ellipsizes. */
const SIDEBAR_NAME_CHARS = 20

export function createSessionMenu(options: SessionMenuOptions) {
  const { library, app, window } = options

  // ---- name dialog: used by both New and Rename --------------------------
  const messageFor = (error: NameError): string => {
    switch (error) {
      case 'empty':
        return 'A session needs a name.'
      case 'long':
        return `Names are up to ${MAX_NAME_LENGTH} characters.`
      case 'duplicate':
        return 'A session with that name already exists.'
    }
  }

  const promptForName = (settings: {
    heading: string
    acceptLabel: string
    /** Shown under the entry until it is replaced by a validation message. */
    body: string
    initial: string
    /** The session whose name may be kept as-is (rename), or null (new). */
    exceptId: string | null
    onSubmit: (name: string) => void
  }) => {
    const entry = new Gtk.Entry({
      text: settings.initial,
      placeholderText: 'Session name',
      // Enter submits: activates the dialog's default response instead of
      // needing a trip to the buttons.
      activatesDefault: true,
      maxLength: MAX_NAME_LENGTH,
    })

    const dialog = new Adw.AlertDialog({
      heading: settings.heading,
      extraChild: entry,
    })
    dialog.addResponse('cancel', 'Cancel')
    dialog.addResponse('accept', settings.acceptLabel)
    dialog.setResponseAppearance('accept', Adw.ResponseAppearance.SUGGESTED)
    dialog.setDefaultResponse('accept')
    dialog.setCloseResponse('cancel')

    // The library is the only judge of what a name may be, so the dialog's
    // own sensitivity can never disagree with what create()/rename() accept.
    const sync = () => {
      const error = library.nameError(entry.getText(), settings.exceptId)
      dialog.setResponseEnabled('accept', error === null)
      dialog.body = error === null ? settings.body : messageFor(error)
    }
    entry.on('changed', sync)
    sync()

    dialog.on('response', (response) => {
      if (response === 'accept') settings.onSubmit(entry.getText())
    })
    dialog.present(window)
    // AdwAlertDialog gives the default response the dialog's default widget
    // (GIR: "The button corresponding to this response will be set as the
    // default widget of self"), and that button claims focus when the dialog
    // maps. A rename's accept button is sensitive from the start, so without
    // this the caret lands on Rename instead of in the name — while New works
    // only because an empty name keeps Create insensitive. The entry is where
    // typing must go, so take focus back once the dialog has been shown: the
    // map fires on a later main-loop turn than present(), and the timer it
    // schedules fires later still, i.e. after GTK's own focus pass. Renaming
    // replaces rather than appends, so the current name arrives selected.
    const claim = () => {
      entry.grabFocus()
      if (settings.initial.length > 0) entry.selectRegion(0, -1)
    }
    dialog.on('map', () => setTimeout(claim, 0))
    setTimeout(claim, 0)
  }

  // ---- the button --------------------------------------------------------
  // The current session's name *is* the label: an icon would say "a menu is
  // here" but not "you are solving in Meet weekly". As a full-width sidebar
  // row the label is left-aligned (xalign 0) and expands, so the arrow sits
  // at the row's right edge and long names ellipsize at 20 characters instead
  // of crowding the arrow.
  const label = new Gtk.Label({
    label: library.active.name,
    ellipsize: Pango.EllipsizeMode.END,
    maxWidthChars: SIDEBAR_NAME_CHARS,
    xalign: 0,
    hexpand: true,
  })

  const button = new Gtk.MenuButton({
    child: label,
    // The child is custom, so the dropdown arrow has to be asked for.
    alwaysShowArrow: true,
    tooltipText: 'Session',
    cssClasses: ['flat'],
    // Span the sidebar; harmless packed size anywhere else.
    hexpand: true,
  })

  // ---- actions -----------------------------------------------------------
  // Stateful with a string parameter: the menu items carry their session id
  // as the target, so GTK draws the radio check against this state and the
  // handler just switches.
  const switchAction = Gio.SimpleAction.newStateful(
    'sessionSwitch',
    GLib.VariantType.new('s'),
    GLib.Variant.newString(library.activeId),
  )
  switchAction.on('activate', (parameter) => {
    if (parameter !== null) library.switchTo(parameter.getString()[0])
  })
  app.addAction(switchAction)

  const newAction = Gio.SimpleAction.new('sessionNew', null)
  newAction.on('activate', () => {
    button.popdown() // close the menu before a dialog takes focus
    promptForName({
      heading: 'New session',
      acceptLabel: 'Create',
      body: 'Each session keeps its own list of solves.',
      initial: '',
      exceptId: null,
      onSubmit: (name) => library.create(name),
    })
  })
  app.addAction(newAction)

  const renameAction = Gio.SimpleAction.new('sessionRename', null)
  renameAction.on('activate', () => {
    button.popdown()
    const active = library.active
    promptForName({
      heading: 'Rename session',
      acceptLabel: 'Rename',
      body: '',
      initial: active.name,
      exceptId: active.id,
      onSubmit: (name) => library.rename(active.id, name),
    })
  })
  app.addAction(renameAction)

  const deleteAction = Gio.SimpleAction.new('sessionDelete', null)
  deleteAction.on('activate', () => {
    button.popdown()
    const active = library.active
    const count = options.getSolveCount(active.id)
    const dialog = new Adw.AlertDialog({
      heading: `Delete “${active.name}”?`,
      body:
        count === 0
          ? 'This cannot be undone.'
          : `${count} solve${count === 1 ? '' : 's'} will be removed. This cannot be undone.`,
    })
    dialog.addResponse('cancel', 'Cancel')
    dialog.addResponse('delete', 'Delete')
    dialog.setResponseAppearance('delete', Adw.ResponseAppearance.DESTRUCTIVE)
    // Escape and Enter land on Cancel: deleting a session is guarded, never
    // the default.
    dialog.setDefaultResponse('cancel')
    dialog.setCloseResponse('cancel')
    dialog.on('response', (response) => {
      if (response === 'delete') library.remove(active.id)
    })
    dialog.present(window)
  })
  app.addAction(deleteAction)

  // ---- keyboard -----------------------------------------------------------
  // Not test scaffolding — these are the menu's real accelerators, and
  // GtkMenuButton draws each one beside its item, so the bindings are
  // discoverable from inside the menu. They also make the whole flow drivable
  // without aiming a pointer at a moving button (see tools/README.md: synthetic
  // clicks fight the physical mouse).
  const openAction = Gio.SimpleAction.new('sessionOpen', null)
  openAction.on('activate', () => {
    if (button.active) {
      button.popdown()
      return
    }
    if (button.getMapped()) {
      button.popup()
      return
    }
    // The control lives in the sidebar (layout F): with the sidebar closed
    // it has no on-screen anchor, and a popover cannot anchor to an
    // unmapped widget. Connect the map listener *first* (a reveal cannot
    // map anything before ensureVisible() returns, but ordering it this way
    // costs nothing), then reveal the sidebar; the menu pops on the frame
    // the button lands on.
    button.once('map', () => button.popup())
    options.ensureVisible()
  })
  app.addAction(openAction)

  app.setAccelsForAction('app.sessionOpen', ['<Ctrl>S'])
  app.setAccelsForAction('app.sessionNew', ['<Ctrl>N'])
  app.setAccelsForAction('app.sessionRename', ['F2'])
  // Ctrl+Delete, not Delete: plain Delete is already the solve list's
  // "remove the selected solve" key.
  app.setAccelsForAction('app.sessionDelete', ['<Ctrl>Delete'])

  // ---- the menu itself ---------------------------------------------------
  const buildMenu = () => {
    const sessions = new Gio.Menu()
    for (const entry of library.entries) {
      const item = Gio.MenuItem.new(entry.name, 'app.sessionSwitch')
      item.setAttributeValue('target', GLib.Variant.newString(entry.id))
      sessions.appendItem(item)
    }

    const management = new Gio.Menu()
    management.append('New session…', 'app.sessionNew')
    management.append('Rename…', 'app.sessionRename')
    management.append('Delete…', 'app.sessionDelete')

    const menu = new Gio.Menu()
    // Two sections, so GTK draws the separator between the list and the
    // commands without any custom row machinery.
    menu.appendSection(null, sessions)
    menu.appendSection(null, management)
    return menu
  }

  /** One idempotent pass: label, menu, radio state, availability. */
  const sync = () => {
    label.setLabel(library.active.name)
    button.setMenuModel(buildMenu())
    switchAction.setState(GLib.Variant.newString(library.activeId))
    // The library refuses to empty itself — mirror that rather than letting
    // a dead Delete button sit in the menu.
    deleteAction.enabled = library.entries.length > 1
  }

  library.subscribe(sync)
  sync()

  return { widget: button }
}
