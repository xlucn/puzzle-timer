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
 * M2 scope: solving. Every finished solve is recorded against the scramble
 * that was on screen (src/core/session.ts), listed newest-first in a
 * Gtk.ColumnView sidebar (src/ui/timesList.ts), and persisted to an atomic
 * JSON file in the XDG data dir (src/platform/store.ts) — so the list
 * survives a restart. Select rows (click, Shift/Ctrl-click) and the sidebar's
 * toolbar — or the Delete key — remove them together, one undo toast for the
 * whole batch. Scrambles still come from cstimer_module in
 * a worker (M1, see src/scramble/); statistics (M4) come next — see PLAN.md.
 *
 * M3 scope: sessions. A session list on disk (index + one solve file per
 * session, src/platform/store.ts) around a core SessionLibrary
 * (src/core/sessionLibrary.ts) that can create, rename, switch and delete;
 * the header's session menu (src/ui/sessionMenu.ts) drives it, and the
 * sidebar follows whichever session is active. All timing, scramble, session
 * and solve policy live in src/core/, which knows nothing about GTK.
 */
import Adw from 'gi:Adw-1'
import Gdk from 'gi:Gdk-4.0'
import Gio from 'gi:Gio-2.0'
import GLib from 'gi:GLib-2.0'
import Gtk from 'gi:Gtk-4.0'

import { styles } from 'node-gtk/styles'

import { ScrambleFeed } from './core/scrambleFeed.js'
import { SCRAMBLE_DEFAULT_TYPE, scrambleLength } from './core/scrambleTypes.js'
import { Session, type RemovedSolve, type Solve, type Unsubscribe } from './core/session.js'
import { SessionLibrary } from './core/sessionLibrary.js'
import { Timer, type TimerState } from './core/timer.js'
import * as store from './platform/store.js'
import { createScrambleService } from './scramble/service.js'
import { createScramblePanel } from './ui/scramblePanel.js'
import { createScrambleTypeSelect } from './ui/scrambleTypeSelect.js'
import { createSessionMenu } from './ui/sessionMenu.js'
import { createTimerView } from './ui/timerLabel.js'
import { createTimesList } from './ui/timesList.js'

const APP_ID = 'com.oliver.cstimergtk'
const APP_NAME = 'csTimer GTK'

/** ~60 fps is plenty for a centisecond readout, and costs almost nothing. */
const TICK_MS = 16

/** Identity the core Timer uses for the start key (see src/core/timer.ts). */
const START_KEY = 'space'

