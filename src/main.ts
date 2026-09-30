/*
 * csTimer GTK — an Adwaita application built with node-gtk.
 *
 * Namespaces are imported with the `gi:` scheme (`import Gtk from 'gi:Gtk-4.0'`);
 * the app is run with `node --import tsx --import node-gtk/register src/main.ts`
 * (see the package.json scripts). node-gtk integrates the GTK main loop with
 * Node's event loop automatically — there's nothing to call to enable it.
 *
 * One ESM caveat: the blocking run call (`loop.run()` / `app.run()`) RETURNS
 * IMMEDIATELY instead of blocking. So `app.run()` is the last statement and we
 * tear everything down from the window's close handler / quit action.
 * See: https://github.com/romgrk/node-gtk/blob/master/doc/importing.md
 *
 * M1 scope: scrambles. The text above the timer comes from cstimer_module,
 * which runs in a worker thread (src/scramble/) so a 1.2 s 4x4 scramble never
 * blocks the UI, while src/core/scrambleFeed.ts decides what to show and when
 * to pre-generate the next one. Solve recording (M2), sessions (M3) and
 * statistics (M4) come next — see PLAN.md. All timing and scramble policy
 * live in src/core/, which knows nothing about GTK.
 */
import Adw from 'gi:Adw-1'
import Gdk from 'gi:Gdk-4.0'
import Gio from 'gi:Gio-2.0'
import GLib from 'gi:GLib-2.0'
import Gtk from 'gi:Gtk-4.0'

import { styles } from 'node-gtk/styles'

import { ScrambleFeed } from './core/scrambleFeed.js'
import { SCRAMBLE_DEFAULT_TYPE, scrambleLength } from './core/scrambleTypes.js'
import { Timer, type TimerState } from './core/timer.js'
import { createScrambleService } from './scramble/service.js'
import { createScramblePanel } from './ui/scramblePanel.js'
import { createScrambleTypeSelect } from './ui/scrambleTypeSelect.js'
import { createTimerView } from './ui/timerLabel.js'

const APP_ID = 'com.oliver.cstimergtk'
const APP_NAME = 'csTimer GTK'

/** ~60 fps is plenty for a centisecond readout, and costs almost nothing. */
const TICK_MS = 16

/** Identity the core Timer uses for the start key (see src/core/timer.ts). */
const START_KEY = 'space'

/**
 * Keys carrying these modifiers are left alone entirely, so application
 * accelerators (Ctrl+Q, and later Ctrl+Z / Ctrl+1-3) keep working.
 */
const COMMAND_MASK =
  Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.ALT_MASK | Gdk.ModifierType.SUPER_MASK

/** Pure modifier presses are not "a key press" for the purposes of stopping. */
const MODIFIER_KEYVALS = new Set<number>(
  [
    Gdk.KEY_Shift_L, Gdk.KEY_Shift_R,
    Gdk.KEY_Control_L, Gdk.KEY_Control_R,
    Gdk.KEY_Alt_L, Gdk.KEY_Alt_R,
    Gdk.KEY_Super_L, Gdk.KEY_Super_R,
    Gdk.KEY_Meta_L, Gdk.KEY_Meta_R,
    Gdk.KEY_Hyper_L, Gdk.KEY_Hyper_R,
    Gdk.KEY_Caps_Lock, Gdk.KEY_ISO_Level3_Shift, Gdk.KEY_Mode_switch,
  ].filter((keyval): keyval is number => typeof keyval === 'number'),
)

/**
 * Map a GDK keyval to the key identity the core expects: the start key by
 * name, everything else by its (stable, numeric) keyval. Returns null for
 * keys that must never reach the timer.
 */
function keyId(keyval: number): string | null {
  if (MODIFIER_KEYVALS.has(keyval)) return null
  return keyval === Gdk.KEY_space ? START_KEY : String(keyval)
}

/** Milliseconds on a monotonic clock — immune to wall-clock jumps. */
const nowMs = () => Number(GLib.getMonotonicTime()) / 1000

const loop = GLib.MainLoop.new(null, false)
const app = new Adw.Application({ applicationId: APP_ID, flags: Gio.ApplicationFlags.FLAGS_NONE })

