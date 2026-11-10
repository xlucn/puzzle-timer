/*
 * sessionManager.ts — the session overview dialog and its sidebar button.
 *
 * The sidebar header's right-hand button and `app.sessionManager` open one
 * dialog over the window: every session with its solve count and scramble
 * type, the active one checked, and per-row rename/delete. The handle in
 * each row drags it to a new place, and the order is the library's order —
 * the index on disk persists it. Choosing a row switches the session behind
 * the dialog, which stays open for the next choice. The list re-renders on
 * every library change, coalesced into one idle pass so a change made while
 * a row is handling a click cannot rebuild that row underneath it.
 */
import Adw from 'gi:Adw-1'
import Gdk from 'gi:Gdk-4.0'
import Gio from 'gi:Gio-2.0'
import GLib from 'gi:GLib-2.0'
import GObject from 'gi:GObject-2.0'
import Gtk from 'gi:Gtk-4.0'

import { styles } from 'node-gtk/styles'

import { t } from '../core/i18n.js'
import { SCRAMBLE_DEFAULT_TYPE, scrambleTypeLabel } from '../core/scrambleTypes.js'
import type { SessionEntry, SessionLibrary } from '../core/sessionLibrary.js'
import { createSessionDialogs } from './sessionDialogs.js'

/*
 * The `gi:*` shims export a *value* namespace only (AGENTS.md), so widget
 * types come from InstanceType.
 */
type Application = InstanceType<typeof Adw.Application>
type Window = InstanceType<typeof Adw.ApplicationWindow>
type Widget = InstanceType<typeof Gtk.Widget>
type Dialog = InstanceType<typeof Adw.Dialog>

/** A session id travels through drag and drop as a plain string. */
const DRAG_TYPE = GObject.typeFromName('gchararray')

styles.add(`
  /* The row a dragged session will land on. A tint, not a border: the row's
     own card stays the same shape while the pointer moves down the list. */
  .session-drop-target {
    background-color: alpha(@accent_bg_color, 0.18);
  }
`)

export interface SessionManagerOptions {
  /** The session list the dialog reads and mutates. */
  library: SessionLibrary
  /** The application the entrance action is registered on. */
  app: Application
  /** Toplevel the dialog is presented on. */
  window: Window
  /** Solve count per session; may load the session from disk. */
  getSolveCount: (id: string) => number
}