/**
 * Keys carrying these modifiers are left alone entirely, so application
 * accelerators (Ctrl+Q, and later Ctrl+1-3 for M4's penalties) keep working.
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
  // Wide enough for the whole header to render uncut (measured, M3): at 900
  // the content header is 660 logical against a natural demand of ~686 —
  // over by ~40, so GTK shrank the session label and the window title. The
  // sidebar takes clamp(0.25W, 240, 320), so the header is 0.75W here: 1080
  // → sidebar 270, header 810 ≥ ~760 needed (start 442 + title 90 + end 154,
  // with a full-length session name). M6 is what makes this *stay* right when
  // the window is dragged smaller; for now, start wide (user call, 2026-10-01).
  window.setDefaultSize(1080, 540)

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

  // Wired to the split view further down; a ToggleButton so the pressed state
  // tracks the sidebar even when it is closed some other way. Packed at the
  // start: the list lives in the left sidebar, so its toggle belongs on that
  // side — and before the scrambler dropdowns (packed further down), so it
  // renders leftmost, right beside the sidebar it opens.
  const sidebarToggle = new Gtk.ToggleButton({
    iconName: 'sidebar-show-symbolic',
    tooltipText: 'Show solve list',
    active: true,
    cssClasses: ['flat'],
  })
  header.packStart(sidebarToggle)

  // ---- sessions: which list a solve lands in ----------------------------
  // The index on disk says which sessions exist and which is active;
  // src/core/sessionLibrary.ts owns the rules (unique names, never empty)
  // and announces every change. Notices are printed now and toasted after
  // the window is up — a session file that could not be parsed has been
  // moved aside by the store, and that must be said, not quietly restarted.
  const index = store.loadIndex()
  if (index.notice !== null) console.error(`[store] ${index.notice}`)
  const library = new SessionLibrary(index.sessions, index.activeId)

  const toastOverlay = new Adw.ToastOverlay()

  /**
   * One Session instance per id for the whole run, each with its own
   * persistence subscription — so a change to a session that is *not* active
   * still reaches disk (an undo toast can outlive the switch that followed
   * it). Caching also keeps a switch from re-reading a file whose write is
   * still sitting in the store's debounce window.
   */
  const loadedSessions = new Map<string, { session: Session; unsubscribe: Unsubscribe }>()
  const sessionFor = (id: string): Session => {
    const cached = loadedSessions.get(id)
    if (cached !== undefined) return cached.session

    const fromDisk = store.loadSession(id)
    if (fromDisk.notice !== null) {
      // stderr has the detail; the user gets the headline — whenever the file
      // is first touched, which for a background session is the switch that
      // opens it. Toasting here rather than at startup means an empty list is
      // never silent about why it is empty.
      console.error(`[store] ${fromDisk.notice}`)
      toastOverlay.addToast(new Adw.Toast({ title: 'Session file could not be read', timeout: 10 }))
    }
    const session = new Session(fromDisk.solves)
    const unsubscribe = session.subscribe(() => store.scheduleSave(id, session.solves))
    loadedSessions.set(id, { session, unsubscribe })
    return session
  }
  const activeSession = (): Session => sessionFor(library.activeId)

  // Every list change is written immediately: the index is a few dozen bytes
  // and only changes on create / rename / delete / switch, so there is
  // nothing to debounce — and an atomic write means a crash right after a
  // delete cannot leave a ghost entry pointing at a file that is gone.
  library.subscribe((change) => {
    store.saveIndex(library.entries, library.activeId)
    if (change.kind !== 'deleted') return

    // Forget the session *before* its file goes. An undo toast left over
    // from that session must not resurrect a file the index no longer lists
    // (its Session stops being subscribed here, so nothing would save it).
    const cached = loadedSessions.get(change.entry.id)
    if (cached !== undefined) {
      cached.unsubscribe()
      loadedSessions.delete(change.entry.id)
    }
    store.deleteSessionFile(change.entry.id)
  })

  // The index doubles as the M2 migration: with no index on disk the store
  // rebuilds one from the session files it finds (M2 left `default.json`), so
  // write the list back once here — first run, migration or recovery alike.
  store.saveIndex(library.entries, library.activeId)

  /**
   * Deletion is always undoable, however it was triggered — and a whole
   * selection goes back with one click: the removals are restored in
   * reverse order, each at the index recorded when *it* happened, which
   * lands every solve exactly where it was. The toast restores into the
   * session it deleted from, even if another one is active by the time the
   * user clicks Undo.
   */
  const offerUndo = (target: Session, removed: readonly RemovedSolve[]) => {
    const toast = new Adw.Toast({
      title: removed.length === 1 ? 'Solve deleted' : `${removed.length} solves deleted`,
      buttonLabel: 'Undo',
    })
    toast.on('button-clicked', () => {
      for (const entry of [...removed].reverse()) target.restore(entry)
    })
    toastOverlay.addToast(toast)
  }

  const removeSolves = (solves: readonly Solve[]) => {
    // The session the rows came from: `activeSession()` is where the list is
    // reading, and the two cannot have drifted (the call is synchronous).
    const target = activeSession()
    const removed: RemovedSolve[] = []
    for (const solve of solves) {
      const entry = target.remove(solve.id)
      if (entry !== null) removed.push(entry)
    }
    if (removed.length > 0) offerUndo(target, removed)
  }

  const timesList = createTimesList({
    library,
    getSession: activeSession,
    onDelete: removeSolves,
  })

  // The header control: current session as the label, every session plus
  // New / Rename / Delete underneath it — packed after the sidebar toggle,
  // which opens the list this session owns.
  const sessionMenu = createSessionMenu({
    library,
    app,
    window,
    getSolveCount: (id) => sessionFor(id).size,
  })
  header.packStart(sessionMenu.widget)

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

  // A finished solve is recorded against the scramble that was on screen —
  // read before advance(), which swaps in the pre-generated one — and then
  // the feed promotes that scramble and warms the one after it, so the next
  // solve never waits on the scrambler. `scramble` is null only while the
  // very first one is still generating; record the solve anyway.
  timer.onSolved((elapsedMs) => {
    const { scramble, type } = feed.state
    activeSession().add({
      timeMs: elapsedMs,
      scramble: scramble ?? '',
      scrambleType: type,
      createdAtMs: Date.now(),
    })
    feed.advance()
  })

  // ---- content: header, scramble, centered timer -------------------------
  const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
  content.append(header)
  content.append(scramblePanel.widget)
  content.append(timerView.widget)

  // The solve list is a sidebar over the left-hand edge: it can be closed,
  // and closing it hands the full width back to the timer. `collapsed` stays
  // false — the list is a persistent pane, not a drawer (a breakpoint that
  // turns it into a drawer on narrow windows is M6). START puts it
  // left; nothing else claims that side (PLAN §7).
  const split = new Adw.OverlaySplitView({
    content,
    sidebar: timesList.widget,
    sidebarPosition: Gtk.PackType.START,
    minSidebarWidth: 240,
    maxSidebarWidth: 320,
    sidebarWidthUnit: Adw.LengthUnit.PX,
    showSidebar: sidebarToggle.active,
  })

  sidebarToggle.on('toggled', () => split.setShowSidebar(sidebarToggle.active))
  split.on('notify::show-sidebar', () => sidebarToggle.setActive(split.getShowSidebar()))

  toastOverlay.setChild(split)
  window.setContent(toastOverlay)

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

    // A focused text entry owns every key. Without this the timer would
    // swallow the Space in "Meet weekly" (the start key is consumed on
    // purpose) and Delete would remove selected solves instead of the
    // character under the caret — the name dialog is in this same window.
    const focus = window.getFocus() as { getText?: () => string } | null
    if (focus !== null && typeof focus.getText === 'function') return false

    const key = keyId(keyval)
    if (key === null) return false

    const wasRunning = timer.state === 'running'

    // Delete removes the selected solve — but while a solve is running every
    // key means "stop", so the branch below gets it first.
    if (!wasRunning && keyval === Gdk.KEY_Delete && timesList.deleteSelected()) return true

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
  // goes, otherwise it outlives the window it was serving. The pending
  // session write goes first — a solve recorded a moment before quitting
  // must still be on disk after the restart.
  const shutdown = () => {
    store.flush()
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

  // Surface the index's load notice (details already went to stderr).
  if (index.notice !== null) {
    toastOverlay.addToast(new Adw.Toast({ title: 'Session list could not be read', timeout: 10 }))
  }

  // The loop integration is already running; under ESM this returns immediately.
  // The app keeps running until the close handler (or quit action) stops it.
  loop.run()
})

// Must be the last statement — returns immediately under ESM (see top of file).
app.run([])