app.on('activate', () => {
  // Apply style.css, layered on top of Adwaita. Under `npm run dev` the file is
  // re-read live as you edit it — no restart, no flash. style.css sits at the
  // project root, one level up from both src/ (dev, via tsx) and dist/ (built,
  // via node), so this URL resolves in either case.
  styles.addFile(new URL('../style.css', import.meta.url))

  const window = new Adw.ApplicationWindow({ application: app })
  window.setTitle(APP_NAME)
  window.setDefaultSize(720, 480)

  // ---- header bar with a primary menu ----------------------------------
  const header = new Adw.HeaderBar()

  const menu = new Gio.Menu()
  menu.append(`About ${APP_NAME}`, 'app.about')
  menu.append('Quit', 'app.quit')

  header.packEnd(
    new Gtk.MenuButton({
      iconName: 'open-menu-symbolic',
      menuModel: menu,
      primary: true,
    }),
  )

  // ---- timer + scramble: worker-backed generation, prefetched by the feed -
  const timer = new Timer({ holdThresholdMs: 300, startKey: START_KEY })
  const timerView = createTimerView()

  // The type dropdown and the refresh button live in the header; the text
  // itself sits above the timer (see createScramblePanel).
  const scrambleService = createScrambleService()
  const feed = new ScrambleFeed({
    type: SCRAMBLE_DEFAULT_TYPE,
    generate: (type) => scrambleService.scramble(type, scrambleLength(type)),
  })

  const scramblePanel = createScramblePanel()
  feed.subscribe(() => scramblePanel.render(feed.state))

  const typeSelect = createScrambleTypeSelect({
    initialType: SCRAMBLE_DEFAULT_TYPE,
    onChange: (type) => feed.setType(type),
  })
  header.packStart(typeSelect.widget)

  const refreshScramble = new Gtk.Button({
    iconName: 'view-refresh-symbolic',
    tooltipText: 'New scramble',
    cssClasses: ['flat'],
  })
  refreshScramble.on('clicked', () => feed.refresh())
  header.packStart(refreshScramble)

  // A finished solve promotes the pre-generated scramble and warms the one
  // after it, so the next solve never waits on the scrambler.
  timer.onSolved(() => feed.advance())

  // ---- content: header, scramble, centered timer -------------------------
  const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
  content.append(header)
  content.append(scramblePanel.widget)
  content.append(timerView.widget)
  window.setContent(content)

  // ---- rendering --------------------------------------------------------
  const render = () => timerView.render(timer.snapshot(nowMs()))

  // The 16 ms tick only runs while it has something to show: a hold in
  // progress, or a solve being timed. Everywhere else the display is static.
  const needsTick = (state: TimerState) => state === 'holding' || state === 'running'
  let tickId = 0

  const ensureTicking = () => {
    if (tickId !== 0 || !needsTick(timer.state)) return
    tickId = GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, TICK_MS, () => {
      timer.update(nowMs()) // emits → the subscription below re-renders
      if (!needsTick(timer.state)) {
        tickId = 0
        return GLib.SOURCE_REMOVE
      }
      return GLib.SOURCE_CONTINUE
    })
  }

  timer.subscribe(() => {
    render()
    ensureTicking()
  })

  // ---- keyboard: hold Space to arm, release to start, any key to stop ----
  // CAPTURE phase so the timer sees keys before any focused widget consumes
  // them (Gtk.MenuButton in the header would otherwise swallow Space).
  const keyController = new Gtk.EventControllerKey()
  keyController.setPropagationPhase(Gtk.PropagationPhase.CAPTURE)
  window.addController(keyController)

  keyController.on('key-pressed', (keyval, _keycode, state) => {
    if (state & COMMAND_MASK) return false // leave accelerators alone

    const key = keyId(keyval)
    if (key === null) return false

    const wasRunning = timer.state === 'running'
    timer.keyDown(key, nowMs())

    // Consume the start key so it cannot activate a focused widget, and any
    // key press that stopped a running solve.
    return wasRunning || key === START_KEY
  })

  keyController.on('key-released', (keyval) => {
    const key = keyId(keyval)
    if (key !== null) timer.keyUp(key, nowMs())
  })

  // ---- app actions (wired to the menu above) ---------------------------
  const showAbout = () => {
    // Adw.AboutWindow works on libadwaita 1.2+; we require 1.4+ elsewhere.
    const about = new Adw.AboutWindow({
      transientFor: window,
      applicationName: APP_NAME,
      applicationIcon: APP_ID,
      developerName: 'Lu Xu',
      version: '0.1.0',
      comments:
        'A native GTK4 speedcubing timer, inspired by csTimer by Shuang Chen.\n' +
        'Scrambles are provided by the cstimer_module package, part of the ' +
        'csTimer project (GPL-3.0).',
      developers: ['Lu Xu <oliver_lew@outlook.com>'],
      copyright: '© 2026 Lu Xu',
      licenseType: Gtk.License.GPL_3_0_ONLY,
    })
    about.present()
  }

  const aboutAction = Gio.SimpleAction.new('about', null)
  aboutAction.on('activate', () => showAbout())
  app.addAction(aboutAction)

  // The scramble worker is a thread of this process: drop it before the loop
  // goes, otherwise it outlives the window it was serving.
  const shutdown = () => {
    scrambleService.dispose()
    loop.quit()
    app.quit()
  }

  const quitAction = Gio.SimpleAction.new('quit', null)
  quitAction.on('activate', () => shutdown())
  app.addAction(quitAction)
  app.setAccelsForAction('app.quit', ['<Control>q'])

  window.on('close-request', () => (shutdown(), false))

  styles.install() // flush queued styles and start the dev hot-reload watcher
  render() // paint the initial state before anything happens
  feed.start() // first scramble + its warm-up; the panel paints "Generating…"
  window.present()

  // The loop integration is already running; under ESM this returns immediately.
  // The app keeps running until the close handler (or quit action) stops it.
  loop.run()
})

// Must be the last statement — returns immediately under ESM (see top of file).
app.run([])
