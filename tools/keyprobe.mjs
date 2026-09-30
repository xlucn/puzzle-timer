/*
 * keyprobe — a minimal node-gtk app that prints every key event to stderr.
 *
 * Use this to check that key plumbing works before wiring a real handler:
 *
 *   GDK_BACKEND=x11 node --import tsx --import node-gtk/register tools/keyprobe.mjs &
 *   python3 tools/xtest.py --window KeyProbe press space sleep 0.6 release space tap x
 *
 * What you should see: one `key-pressed` per press (repeats while a key is
 * held are auto-repeat, not new presses) and one `key-released` per release.
 *
 * node-gtk signal conventions (verified in node_modules/node-gtk/src/closure.cc):
 *   - the handler does NOT receive the emitter as its first argument, so the
 *     signature is exactly the signal's own parameters;
 *   - whatever the handler returns becomes the signal's return value, which
 *     is how a boolean-returning signal such as `key-pressed` reports that it
 *     handled the event (returning false lets it keep propagating);
 *   - the typed signatures live in node_modules/.node-gtk-types/*.d.ts — look
 *     up the `.on("...")` overload rather than guessing.
 */
import Adw from 'gi:Adw-1'
import Gio from 'gi:Gio-2.0'
import Gtk from 'gi:Gtk-4.0'

const app = new Adw.Application({
  applicationId: 'com.oliver.keyprobe',
  flags: Gio.ApplicationFlags.FLAGS_NONE,
})

app.on('activate', () => {
  const window = new Adw.ApplicationWindow({ application: app, title: 'KeyProbe' })

  const box = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 6,
    marginTop: 24,
    marginBottom: 24,
    marginStart: 24,
    marginEnd: 24,
  })
  box.append(new Gtk.Label({ label: 'Press keys — every event is logged to stderr.' }))
  window.setContent(box)

  // The same phase the real app uses: capture so a focused widget upstream
  // (a header MenuButton, say) cannot swallow the key first.
  const keys = new Gtk.EventControllerKey()
  keys.setPropagationPhase(Gtk.PropagationPhase.CAPTURE)
  window.addController(keys)

  keys.on('key-pressed', (keyval, keycode, state) => {
    console.error(
      `key-pressed  keyval=0x${Number(keyval).toString(16)} keycode=${keycode} state=${state}`,
    )
    return false // let the event continue; only the real timer consumes keys
  })
  keys.on('key-released', (keyval) => {
    console.error(`key-released keyval=0x${Number(keyval).toString(16)}`)
  })

  window.setDefaultSize(420, 160)
  window.on('close-request', () => (app.quit(), false))
  window.present()
})

app.run([])
