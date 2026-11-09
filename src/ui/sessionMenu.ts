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
import { SessionLibrary } from '../core/sessionLibrary.js'
import { createSessionDialogs } from './sessionDialogs.js'

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

  const dialogs = createSessionDialogs({
    library,
    window,
    getSolveCount: options.getSolveCount,
  })

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
    dialogs.promptNew()
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
    dialogs.promptRename(library.activeId)
  })
  app.addAction(renameAction)

  const deleteAction = Gio.SimpleAction.new('sessionDelete', null)
  deleteAction.on('activate', () => {
    button.popdown()
    dialogs.confirmDelete(library.activeId)
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
