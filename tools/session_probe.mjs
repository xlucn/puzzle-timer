/*
 * session_probe.mjs — the session manager dialog and its sidebar button.
 *
 * Checks structure and state, not pixels: the button's action and icon, the
 * action's accelerator, the dialog's header and New button, one row per
 * session with its solve count and type, the active check, per-row
 * rename/delete, switching by activating a row, and Delete going insensitive
 * when only one session is left. The real solve sidebar hosts the button, so
 * its header placement is the app's own, not a stand-in.
 *
 * Run:
 *   GDK_BACKEND=x11 node --import tsx --import node-gtk/register tools/session_probe.mjs
 */
import Adw from 'gi:Adw-1'
import Gio from 'gi:Gio-2.0'
import GLib from 'gi:GLib-2.0'
import GObject from 'gi:GObject-2.0'
import Gtk from 'gi:Gtk-4.0'
import { fileURLToPath } from 'node:url'

import { setLocale, t } from '../src/core/i18n.js'
import { scrambleTypeLabel } from '../src/core/scrambleTypes.js'
import { Session } from '../src/core/session.js'
import { SessionLibrary } from '../src/core/sessionLibrary.js'
import { createSessionManager } from '../src/ui/sessionManager.js'
import { createTimesList } from '../src/ui/timesList.js'

setLocale('en')

const log = (...args) => console.error('[session]', ...args)
let failures = 0
const check = (ok, what) => {
  log(`${ok ? 'PASS' : 'FAIL'} — ${what}`)
  if (!ok) failures += 1
}

const walk = (root, visit) => {
  if (root === null || root === undefined) return
  visit(root)
  let child = root.getFirstChild?.() ?? null
  while (child !== null) {
    walk(child, visit)
    child = child.getNextSibling?.() ?? null
  }
}

const findAll = (root, typeName) => {
  const out = []
  walk(root, (node) => {
    if (node.constructor.name === typeName) out.push(node)
  })
  return out
}

const ancestorOf = (widget, typeName) => {
  let node = widget?.getParent?.() ?? null
  while (node !== null && node.constructor.name !== typeName) node = node.getParent?.() ?? null
  return node
}

const controllersOf = (widget) => {
  const out = []
  const model = widget.observeControllers()
  for (let i = 0; i < model.getNItems(); i += 1) out.push(model.getItem(i))
  return out
}

const dragValue = (id) => {
  const value = new GObject.Value()
  value.init(GObject.typeFromName('gchararray'))
  value.setString(id)
  return value
}

const reorderHandle = (row) =>
  findAll(row, 'GtkBox').find((box) => box.tooltipText === t('session.manager.reorder'))

const solve = (id, timeMs) => ({
  id,
  timeMs,
  scramble: 'R U',
  scrambleType: '333',
  createdAtMs: Date.now(),
})

const sessions = new Map([
  ['default', new Session([solve(1, 12_340), solve(2, 11_980)])],
  ['practice', new Session([solve(1, 45_000), solve(2, 44_100), solve(3, 43_500)])],
  ['meeting', new Session([solve(1, 22_000)])],
])
const library = new SessionLibrary(
  [
    { id: 'default', name: 'Default' },
    { id: 'practice', name: 'Practice', scrambleType: '444wca' },
    { id: 'meeting', name: 'Meet weekly' },
  ],
  'practice',
)

const app = new Adw.Application({
  applicationId: 'io.github.xlucn.PuzzleTimer.probe.session',
  flags: Gio.ApplicationFlags.FLAGS_NONE,
})

