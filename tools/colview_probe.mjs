/*
 * colview_probe — does the Gtk.ColumnView plumbing work under node-gtk?
 *
 * M2's solve list is a ColumnView with a Gtk.MultiSelection and a footer
 * Gtk.ActionBar that reveals itself when rows are selected
 * (src/ui/timesList.ts). Three things could silently misbehave, and this
 * probe checks all of them in ~3 s:
 *
 *   1. does the factory emit setup/bind, and with what object?
 *   2. can a bound cell read its position → id → row text through the model?
 *   3. does the selection walk — `isSelected()` over model positions, then
 *      id → solve — return exactly the selected rows, and does the ActionBar
 *      reveal with it and collapse again once a rebuild clears the selection?
 *      That walk is what the footer's Delete button and the Delete key both
 *      act on, and no amount of staring at the app can prove it.
 *
 *   GDK_BACKEND=x11 node --import tsx --import node-gtk/register tools/colview_probe.mjs
 */
import Adw from 'gi:Adw-1'
import Gio from 'gi:Gio-2.0'
import GLib from 'gi:GLib-2.0'
import Gtk from 'gi:Gtk-4.0'

const log = (...args) => console.error('[probe]', ...args)

/** Stand-in for the session's solves: display order, newest first. */
const solves = [
  { id: 3, index: 2, time: '12.34', clock: '14:32' },
  { id: 2, index: 1, time: '9.87', clock: '14:28' },
  { id: 1, index: 0, time: '15.02', clock: '14:25' },
]

const app = new Adw.Application({
  applicationId: 'com.oliver.colviewprobe',
  flags: Gio.ApplicationFlags.FLAGS_NONE,
})

let setupCount = 0
let bindCount = 0

