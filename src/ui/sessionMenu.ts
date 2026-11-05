/*
 * sessionMenu.ts — the sidebar's session control.
 *
 * One widget does both jobs: a Gtk.MenuButton whose label is the *current*
 * session's name — the sidebar header's title — with a Gio.Menu underneath
 * that lists every session as a radio item — GTK checks the active one
 * itself, because the action is stateful and the menu item's target is
 * compared with the action's state — followed by a second section holding
 * Rename / Delete. New is the sidebar header's own "+" button, which drives
 * the same action.
 *
 * Everything here is UI only: dialogs call `library.create/rename/remove`
 * and the library announces the change. Persistence belongs to whoever
 * owns the store — src/main.ts subscribes to the same library.
 */
import Adw from 'gi:Adw-1'
import Gio from 'gi:Gio-2.0'
import GLib from 'gi:GLib-2.0'
import Gtk from 'gi:Gtk-4.0'
import Pango from 'gi:Pango-1.0'

import { t } from '../core/i18n.js'
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
  /**
   * Whether the menu may open now. Returning false keeps Ctrl+S inert while
   * the sidebar is hidden for the timer's distraction-free view.
   */
  canOpen: () => boolean
}

/*
 * The `gi:*` shims export a *value* namespace only (AGENTS.md), so
 * `Adw.Application` is not usable as a type annotation — the class values
 * are, and InstanceType turns them back into types.
 */
type Application = InstanceType<typeof Adw.Application>
type Window = InstanceType<typeof Adw.ApplicationWindow>

/** Longest session name shown in the sidebar title before it ellipsizes. */
const SIDEBAR_NAME_CHARS = 20

export function createSessionMenu(options: SessionMenuOptions) {
  const { library, app, window } = options

  // ---- name dialog: used by both New and Rename --------------------------
  const messageFor = (error: NameError): string => {
    switch (error) {
      case 'empty':
        return t('session.error.name')
      case 'long':
        return t('session.error.long', { count: MAX_NAME_LENGTH })
      case 'duplicate':
        return t('session.error.taken')
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
      placeholderText: t('session.name'),
      // Enter submits: activates the dialog's default response instead of
      // needing a trip to the buttons.
      activatesDefault: true,
      maxLength: MAX_NAME_LENGTH,
    })

    const dialog = new Adw.AlertDialog({
      heading: settings.heading,
      extraChild: entry,
    })
    dialog.addResponse('cancel', t('common.cancel'))
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
    // AdwAlertDialog's default response button claims focus on map, so the
    // caret would land on the accept button instead of in the entry. Take
    // focus back after GTK's own focus pass (map + a timer beat present()),
    // with the current name selected so typing replaces it.
    const claim = () => {
      entry.grabFocus()
      if (settings.initial.length > 0) entry.selectRegion(0, -1)
    }
    dialog.on('map', () => setTimeout(claim, 0))
    setTimeout(claim, 0)
  }

  // ---- the button --------------------------------------------------------
  // The current session's name *is* the label: an icon would say "a menu is
  // here" but not "you are solving in Meet weekly". It is the sidebar
  // header's title, so it stays compact and centred — a full-width button
  // would leave no header background to drag by. Long names ellipsize at 20
  // characters instead of crowding the arrow.
  const label = new Gtk.Label({
    label: library.active.name,
    ellipsize: Pango.EllipsizeMode.END,
    maxWidthChars: SIDEBAR_NAME_CHARS,
    hexpand: true,
    xalign: 0,
  })

  const button = new Gtk.MenuButton({
    child: label,
    // The child is custom, so the dropdown arrow has to be asked for.
    alwaysShowArrow: true,
    tooltipText: t('session.tooltip'),
    cssClasses: ['flat'],
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
      heading: t('session.new'),
      acceptLabel: t('common.create'),
      body: t('session.new.description'),
      initial: '',
      exceptId: null,
      onSubmit: (name) => library.create(name),
    })
  })
  app.addAction(newAction)

  // The header's "+": the menu's New item, moved out because the title slot
  // left the header nearly empty. Same action, so the button, the menu item's
  // accelerator and any future entry point cannot drift.
  const newButton = new Gtk.Button({
    iconName: 'list-add-symbolic',
    tooltipText: t('session.new.tooltip'),
    cssClasses: ['flat'],
    actionName: 'app.sessionNew',
  })

  const renameAction = Gio.SimpleAction.new('sessionRename', null)
  renameAction.on('activate', () => {
    button.popdown()
    const active = library.active
    promptForName({
      heading: t('session.rename'),
      acceptLabel: t('common.rename'),
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
      heading: t('session.delete.title', { name: active.name }),
      body:
        count === 0
          ? t('session.delete.empty')
          : t('session.delete.body', { count }),
    })
    dialog.addResponse('cancel', t('common.cancel'))
    dialog.addResponse('delete', t('common.delete'))
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
  // discoverable from inside the menu (Ctrl+N, now on the + button, is on its
  // tooltip instead). They also make the whole flow drivable
  // without aiming a pointer at a moving button (see tools/README.md: synthetic
  // clicks fight the physical mouse).
  const openAction = Gio.SimpleAction.new('sessionOpen', null)
  openAction.on('activate', () => {
    if (!options.canOpen()) return
    if (button.active) {
      button.popdown()
      return
    }
    if (button.getMapped()) {
      button.popup()
      return
    }
    // The control lives in the sidebar: with the sidebar closed it has no
    // on-screen anchor, and a popover cannot anchor to an unmapped widget.
    // Connect the map listener *first* (a reveal cannot map anything before
    // ensureVisible() returns, but ordering it this way costs nothing), then
    // reveal the sidebar; the menu pops on the frame the button lands on.
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
    management.append(t('session.rename.menu'), 'app.sessionRename')
    management.append(t('session.delete.menu'), 'app.sessionDelete')

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

  return { widget: button, newButton }
}