app.on('activate', () => {
  const window = new Adw.ApplicationWindow({ application: app, title: 'SessionProbe' })
  // The app's icon theme path, as main.ts adds it: the row handle lives there.
  Gtk.IconTheme.getForDisplay(window.getDisplay()).addSearchPath(
    fileURLToPath(new URL('../data/icons', import.meta.url)),
  )
  const manager = createSessionManager({
    library,
    app,
    window,
    getSolveCount: (id) => sessions.get(id)?.size ?? 0,
  })

  check(manager.widget.constructor.name === 'GtkButton', 'the entrance is a button')
  check(manager.widget.iconName === 'view-list-symbolic', `the entrance icon is a list (${manager.widget.iconName})`)
  check(
    manager.widget.tooltipText === t('session.manager.tooltip'),
    `the entrance names its job (${manager.widget.tooltipText})`,
  )
  check(manager.widget.actionName === 'app.sessionManager', 'the entrance drives the manager action')

  check(app.lookupAction('sessionManager') !== null, 'the sessionManager action is registered')
  const accels = app.getAccelsForAction('app.sessionManager')
  check(
    accels.some((accel) => /^<Control>m$/i.test(accel)),
    `Ctrl+M opens the manager (${accels.join(', ')})`,
  )

  // The real sidebar header is where main.ts puts the button.
  const newButton = new Gtk.Button({ iconName: 'list-add-symbolic' })
  const list = createTimesList({
    library,
    getSession: () => sessions.get(library.activeId),
    onDelete: () => {},
    sessionControl: new Gtk.MenuButton({ label: 'Session' }),
    newSessionControl: newButton,
    sessionManagerControl: manager.widget,
    window,
  })
  window.setContent(list.widget)
  window.setDefaultSize(900, 600)
  window.on('close-request', () => false)
  window.present()

  GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 500, () => {
    const theme = Gtk.IconTheme.getForDisplay(window.getDisplay())
    for (const name of [
      'view-list-symbolic',
      'list-add-symbolic',
      'object-select-symbolic',
      'document-edit-symbolic',
      'user-trash-symbolic',
      'session-drag-handle-symbolic',
    ]) {
      check(theme.hasIcon(name), `${name} resolves in the active theme (${theme.getThemeName()})`)
    }
    const header = findAll(list.widget, 'AdwHeaderBar')[0]
    check(ancestorOf(manager.widget, 'AdwHeaderBar') === header, 'the manager sits in the sidebar header')
    const [haveManager, managerX] = manager.widget.translateCoordinates(header, 0, 0)
    const [haveNew, newX] = newButton.translateCoordinates(header, 0, 0)
    check(
      haveManager && haveNew && managerX > newX,
      `the manager sits right of New (${managerX} > ${newX})`,
    )
    check(
      haveManager && managerX > header.getWidth() * 0.7,
      `the manager sits on the header's right (${managerX} in ${header.getWidth()})`,
    )

    const dialog = manager.open()
    if (dialog === null) {
      check(false, 'the manager opens')
      app.quit()
      return GLib.SOURCE_REMOVE
    }
    check(dialog.title === t('session.manager.title'), `the dialog is titled Sessions (${dialog.title})`)
    const title = findAll(dialog, 'AdwWindowTitle')[0]
    check(title?.title === t('session.manager.title'), 'the header carries the dialog title')
    const newButtons = findAll(dialog, 'GtkButton').filter(
      (button) => button.actionName === 'app.sessionNew',
    )
    check(newButtons.length === 1, `the header offers New (${newButtons.length})`)

    const rows = () => findAll(dialog, 'AdwActionRow')
    const titles = () => rows().map((row) => row.title)
    check(
      titles().join('|') === 'Default|Practice|Meet weekly',
      `one row per session, in library order (${titles().join(' | ')})`,
    )
    check(
      rows()[1]?.subtitle === `${t('stats.solves', { count: 3 })} · ${scrambleTypeLabel('444wca')}`,
      `a row counts its solves and names its type (${rows()[1]?.subtitle})`,
    )
    const checks = () =>
      rows()
        .map((row) => findAll(row, 'GtkImage').find((image) => image.iconName === 'object-select-symbolic'))
        .map((image, index) => (image === undefined ? null : index))
        .filter((index) => index !== null)
    check(checks().join('|') === '1', `the active session is checked (${checks().join(', ')})`)

    const tooltips = (row) =>
      findAll(row, 'GtkButton')
        .map((button) => button.tooltipText)
        .join('|')
    check(
      rows().every((row) => tooltips(row) === `${t('session.manager.rename')}|${t('session.manager.delete')}`),
      `every row offers rename and delete (${tooltips(rows()[0])})`,
    )
    check(
      rows().every((row) => findAll(row, 'GtkButton').every((button) => button.sensitive)),
      'delete is enabled while more than one session exists',
    )

    // Activating a row is the touch path: switch, then the check follows.
    rows()[0].emit('activate')
    check(library.activeId === 'default', `activating a row switches (${library.activeId})`)
    GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 300, () => {
      check(checks().join('|') === '0', `the check follows the switch (${checks().join(', ')})`)

      // Every row carries a drag source on its handle and a drop target.
      const handle = reorderHandle(rows()[0])
      const source = handle === undefined ? null : controllersOf(handle).find((c) => c.constructor.name === 'GtkDragSource')
      const target = controllersOf(rows()[0]).find((c) => c.constructor.name === 'GtkDropTarget')
      check(source !== undefined && source !== null, 'each row has a drag handle')
      check(target !== undefined, 'each row accepts a dropped session')
      const provider = source?.emit('prepare', 0, 0)
      check(
        provider !== undefined && provider !== null,
        `the drag carries a payload (${provider?.constructor?.name})`,
      )

      // Drop Meet weekly on the first row's top half: it lands before it.
      const dropped = target?.emit('drop', dragValue('meeting'), 5, 5)
      check(dropped === true, 'the drop is accepted')
      check(
        library.entries.map((entry) => entry.id).join('|') === 'meeting|default|practice',
        `the library reorders (${library.entries.map((entry) => entry.id).join(', ')})`,
      )
      GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 300, () => {
        check(
          titles().join('|') === 'Meet weekly|Default|Practice',
          `the rows follow the new order (${titles().join(' | ')})`,
        )
        // Bottom half means after the target, so this one goes to the end.
        const lastTarget = controllersOf(rows()[2]).find((c) => c.constructor.name === 'GtkDropTarget')
        lastTarget?.emit('drop', dragValue('meeting'), 5, 999)
        check(
          library.entries.map((entry) => entry.id).join('|') === 'default|practice|meeting',
          `dropping on the bottom half appends (${library.entries.map((entry) => entry.id).join(', ')})`,
        )

        // Two deletions leave one session and must disable its Delete.
        library.remove('meeting')
        library.remove('default')
        GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 300, () => {
          check(rows().length === 1, `the list shrinks after deletions (${rows().length})`)
          const lastDelete = findAll(rows()[0], 'GtkButton').at(-1)
          check(
            lastDelete?.tooltipText === t('session.manager.delete') && lastDelete.sensitive === false,
            'the last session cannot be deleted',
          )
          dialog.close()
          GLib.idleAdd(GLib.PRIORITY_DEFAULT, () => {
            if (failures > 0) log(`${failures} FAILURE(S)`)
            else log('ALL PASS')
            log(`exit ${failures === 0 ? 0 : 1}`)
            app.quit()
            return GLib.SOURCE_REMOVE
          })
          return GLib.SOURCE_REMOVE
        })
        return GLib.SOURCE_REMOVE
      })
      return GLib.SOURCE_REMOVE
    })
    return GLib.SOURCE_REMOVE
  })
})

app.run([])
