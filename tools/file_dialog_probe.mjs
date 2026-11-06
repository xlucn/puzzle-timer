/*
 * file_dialog_probe.mjs — does Gtk.FileDialog's async callback work under
 * node-gtk?
 *
 * The M10 import/export path is the first place this codebase calls a GIO
 * async method. The .d.ts says `open(parent, cancellable, callback)` and a
 * matching `openFinish(result)`; this probe opens the real dialog, cancels it
 * a moment later through a Gio.Cancellable, and checks that the callback
 * fires and `openFinish` reports the dismissal instead of aborting the
 * process. `save` goes through the same two steps.
 *
 * Usage:
 *   DISPLAY=:99 GDK_BACKEND=x11 node --import tsx --import node-gtk/register tools/file_dialog_probe.mjs
 */
import Adw from 'gi:Adw-1'
import Gio from 'gi:Gio-2.0'
import GLib from 'gi:GLib-2.0'
import GObject from 'gi:GObject-2.0'
import Gtk from 'gi:Gtk-4.0'

const log = (...args) => console.error('[file-dialog]', ...args)
let failures = 0
const check = (ok, what) => {
  log(`${ok ? 'PASS' : 'FAIL'} — ${what}`)
  if (!ok) failures += 1
}

const app = new Adw.Application({
  applicationId: 'io.github.xlucn.PuzzleTimer.probe.filedialog',
  flags: Gio.ApplicationFlags.FLAGS_NONE,
})

const after = (ms, fn) => {
  GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, ms, () => {
    fn()
    return false
  })
}

app.on('activate', () => {
  const window = new Adw.ApplicationWindow({ application: app })
  window.setDefaultSize(640, 480)
  window.present()

  /** The M10 dialog shape: one csTimer filter, default and in the model. */
  const jsonFilter = new Gtk.FileFilter({
    name: 'csTimer data',
    patterns: ['*.json', '*.txt'],
    suffixes: ['json', 'txt'],
  })
  const filters = Gio.ListStore.new(GObject.typeFromName('GtkFileFilter'))
  filters.append(jsonFilter)

  const checkOpen = () => {
    const dialog = new Gtk.FileDialog({
      title: 'Probe open',
      filters,
      defaultFilter: jsonFilter,
    })
    const cancellable = new Gio.Cancellable()
    let callback = false
    dialog.open(window, cancellable, (...args) => {
      callback = true
      check(args.length >= 2, `open callback carries the result (${args.length} args)`)
      try {
        dialog.openFinish(args[1])
        check(false, 'openFinish returned after a cancel')
      } catch (error) {
        check(
          error instanceof Error && /dismiss|cancel/i.test(error.message),
          `openFinish reports the dismissal ("${error.message}")`,
        )
        log(
          `openFinish error: ${error instanceof Error ? error.name : typeof error}`,
          `code=${String(error?.code)} domain=${String(error?.domain)} keys=${Object.keys(error ?? {}).join(',')}`,
        )
      }
      checkSave()
    })
    after(400, () => cancellable.cancel())
    after(3000, () => {
      if (!callback) {
        check(false, 'open callback never fired')
        finish()
      }
    })
  }

  const checkSave = () => {
    const dialog = new Gtk.FileDialog({
      title: 'Probe save',
      filters,
      defaultFilter: jsonFilter,
      initialName: 'puzzle-timer.json',
    })
    const cancellable = new Gio.Cancellable()
    let callback = false
    dialog.save(window, cancellable, (...args) => {
      callback = true
      check(args.length >= 2, `save callback carries the result (${args.length} args)`)
      try {
        dialog.saveFinish(args[1])
        check(false, 'saveFinish returned after a cancel')
      } catch (error) {
        check(
          error instanceof Error && /dismiss|cancel/i.test(error.message),
          `saveFinish reports the dismissal ("${error.message}")`,
        )
        log(
          `saveFinish error: ${error instanceof Error ? error.name : typeof error}`,
          `code=${String(error?.code)} domain=${String(error?.domain)} keys=${Object.keys(error ?? {}).join(',')}`,
        )
      }
      finish()
    })
    after(400, () => cancellable.cancel())
    after(3000, () => {
      if (!callback) {
        check(false, 'save callback never fired')
        finish()
      }
    })
  }

  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`)
    app.quit()
  }

  window.on('close-request', () => false)
  after(300, checkOpen)
})

app.run([])