app.on('activate', () => {
  const window = new Adw.ApplicationWindow({ application: app, title: 'ColViewProbe' })

  // ---- model: one string per row, holding the solve id -----------------
  const model = Gtk.StringList.new(solves.map((solve) => String(solve.id)))
  // Multi-select, no autoselect — mirrors src/ui/timesList.ts.
  const selection = Gtk.MultiSelection.new(model)
  const view = Gtk.ColumnView.new(selection)

  const column = (title, text) => {
    const factory = Gtk.SignalListItemFactory.new()

    factory.on('setup', (cell) => {
      setupCount += 1
      if (setupCount === 1) {
        log('setup #1: constructor =', cell.constructor?.name, 'getPosition =', typeof cell.getPosition, 'position =', cell.position)
      }
      // Plain label: no per-cell popover or action group any more.
      cell.setChild(new Gtk.Label({ xalign: 0, hexpand: true })) // left-align, as in timesList.ts
    })

    factory.on('bind', (cell) => {
      bindCount += 1
      const position = cell.getPosition()
      const id = Number(model.getString(position))
      const solve = solves.find((entry) => entry.id === id)
      if (bindCount <= 3) {
        log(`bind: pos=${position} id=${id} item=${typeof cell.getItem} label=${text(solve)}`)
      }
      cell.getChild().setLabel(text(solve))
    })

    const col = Gtk.ColumnViewColumn.new(title, factory)
    // fixed-width stays at its default (-1) = native content-fit, columns
    // not resizable — both exactly as in src/ui/timesList.ts.
    col.setResizable(false)
    return col
  }

  const indexColumn = column('#', (solve) => `#${solve.index + 1}`)
  const timeColumn = column('Time', (solve) => solve.time)
  const solvedColumn = column('Solved', (solve) => solve.clock)
  // Time and Solved expand, `#` stays content-fit — as in timesList.ts.
  timeColumn.setExpand(true)
  solvedColumn.setExpand(true)
  view.appendColumn(indexColumn)
  view.appendColumn(timeColumn)
  view.appendColumn(solvedColumn)
  view.setShowRowSeparators(true)

  // ---- footer: the action bar the selection reveals --------------------
  const footerInfo = new Gtk.Label({ xalign: 0, hexpand: true })
  const footer = new Gtk.ActionBar({ revealed: false })
  footer.setCenterWidget(footerInfo)
  const footerRow = footer // sensitive gate, as in timesList.ts

  const scroller = new Gtk.ScrolledWindow({
    child: view,
    vexpand: true,
    hexpand: true,
    minContentWidth: 300,
  })

  const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
  box.append(scroller)
  box.append(footer)
  window.setContent(box)
  window.setDefaultSize(340, 240)
  window.on('close-request', () => (app.quit(), false))
  window.present()

  /** Exactly the walk src/ui/timesList.ts runs for Delete and the footer. */
  const selectedSolves = () => {
    const picked = []
    for (let position = 0; position < model.nItems; position += 1) {
      if (!selection.isSelected(position)) continue
      const id = Number(model.getString(position))
      const solve = solves.find((entry) => entry.id === id)
      if (solve !== undefined) picked.push(solve)
    }
    return picked
  }

  const syncFooter = () => {
    const picked = selectedSolves()
    footer.setRevealed(picked.length > 0)
    footerRow.setSensitive(picked.length > 0)
    if (picked.length > 0) {
      footerInfo.setLabel(
        picked.length === 1 ? `#${picked[0].index + 1}  ·  ${picked[0].time}` : `${picked.length} selected`,
      )
    }
    return picked
  }
  selection.on('selection-changed', syncFooter)

  // ---- checks ------------------------------------------------------------
  // Column sizing, in causal order: GtkColumnViewColumn:fixed-width=-1 (the
  // default, what timesList.ts now relies on) must (1) start sized to
  // content — nowhere near the old 44+84+130=258px sum — and (2) grow when
  // the content grows; an explicit width must then override content.
  GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 700, () => {
    const natural = () => view.measure(Gtk.Orientation.HORIZONTAL, -1)[1]
    log(`natural width, short content, auto-fit=${natural()}px`)
    solves.forEach((entry) => { entry.clock = `14:32:45.${entry.id}` })
    model.splice(0, model.nItems, solves.map((entry) => String(entry.id)))
    return GLib.SOURCE_REMOVE
  })

  GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 1050, () => {
    const natural = () => view.measure(Gtk.Orientation.HORIZONTAL, -1)[1]
    log(`natural width, long content, auto-fit=${natural()}px (must be larger)`)
    timeColumn.setFixedWidth(84)
    log(`natural width, long content, Time pinned to 84=${natural()}px (explicit width ignores content)`)
    timeColumn.setFixedWidth(-1)
    return GLib.SOURCE_REMOVE
  })

  GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 1400, () => {
    log(`setup=${setupCount} bind=${bindCount} (expect 3 rows × 3 columns where visible)`)

    // A range select: first and last row, as shift-clicking would leave it.
    selection.selectItem(0, true)
    selection.selectItem(2, false)
    const picked = syncFooter()
    log(`selected ids = [${picked.map((solve) => solve.id).join(', ')}] (expect 3, 1)`)
    log(`footer revealed = ${footer.getRevealed()} label = ${footerInfo.getLabel()}`)

    // "Delete" the selection: drop it from the store and rebuild the model
    // in one splice, the way a change reaches the real list.
    for (const solve of picked) solves.splice(solves.indexOf(solve), 1)
    model.splice(0, model.nItems, solves.map((solve) => String(solve.id)))
    selection.unselectAll()
    const after = syncFooter()
    log(`after delete: remaining ids = [${solves.map((s) => s.id).join(', ')}] (expect 2), ` +
        `selected = ${after.length}, footer revealed = ${footer.getRevealed()} (expect false)`)
    return GLib.SOURCE_REMOVE
  })

  GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 3000, () => {
    log('done')
    app.quit()
    return GLib.SOURCE_REMOVE
  })
})

app.run([])