export function createSessionManager(options: SessionManagerOptions) {
  const { library, app, window } = options
  const dialogs = createSessionDialogs({
    library,
    window,
    getSolveCount: options.getSolveCount,
  })

  // An icon-only button: the session switch beside it already names the
  // active session, so this one only has to say "more sessions".
  const button = new Gtk.Button({
    iconName: 'view-list-symbolic',
    tooltipText: t('session.manager.tooltip'),
    cssClasses: ['flat'],
    actionName: 'app.sessionManager',
  })

  let openDialog: Dialog | null = null

  const rowFor = (entry: SessionEntry, index: number): Widget => {
    const count = options.getSolveCount(entry.id)
    const type = entry.scrambleType ?? SCRAMBLE_DEFAULT_TYPE
    const row = new Adw.ActionRow({
      title: entry.name,
      subtitle: `${t('stats.solves', { count })} · ${scrambleTypeLabel(type)}`,
      useMarkup: false,
      activatable: true,
    })
    row.on('activated', () => library.switchTo(entry.id))

    // The handle, not the row, starts the drag: a plain click still activates
    // the row, and touch scrolling the list keeps working over the text.
    const handle = new Gtk.Box({
      widthRequest: 22,
      heightRequest: 22,
      valign: Gtk.Align.CENTER,
      tooltipText: t('session.manager.reorder'),
      cssClasses: ['dim-label'],
    })
    handle.append(new Gtk.Image({ iconName: 'session-drag-handle-symbolic' }))
    const drag = new Gtk.DragSource({ actions: Gdk.DragAction.MOVE })
    drag.on('prepare', () => {
      const value = new GObject.Value()
      value.init(DRAG_TYPE)
      value.setString(entry.id)
      return Gdk.ContentProvider.newForValue(value)
    })
    handle.addController(drag)
    row.addPrefix(handle)

    // Dropping on the top half inserts before the row, the bottom half after
    // it. Combined with the source index that is one clamp away from the
    // library's destination index.
    const target = Gtk.DropTarget.new(DRAG_TYPE, Gdk.DragAction.MOVE)
    target.on('enter', () => {
      row.addCssClass('session-drop-target')
      return Gdk.DragAction.MOVE
    })
    target.on('leave', () => row.removeCssClass('session-drop-target'))
    target.on('drop', (value, _x, y) => {
      row.removeCssClass('session-drop-target')
      const draggedId = value.getString()
      if (draggedId === null || draggedId === entry.id) return false
      const from = library.entries.findIndex((item) => item.id === draggedId)
      if (from < 0) return false
      const after = y >= row.getHeight() / 2
      let to = index + (after ? 1 : 0)
      if (from < to) to -= 1
      return library.move(draggedId, to)
    })
    row.addController(target)

    if (library.isActive(entry.id)) {
      row.addSuffix(
        new Gtk.Image({
          iconName: 'object-select-symbolic',
          tooltipText: t('session.manager.current'),
          cssClasses: ['accent'],
          valign: Gtk.Align.CENTER,
        }),
      )
    }

    const rename = new Gtk.Button({
      iconName: 'document-edit-symbolic',
      tooltipText: t('session.manager.rename'),
      cssClasses: ['flat'],
      valign: Gtk.Align.CENTER,
    })
    rename.on('clicked', () => dialogs.promptRename(entry.id))
    row.addSuffix(rename)

    const remove = new Gtk.Button({
      iconName: 'user-trash-symbolic',
      tooltipText: t('session.manager.delete'),
      cssClasses: ['flat'],
      valign: Gtk.Align.CENTER,
    })
    remove.sensitive = library.entries.length > 1
    remove.on('clicked', () => dialogs.confirmDelete(entry.id))
    row.addSuffix(remove)

    return row
  }

  const buildDialog = (): Dialog => {
    const page = new Adw.PreferencesPage()
    const group = new Adw.PreferencesGroup()
    page.add(group)

    const header = new Adw.HeaderBar({ showTitle: true })
    header.titleWidget = new Adw.WindowTitle({ title: t('session.manager.title') })
    header.packStart(
      new Gtk.Button({
        iconName: 'list-add-symbolic',
        tooltipText: t('session.new.tooltip'),
        cssClasses: ['flat'],
        actionName: 'app.sessionNew',
      }),
    )

    const toolbar = new Adw.ToolbarView({ content: page })
    toolbar.addTopBar(header)

    const dialog = new Adw.Dialog({
      title: t('session.manager.title'),
      child: toolbar,
      contentWidth: 420,
      contentHeight: 480,
      widthRequest: 300,
      heightRequest: 220,
    })

    const rows: Widget[] = []
    let alive = true
    const render = () => {
      for (const row of rows) group.remove(row)
      rows.length = 0
      for (const [index, entry] of library.entries.entries()) {
        const row = rowFor(entry, index)
        rows.push(row)
        group.add(row)
      }
    }

    // A rename/delete comes back as a library change while the row that
    // opened the dialog is still on screen; defer the rebuild out of that
    // handler. Several changes in one pass (create switches too) render once.
    let queued = false
    const schedule = () => {
      if (queued || !alive) return
      queued = true
      GLib.idleAdd(GLib.PRIORITY_DEFAULT, () => {
        queued = false
        if (alive) render()
        return GLib.SOURCE_REMOVE
      })
    }

    const unsubscribe = library.subscribe(schedule)
    dialog.on('closed', () => {
      alive = false
      unsubscribe()
    })
    render()
    return dialog
  }

  /** Open the manager, or close it when it is already up (button and Ctrl+M toggle). */
  const open = (): Dialog | null => {
    if (openDialog !== null) {
      openDialog.close()
      return null
    }
    const dialog = buildDialog()
    openDialog = dialog
    dialog.on('closed', () => {
      openDialog = null
    })
    dialog.present(window)
    return dialog
  }

  const action = Gio.SimpleAction.new('sessionManager', null)
  action.on('activate', () => {
    open()
  })
  app.addAction(action)
  app.setAccelsForAction('app.sessionManager', ['<Ctrl>M'])

  return { widget: button, open }
}
