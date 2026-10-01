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
 * the sidebar's session menu (src/ui/sessionMenu.ts) drives it, and the
 * sidebar follows whichever session is active. All timing, scramble, session
 * and solve policy live in src/core/, which knows nothing about GTK.
 *
 * Layout F (2026-10-01): the sidebar owns the app chrome — its header holds
 * the app name and the app menu (About / Keyboard Shortcuts / Quit), the
 * session switch sits under it, and the solve list under that. The content
 * header keeps only the timer's controls: sidebar toggle, category/type
 * switchers, refresh, the app-functions menu (Statistics / WCA Inspection,
 * M4), and the window controls.
 */
import Adw from 'gi:Adw-1'
import Gdk from 'gi:Gdk-4.0'
import Gio from 'gi:Gio-2.0'
import GLib from 'gi:GLib-2.0'
import Gtk from 'gi:Gtk-4.0'

import { styles } from 'node-gtk/styles'

import { ScrambleFeed } from './core/scrambleFeed.js'
import type { Preferences } from './core/preferences.js'
import { SCRAMBLE_DEFAULT_TYPE, scrambleLength } from './core/scrambleTypes.js'
import { Session, type RemovedSolve, type Solve, type Unsubscribe } from './core/session.js'
import { SessionLibrary } from './core/sessionLibrary.js'
import type { Penalty } from './core/time.js'
import { Timer, type TimerState } from './core/timer.js'
import { playInspectionCue } from './platform/audio.js'
import * as store from './platform/store.js'
import { createScrambleService } from './scramble/service.js'
import { createPreferences } from './ui/preferences.js'
import { createScramblePanel } from './ui/scramblePanel.js'
import { createScrambleTypeSelect } from './ui/scrambleTypeSelect.js'
import { createSessionMenu } from './ui/sessionMenu.js'
import { createShortcutsWindow, type ShortcutsWindow } from './ui/shortcuts.js'
import { createStatsPanel } from './ui/statsPanel.js'
import { createStatsStrip } from './ui/statsStrip.js'
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
  // Escape by name: the core cancels an inspection on it (everything else
  // reaches the timer as its raw keyval, which is stable but unreadable).
  if (keyval === Gdk.KEY_Escape) return 'escape'
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
  // 900×540 again (layout F, 2026-10-01): the content header lost the window
  // title and the session pill to the sidebar, dropping its natural demand to
  // ~560 (start: toggle + category/type + refresh; end: app-functions +
  // window controls). At 900 the sidebar takes its 240 floor (0.25W = 225
  // clamps up), so the header gets 660 ≥ ~560 — verified uncut after the
  // change. M6 is what keeps this right when the window is dragged smaller;
  // for now this is the startup size (user call, 2026-10-01).
  window.setDefaultSize(900, 540)

  // ---- content header: the timer's controls ------------------------------
  // No title here (layout F, 2026-10-01): the app name is the *sidebar's*
  // header, and the window title still goes to the taskbar. Dropping it (and
  // the session pill that used to sit here) is part of what lets the header
  // render uncut at 900 px — see the setDefaultSize comment above.
  const header = new Adw.HeaderBar({ showTitle: false })

  // App functions, packed at the end before the window controls: the
  // Preferences and Statistics dialogs and the WCA inspection toggle (M5
  // added Preferences; the dialog itself is src/ui/preferences.ts). About /
  // Keyboard Shortcuts / Quit are application-level, so they live in the
  // sidebar's app menu instead (user call, layout F). The toggle is a
  // stateful boolean action, so GTK draws the checkmark against the
  // action's state itself.
  const appFunctions = new Gio.Menu()
  appFunctions.append('Preferences', 'app.preferences')
  appFunctions.append('Statistics', 'app.statistics')
  const appToggles = new Gio.Menu()
  appToggles.append('WCA Inspection', 'app.inspection')
  appFunctions.appendSection(null, appToggles)
  header.packEnd(
    new Gtk.MenuButton({
      iconName: 'open-menu-symbolic',
      menuModel: appFunctions,
      tooltipText: 'App functions',
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

  // Settings (M5): one object for the whole run. Every change goes through
  // applyPreferences() below (defined with the timer wiring), so the file on
  // disk and the running app can never hold different values.
  const loadedPrefs = store.loadPreferences()
  if (loadedPrefs.notice !== null) console.error(`[store] ${loadedPrefs.notice}`)
  let prefs = loadedPrefs.preferences

  // The colour scheme is applied as soon as prefs are known — before the
  // window is presented — so the very first paint is already right. On the
  // default StyleManager, ColorScheme.DEFAULT follows the system (light
  // fallback); FORCE_LIGHT / FORCE_DARK ignore it entirely.
  const applyColorScheme = (scheme: Preferences['colorScheme']): void => {
    Adw.StyleManager.getDefault().setColorScheme(
      scheme === 'dark'
        ? Adw.ColorScheme.FORCE_DARK
        : scheme === 'light'
          ? Adw.ColorScheme.FORCE_LIGHT
          : Adw.ColorScheme.DEFAULT,
    )
  }
  applyColorScheme(prefs.colorScheme)

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

  // The session control lives in the sidebar (layout F): a full-width row
  // under the sidebar's header, labeling the list it switches — so it is
  // built first and handed to createTimesList below. Ctrl+S can arrive while
  // the sidebar is closed, and a popover cannot anchor to an unmapped
  // widget: ensureVisible() reveals the sidebar through the toggle (which is
  // already in both directions sync with the split view), and the menu pops
  // itself once the button has been mapped.
  const sessionMenu = createSessionMenu({
    library,
    app,
    window,
    getSolveCount: (id) => sessionFor(id).size,
    ensureVisible: () => sidebarToggle.setActive(true),
  })

  // The app menu travels with the sidebar's header (layout F): About, the
  // keyboard reference and Quit — application-level actions, which is what
  // a primary menu is for.
  const appMenuModel = new Gio.Menu()
  appMenuModel.append(`About ${APP_NAME}`, 'app.about')
  appMenuModel.append('Keyboard Shortcuts', 'app.shortcuts')
  appMenuModel.append('Quit', 'app.quit')
  const appMenuButton = new Gtk.MenuButton({
    iconName: 'open-menu-symbolic',
    menuModel: appMenuModel,
    primary: true,
    tooltipText: 'Main menu',
  })

  const timesList = createTimesList({
    library,
    getSession: activeSession,
    onDelete: removeSolves,
    appName: APP_NAME,
    appMenu: appMenuButton,
    sessionControl: sessionMenu.widget,
    window,
  })

  // ---- timer + scramble: worker-backed generation, prefetched by the feed -
  // The timer starts on the stored preferences (M5): the hold threshold it
  // arms on and whether the first release begins an inspection.
  const timer = new Timer({
    holdThresholdMs: prefs.holdThresholdMs,
    startKey: START_KEY,
    inspection: prefs.inspection,
  })
  // The ao5/ao12 strip rides under the timer's hint line (M4): same live
  // session reading as the list, so it tracks adds, penalties and switches.
  const statsStrip = createStatsStrip({ library, getSession: activeSession })
  const timerView = createTimerView({ statsStrip })

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
    onChange: (type) => {
      feed.setType(type)
      // The choice belongs to the active session — a switch restores it
      // (below); setScrambleType's `retyped` event rides the index
      // subscription from the top of this function.
      library.setScrambleType(library.activeId, type)
    },
  })
  header.packStart(typeSelect.widget)

  /**
   * Scramble type is per session: switching applies the new active
   * session's type to the dropdowns and the feed (absent = the default
   * type, which the feed is already on — nothing moves, no regeneration).
   * Unknown ids from a hand-edited index are ignored by selectType.
   */
  const applySessionType = (id: string): void => {
    const type = library.find(id)?.scrambleType ?? SCRAMBLE_DEFAULT_TYPE
    if (type !== feed.state.type && typeSelect.selectType(type)) feed.setType(type)
  }
  library.subscribe((change) => {
    if (change.kind === 'switched') applySessionType(change.id)
  })
  applySessionType(library.activeId) // startup: a stored type beats the default

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
  // very first one is still generating; record the solve anyway. The
  // penalty comes from the timer: an inspection that ran past 15 s (or
  // 17 s) starts the run graded +2 / DNF.
  timer.onSolved((elapsedMs, penalty) => {
    const { scramble, type } = feed.state
    activeSession().add({
      timeMs: elapsedMs,
      scramble: scramble ?? '',
      scrambleType: type,
      createdAtMs: Date.now(),
      penalty,
    })
    feed.advance()
  })

  // WCA acoustic signals: one beep at 8 s, two at 12 s (core decides when).
  // The preference gates them here rather than in the timer — core decides
  // *when* a cue is due, the app decides whether the user wants to hear it.
  timer.onCue((cue) => {
    if (prefs.inspectionSound) playInspectionCue(cue)
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
  // progress, an inspection counting down, or a solve being timed.
  // Everywhere else the display is static.
  const needsTick = (state: TimerState) =>
    state === 'holding' || state === 'inspecting' || state === 'running'
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

  // The keyboard reference (src/ui/shortcuts.ts), opened from the sidebar's
  // app menu. Built lazily and kept: hide-on-close means one window per run,
  // and a node-gtk failure around Gtk.ShortcutsWindow (if there is one) then
  // only costs this menu item, not the whole startup path. No accelerator of
  // its own — the window *is* the accelerator documentation.
  let shortcutsWindow: ShortcutsWindow | null = null
  const shortcutsAction = Gio.SimpleAction.new('shortcuts', null)
  shortcutsAction.on('activate', () => {
    if (shortcutsWindow === null) shortcutsWindow = createShortcutsWindow(window)
    shortcutsWindow.present()
  })
  app.addAction(shortcutsAction)

  // The Statistics dialog (src/ui/statsPanel.ts): the full current/best/
  // target table behind the app-functions menu. The component registers its
  // own action, like the session menu does.
  createStatsPanel({ app, window, library, getSession: activeSession })
  // Keybindings for the app-functions menu (user call, 2026-10-01): every
  // menu action must be reachable from the keyboard, so tests never need a
  // synthetic click (tools/README traps 4–5). Ctrl+T: Statistics (Ctrl+S is
  // the session menu); Ctrl+I: Inspection.
  app.setAccelsForAction('app.statistics', ['<Control>t'])

  // WCA inspection toggle (M4): the menu check item's state lives here —
  // seeded from (and written back to) the M5 preferences — activate hands
  // the new value straight to applyPreferences below, which pushes it into
  // the timer (which cancels a running inspection if the toggle goes off
  // mid-countdown).
  //
  // The parameter type MUST be null: this is a plain toggle, activated by
  // Ctrl+I and the menu check item with no argument. Declaring 'b' instead
  // makes GTK refuse those no-argument activations outright — warning
  // "Trying to invoke action without arguments, but action expects
  // parameter with type 'b'" and a silently dead toggle (user-caught,
  // 2026-10-02). Parameterized actions are fine with a type — see
  // sessionSwitch in sessionMenu.ts, whose items carry their target.
  const inspectionAction = Gio.SimpleAction.newStateful(
    'inspection',
    null,
    GLib.Variant.newBoolean(prefs.inspection),
  )
  inspectionAction.on('activate', () => {
    // getState() is typed nullable (GSimpleAction can have no state); ours
    // always has one, and "no state" would read as off anyway.
    const next = !(inspectionAction.getState()?.getBoolean() ?? false)
    applyPreferences({ inspection: next })
  })
  app.addAction(inspectionAction)
  app.setAccelsForAction('app.inspection', ['<Control>i'])

  /**
   * The single path for a settings change (M5): merge the patch into this
   * run's Preferences, persist it, then push the new values into everything
   * they drive. The preferences dialog and the inspection menu check item
   * both come through here, so the checkmark, the timer and prefs.json can
   * never disagree.
   */
  const applyPreferences = (patch: Partial<Preferences>): void => {
    prefs = { ...prefs, ...patch }
    store.savePreferences(prefs)

    if ('holdThresholdMs' in patch) timer.setHoldThreshold(prefs.holdThresholdMs)
    if ('colorScheme' in patch) applyColorScheme(prefs.colorScheme)
    if ('inspection' in patch) {
      // setState does not re-activate the action, so this cannot loop back
      // into the handler above.
      inspectionAction.setState(GLib.Variant.newBoolean(prefs.inspection))
      timer.setInspection(prefs.inspection, nowMs())
    }
  }

  // The Preferences dialog (src/ui/preferences.ts): built fresh on open, one
  // patch per row change, routed through applyPreferences. Ctrl+comma — the
  // freed `<Ctrl>S` is the session menu.
  createPreferences({
    app,
    window,
    get: () => prefs,
    set: (patch) => applyPreferences(patch),
  })
  app.setAccelsForAction('app.preferences', ['<Control>comma'])

  // ---- editing a solve (M4 stage 4) --------------------------------------
  // Ctrl+1/2/3 = OK / +2 / DNF on the *newest* solve of the active session
  // (PLAN's "no Ctrl+Z"): repeating a penalty clears it, so Ctrl+2 twice is
  // its own undo. They are quick grades, deliberately separate from the
  // edit dialog. Ctrl+E opens the one edit dialog — penalty (OK/+2/DNF) and
  // comment together — on the selection when exactly one row is on it, else
  // the newest solve; the footer's Edit button and a double-click on a row
  // reach the same dialog (src/ui/timesList.ts).
  const applyLatest = (penalty: Penalty | undefined): void => {
    const session = activeSession()
    const solves = session.solves
    if (solves.length === 0) return
    const latest = solves[solves.length - 1]
    const next = penalty !== undefined && latest.penalty !== penalty ? penalty : undefined
    session.setPenalty(latest.id, next)
  }

  const solveOk = Gio.SimpleAction.new('solve-ok', null)
  solveOk.on('activate', () => applyLatest(undefined))
  app.addAction(solveOk)
  app.setAccelsForAction('app.solve-ok', ['<Control>1'])

  const solvePlus2 = Gio.SimpleAction.new('solve-plus2', null)
  solvePlus2.on('activate', () => applyLatest('plus2'))
  app.addAction(solvePlus2)
  app.setAccelsForAction('app.solve-plus2', ['<Control>2'])

  const solveDnf = Gio.SimpleAction.new('solve-dnf', null)
  solveDnf.on('activate', () => applyLatest('dnf'))
  app.addAction(solveDnf)
  app.setAccelsForAction('app.solve-dnf', ['<Control>3'])

  const editAction = Gio.SimpleAction.new('solve-edit', null)
  editAction.on('activate', () => timesList.editSelected())
  app.addAction(editAction)
  app.setAccelsForAction('app.solve-edit', ['<Control>e'])

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

  // Surface the load notices (details already went to stderr).
  if (index.notice !== null) {
    toastOverlay.addToast(new Adw.Toast({ title: 'Session list could not be read', timeout: 10 }))
  }
  if (loadedPrefs.notice !== null) {
    toastOverlay.addToast(
      new Adw.Toast({ title: 'Settings could not be read — defaults are in use', timeout: 10 }),
    )
  }

  // The loop integration is already running; under ESM this returns immediately.
  // The app keeps running until the close handler (or quit action) stops it.
  loop.run()
})

// Must be the last statement — returns immediately under ESM (see top of file).
app.run([])
