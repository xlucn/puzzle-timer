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
 * switchers, refresh, the app-functions menu (Statistics, M4; Preferences,
 * M5), and the window controls.
 */
import Adw from 'gi:Adw-1'
import Gdk from 'gi:Gdk-4.0'
import Gio from 'gi:Gio-2.0'
import GLib from 'gi:GLib-2.0'
import GObject from 'gi:GObject-2.0'
import Gtk from 'gi:Gtk-4.0'

import { styles } from 'node-gtk/styles'

import { BREAKPOINTS, layoutFor, timerMargins } from './core/layout.js'
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
  // change. This is only the startup size: M6's breakpoints decide what the
  // layout does when the window is dragged smaller or grown (see applyLayout
  // at the bottom of this function).
  window.setDefaultSize(900, 540)
  // M6: the window stops here, and it is a floor rather than a suggestion.
  // AdwWindow's own default minimum is 360×200, which libadwaita's breakpoint
  // docs explicitly tell you to override ("the minimum size must be larger
  // than the smallest UI state"): at 400 the selectors row (~282) plus the
  // header's own buttons are already the whole window, and below that no tier
  // in src/core/layout.ts could keep the layout deliberate.
  window.widthRequest = BREAKPOINTS.minWidth
  window.heightRequest = BREAKPOINTS.minHeight

  // ---- content header: the timer's controls ------------------------------
  // No title here (layout F, 2026-10-01): the app name is the *sidebar's*
  // header, and the window title still goes to the taskbar. Dropping it (and
  // the session pill that used to sit here) is part of what lets the header
  // render uncut at 900 px — see the setDefaultSize comment above.
  const header = new Adw.HeaderBar({ showTitle: false })

  // App functions, packed at the end before the window controls: the
  // Preferences and Statistics dialogs (M5 added Preferences; the dialog
  // itself is src/ui/preferences.ts — it owns every setting, the WCA
  // inspection toggle included, user call 2026-10-02). About / Keyboard
  // Shortcuts / Quit are application-level, so they live in the sidebar's
  // app menu instead (user call, layout F).
  const appFunctions = new Gio.Menu()
  appFunctions.append('Preferences', 'app.preferences')
  appFunctions.append('Statistics', 'app.statistics')
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

  // ---- scramble images (M5) ---------------------------------------------
  // The SVG rides in with its scramble (one worker round trip — see
  // scrambleWithImage), so the panel can put text and diagram on screen in
  // the same frame and the timer never moves twice. The cache lives here
  // rather than in the feed because the feed stays pure string state; the
  // panel reads through imageFor(), including for the ghost while the next
  // scramble generates. Images are always fetched (a picture costs the
  // worker ~1 ms); the preference only decides whether imageFor shows it,
  // so the toggle is instant in both directions with nothing to refetch.
  // Bounded: only the last few scrambles can ever be on screen.
  const imageCache = new Map<string, string | null>()
  const imageKey = (type: string, scramble: string): string => `${type}\u0000${scramble}`
  const rememberImage = (type: string, scramble: string, image: string | null): void => {
    imageCache.set(imageKey(type, scramble), image)
    while (imageCache.size > 16) {
      const oldest = imageCache.keys().next().value
      if (oldest === undefined) break
      imageCache.delete(oldest)
    }
  }
  const imageFor = (type: string, scramble: string): string | null =>
    prefs.scrambleImage ? (imageCache.get(imageKey(type, scramble)) ?? null) : null

  // The type dropdown and the refresh button live in the header; the text
  // itself sits above the timer (see createScramblePanel).
  const scrambleService = createScrambleService()
  const feed = new ScrambleFeed({
    type: SCRAMBLE_DEFAULT_TYPE,
    generate: async (type) => {
      const { scramble, image } = await scrambleService.scrambleWithImage(
        type,
        scrambleLength(type),
      )
      rememberImage(type, scramble, image)
      return scramble
    },
  })

  const scramblePanel = createScramblePanel({ getImage: imageFor })
  /**
   * M6: flips to true once the widgets the adaptive layout drives all exist.
   * The feed can announce before then — a session with a stored scramble type
   * retypes at startup — so the layout functions (declared below, hoisted)
   * have to no-op rather than read a half-built tree.
   */
  let layoutReady = false
  feed.subscribe(() => {
    scramblePanel.render(feed.state)
    // The scramble's own height is the top of the timer's region: a text that
    // wraps differently moves where the centred position sits, and a new
    // diagram changes the offset measured from it.
    updateNudge()
  })

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

  // Copy, beside refresh (user call, 2026-10-02): the scramble is no longer
  // selectable — see src/ui/scramblePanel.ts — so this button, and the
  // accelerator below, are *the* ways to get the text out, by mouse or by
  // keyboard, and they copy what is on screen whether it wrapped or not.
  // GDK4 has no `clipboard.set_text`: the clipboard takes a content provider,
  // and text is bytes under a mime type (`text/plain;charset=utf-8` is the
  // one every paste target asks for).
  const runCopy = (): void => {
    const scramble = feed.state.scramble
    // Null only while the very first scramble is still generating — nothing
    // to copy yet, and the button is a no-op rather than an error.
    if (scramble === null || scramble.length === 0) return
    const bytes = GLib.Bytes.new(Array.from(new TextEncoder().encode(scramble)))
    window
      .getDisplay()
      .getClipboard()
      .setContent(Gdk.ContentProvider.newForBytes('text/plain;charset=utf-8', bytes))
    // Feedback matters more here than anywhere else in the header: the
    // accelerator has no visible subject, so the toast is the only proof the
    // key did anything.
    toastOverlay.addToast(new Adw.Toast({ title: 'Scramble copied', timeout: 2 }))
  }
  const copyScramble = new Gtk.Button({
    iconName: 'edit-copy-symbolic',
    tooltipText: 'Copy the scramble (Ctrl+C)',
    cssClasses: ['flat'],
  })
  copyScramble.on('clicked', runCopy)
  const copyAction = Gio.SimpleAction.new('copy-scramble', null)
  copyAction.on('activate', runCopy)
  app.addAction(copyAction)
  app.setAccelsForAction('app.copy-scramble', ['<Control>c'])
  header.packStart(copyScramble)

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
  // The narrow-window home of the scramble selectors (M6, tier C): below ~600
  // the header has less room than its own ~560 of natural demand, so the two
  // dropdowns move *out* of it rather than being clipped. The row sits between
  // the header and the scramble, and the layout counts its slot (height plus
  // this gap) as part of the header block when it measures where the timer's
  // centre should be.
  const SELECTOR_ROW_GAP = 4
  const selectorRow = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 6,
    halign: Gtk.Align.CENTER,
    visible: false,
    marginBottom: SELECTOR_ROW_GAP,
    marginStart: 12,
    marginEnd: 12,
  })

  const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
  content.append(header)
  content.append(selectorRow)
  content.append(scramblePanel.widget)
  content.append(timerView.widget)

  // The diagram floats in the view's bottom-right corner (user call,
  // 2026-10-02). GTK4 does not count overlay children in the parent's size
  // request — the same rule the spinner slot relies on — so the picture
  // takes no layout space at any window size: the text and timer sit
  // exactly as they do without it, and switching it off reflows nothing.
  const viewOverlay = new Gtk.Overlay({ child: content })
  viewOverlay.addOverlay(scramblePanel.image)

  // The solve list is a sidebar over the left-hand edge: it can be closed,
  // and closing it hands the full width back to the timer. START puts it
  // left; nothing else claims that side (PLAN §7). `collapsed` is *not* set
  // here — applyLayout() below decides, per window width: side by side while
  // there is room for both, an overlay drawer when there is not (M6). With
  // `pinSidebar` at its default, collapsing hides the list and uncollapsing
  // shows it again, so a resize out and back restores what you had.
  const split = new Adw.OverlaySplitView({
    content: viewOverlay,
    sidebar: timesList.widget,
    sidebarPosition: Gtk.PackType.START,
    minSidebarWidth: BREAKPOINTS.sidebarMin,
    maxSidebarWidth: 320,
    sidebarWidthUnit: Adw.LengthUnit.PX,
    showSidebar: sidebarToggle.active,
  })

  // The list is a drawer below 800px (M6). Adw.OverlaySplitView with its
  // default `pin-sidebar=false` already has an opinion about that: collapsing
  // auto-hides the sidebar, uncollapsing auto-shows it — the contract
  // libadwaita's own "Overlay Sidebar" demo (adaptive-layouts.html) builds on.
  // We take it as-is and wire it the way the demo does, with one bidirectional
  // binding, instead of keeping a second copy of "should the list be up?" in
  // our own code. Earlier M6 code had exactly that (`sidebarWanted` + handlers
  // around `notify::show-sidebar`) and it fought libadwaita: every crossing of
  // the 800px threshold became an override the property immediately re-reported
  // — 43 flips in one session, two handler re-entries each — i.e. a state
  // machine whose only reachable output was the one it had started from. One
  // binding, one direction of truth: the property is the state, the toggle is
  // a view of it, and Ctrl+B/Escape below are just other callers of
  // setShowSidebar().
  split.bindProperty(
    'show-sidebar',
    sidebarToggle,
    'active',
    GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.BIDIRECTIONAL,
  )
  split.on('notify::show-sidebar', () => {
    console.error(
      `[sidebar] show-sidebar=${split.getShowSidebar()} collapsed=${split.collapsed}`,
    )
    // The sidebar's width is the content's width (side by side, not in drawer
    // mode), so opening or closing it moves where the timer's centre belongs.
    updateNudge()
  })

  /**
   * Show/hide the list — the only control for it that works at every window
   * size, and the reason Escape is worth having as a way out of the drawer
   * (below). A plain Gtk.ToggleButton has no accelerator of its own (AGENTS:
   * every action a test drives must have one), so it goes through an app
   * action: Ctrl+B, the usual convention, listed in src/ui/shortcuts.ts.
   */
  const sidebarAction = Gio.SimpleAction.new('sidebar', null)
  sidebarAction.on('activate', () => {
    const shown = !split.getShowSidebar()
    console.error(`[sidebar] activate → ${shown} collapsed=${split.collapsed}`)
    split.setShowSidebar(shown)
  })
  app.addAction(sidebarAction)
  app.setAccelsForAction('app.sidebar', ['<Control>b'])

  toastOverlay.setChild(split)
  window.setContent(toastOverlay)

  // ---- adaptive layout (M6) ---------------------------------------------
  // Every threshold lives in src/core/layout.ts — pure and unit tested — so
  // this block only *measures* the window and pushes the decisions out. Three
  // things call in, and each is needed:
  //
  //   • the Adw.Breakpoints registered below: five mutually exclusive *width*
  //     bands. libadwaita keeps a single current breakpoint ("if multiple
  //     breakpoints can be used for the current size, the last one is always
  //     picked", AdwBreakpointBin — which AdwWindow defers to), so overlapping
  //     conditions would starve each other and a resize could leave a tier
  //     unapplied. Disjoint bands mean every boundary crossing changes the
  //     current breakpoint and therefore fires apply/unapply.
  //   • Gdk.Surface::layout — every resize, including a height-only one that
  //     no width band can see; that is what carries the short-window tier.
  //   • the frame clock's after-paint — the nudge follows a diagram that
  //     changes size or appears, not just a resize.
  //
  // All three end in the same idempotent functions: measure, compare, write
  // only what changed.

  /** Moves the two dropdowns between the header and their own row (tier C). */
  let selectorsInRow = false
  function placeSelectors(inRow: boolean): void {
    if (inRow === selectorsInRow) return
    selectorsInRow = inRow
    const box = typeSelect.widget
    if (inRow) {
      header.remove(box)
      selectorRow.append(box)
      selectorRow.setVisible(true)
    } else {
      selectorRow.remove(box)
      selectorRow.setVisible(false)
      // The header is now [toggle, refresh, copy], and the selectors belong
      // before those two — so they go out and come back after them, in order
      // (the copy button must not end up between the dropdowns and refresh).
      header.remove(copyScramble)
      header.remove(refreshScramble)
      header.packStart(box)
      header.packStart(refreshScramble)
      header.packStart(copyScramble)
    }
  }

  /** The last tier reported, so applyLayout's log speaks only on a change. */
  let lastTier = ''
  /** The last diagram size reported (see updateNudge). */
  let lastDiagram = ''
  /**
   * Surface − window-widget, i.e. the CSD shadow, in each axis; 0 until
   * updateNudge has seen a settled paint to measure it on (see there).
   */
  let csdShadowWidth = 0
  let csdShadowHeight = 0
  /** The window widget's size on the previous paint, for the test above. */
  let lastWindowWidth = -1
  let lastWindowHeight = -1
  /** The surface's size on the previous paint, likewise. */
  let lastSurfaceWidth = -1
  let lastSurfaceHeight = -1
  /** So the shadow is reported once, not on every paint. */
  let reportedShadow = false
  /** The evidence line is printed when the demand changes (see applyLayout). */
  let lastReportedHeaderNatural = -1
  /** Last header natural measured with the selectors packed in (see applyLayout). */
  let rememberedHeaderNatural = 0

  /**
   * The window's size, read from the *surface* where possible.
   *
   * The `layout` signal that drives applyLayout is the surface announcing its
   * new size; GTK only catches the widget allocations up afterwards. So on the
   * one pass where a tier or a margin must be decided for the new size, every
   * widget answers with the *old* one — measured on the 900→460 jump: surface
   * 460, window widget 890, split 762 (the split having been allocated the
   * overflow it asked for). All three are true numbers from three different
   * moments, and a decision taken from any of the widget ones is a decision
   * about a window that no longer exists.
   *
   * The gap between surface and widget is just the CSD shadow, and it is read
   * only while both numbers stand still between two calls. A positive gap is
   * either exactly the shadow (settled) or larger than it (widget lagging low
   * during a growth) — never smaller — so this can under-credit the room by a
   * frame, never over-credit it, which is the direction that overflows. Until
   * the first settled pair the widget is used, and that is correct too: at
   * startup nothing has been resized yet.
   */
  function groundWindowSize(): { width: number; height: number } {
    const windowWidth = window.getSize(Gtk.Orientation.HORIZONTAL)
    const windowHeight = window.getSize(Gtk.Orientation.VERTICAL)
    const surface = window.getSurface()
    const surfaceWidth = surface !== null ? surface.getWidth() : 0
    const surfaceHeight = surface !== null ? surface.getHeight() : 0
    if (
      windowWidth === lastWindowWidth &&
      windowHeight === lastWindowHeight &&
      surfaceWidth === lastSurfaceWidth &&
      surfaceHeight === lastSurfaceHeight
    ) {
      if (surfaceWidth > windowWidth && surfaceWidth - windowWidth < 32)
        csdShadowWidth = surfaceWidth - windowWidth
      if (surfaceHeight > windowHeight && surfaceHeight - windowHeight < 32)
        csdShadowHeight = surfaceHeight - windowHeight
      if (csdShadowWidth > 0 && !reportedShadow) {
        reportedShadow = true
        console.error(`[layout] CSD shadow ${csdShadowWidth}x${csdShadowHeight}`)
      }
    }
    lastWindowWidth = windowWidth
    lastWindowHeight = windowHeight
    lastSurfaceWidth = surfaceWidth
    lastSurfaceHeight = surfaceHeight
    return {
      width:
        csdShadowWidth > 0 && surfaceWidth > csdShadowWidth
          ? surfaceWidth - csdShadowWidth
          : windowWidth,
      height:
        csdShadowHeight > 0 && surfaceHeight > csdShadowHeight
          ? surfaceHeight - csdShadowHeight
          : windowHeight,
    }
  }

  /** Apply the tier for the window's current size. Safe to call any time. */
  function applyLayout(): void {
    if (!layoutReady) return
    // Measure the *window*, as the surface reports it (see groundWindowSize
    // below) — the same number the breakpoints' conditions are checked
    // against. Deliberately not `content`: in side-by-side mode that is what
    // is left *after* the sidebar, so a tier decided from it would feed on its
    // own result (open the drawer → content grows → the window looks wide
    // enough for a sidebar → close it → content shrinks → …). And deliberately
    // not the split view's allocation either: that is what GTK handed out when
    // the split asked for more than the window had, so mid-shrink it reads 762
    // while the window is 450 — a tier from *that* keeps the selectors packed
    // into a header that cannot fit, which is the whole of the "requested 522,
    // 450 available" frame on the way down to 460.
    const { width, height } = groundWindowSize()
    // Not allocated yet (the call made right after present(), before the first
    // layout pass): nothing to decide from, and applying a tier from a 0×0
    // measurement would reparent the selectors for no reason. The surface's
    // first `layout` signal brings the real numbers.
    if (width <= 0 || height <= 0) return
    // The header's demand decides one thing the bands cannot (layoutFor): with
    // the selectors *in* the header this is a live measurement, and with them
    // in their own row the header has already given them up — measuring 320px
    // then would say "fits" and reparent them straight back, at which point it
    // would measure 1186px and move them out again. So the number is only
    // refreshed while the selectors are where the demand comes from, and
    // remembered otherwise: one direction of truth, same as show-sidebar.
    const [, measuredHeaderNatural] = header.measure(Gtk.Orientation.HORIZONTAL, -1)
    if (!selectorRow.visible) rememberedHeaderNatural = measuredHeaderNatural
    const headerNatural = selectorRow.visible ? rememberedHeaderNatural : measuredHeaderNatural
    const tier = layoutFor(width, height, headerNatural)

    if (split.collapsed !== tier.drawer) split.collapsed = tier.drawer
    if (split.maxSidebarWidth !== tier.sidebarMax) split.maxSidebarWidth = tier.sidebarMax
    placeSelectors(tier.selectorRow)
    timerView.setSize(tier.timerSize)
    scramblePanel.setLimits(tier.scrambleChars, tier.scrambleMaxHeight)
    scramblePanel.setDiagramMax(tier.diagramMaxWidth, tier.diagramMaxHeight)
    updateNudge()

    // One line per *change* — the M6 evidence trail when the window is walked
    // through its bands (and a cheap way to spot a tier decided from a stale
    // measurement, which is the one thing a breakpoint could get wrong).
    const signature =
      `${width}x${height} (win ${window.getSize(Gtk.Orientation.VERTICAL)}): ` +
      `${tier.drawer ? 'drawer' : 'side-by-side'}, ` +
      `selectors ${tier.selectorRow ? 'in their own row' : 'in the header'}, ` +
      `timer ${tier.timerSize}, sidebar max ${tier.sidebarMax}`
    if (signature !== lastTier) {
      lastTier = signature
      console.error(`[layout] ${signature}`)
    }

    // Evidence for M6's thresholds: what the header asks for, the window it
    // got, and what is left for the content. Printed on every *change* of the
    // demand rather than once, because the demand is a property of the labels
    // the user has selected, not of the window — 724px for a 3x3x3 session,
    // 1186px with the FTO category — and it is those numbers the 800/600 bands
    // and `headerSlack` are checked against (PLAN §7). Note the dropdowns size
    // to their *current* item: this is the case on screen, and the catalogue's
    // worst case is measured separately by the same line.
    if (measuredHeaderNatural !== lastReportedHeaderNatural) {
      lastReportedHeaderNatural = measuredHeaderNatural
      const [, timerW] = timerView.widget.measure(Gtk.Orientation.HORIZONTAL, -1)
      const [, timerH] = timerView.widget.measure(Gtk.Orientation.VERTICAL, -1)
      console.error(
        `[layout] header asks ${measuredHeaderNatural}px | ${width}x${height} window → ` +
          `${content.getSize(Gtk.Orientation.HORIZONTAL)} for the content | ` +
          `timer block ${timerW}x${timerH}`,
      )
    }
  }

  /**
   * Step the timer block aside for the diagram — offset from where it would
   * otherwise sit (centred in its region) by half the picture's height up and
   * half its width left — but only while the diagram is on screen, and never
   * at the cost of the block's natural size (see src/core/layout.ts). Writing
   * the same margins twice is skipped, which is what stops the frame-clock
   * hook below from feeding itself: these numbers do not depend on the
   * margins.
   */
  function updateNudge(): void {
    if (!layoutReady) return
    // `measure()` reports the box *plus its own margins* (measured: a label
    // asking 18 goes to 118 with margin-bottom 100). Left in, the clamp below
    // would read back the margin it just wrote — in a cramped window that
    // flip-flops: settle on one, and the next measurement shrinks the room.
    // So the naturals are the box's *content*: what the region has to clear.
    const [, measuredWidth] = timerView.widget.measure(Gtk.Orientation.HORIZONTAL, -1)
    const [, measuredHeight] = timerView.widget.measure(Gtk.Orientation.VERTICAL, -1)
    const naturalWidth = Math.max(
      0,
      measuredWidth - timerView.widget.marginStart - timerView.widget.marginEnd,
    )
    const naturalHeight = Math.max(
      0,
      measuredHeight - timerView.widget.marginTop - timerView.widget.marginBottom,
    )
    // The header block is everything above the scramble: the header bar plus
    // the selectors row's whole slot (height + gap) whenever that row carries
    // the dropdowns. The timer's region then starts at the bottom of the
    // panel's slot — panel height plus the margins around it.
    // …and the row itself is taken *natural* when it has no allocation yet:
    // applyLayout reparents it into existence at ≤800 and GTK has not sized it
    // by the time this runs, so `getSize()` says 0. Reading 0 puts the region
    // 34px too high and the margin 34px too big — one frame of overflow, i.e.
    // the "requested 388, 370 available" warning on the way down to 460.
    const rowHeight = selectorRow.visible
      ? Math.max(
          selectorRow.getSize(Gtk.Orientation.VERTICAL),
          selectorRow.measure(Gtk.Orientation.VERTICAL, -1)[1],
        )
      : 0
    const headerHeight =
      header.getSize(Gtk.Orientation.VERTICAL) + rowHeight + (rowHeight > 0 ? SELECTOR_ROW_GAP : 0)

    const diagram = scramblePanel.diagramSize()
    // One line whenever the picture's on-screen size changes: it is both what
    // the nudge is measured from and the thing most likely to be clipped
    // (overlay children are allocated, not requested — see tools/README.md).
    const diagramSignature = `${diagram.width}x${diagram.height}`
    if (diagramSignature !== lastDiagram) {
      lastDiagram = diagramSignature
      if (diagram.width > 0 || diagram.height > 0) {
        console.error(`[layout] diagram ${diagramSignature}`)
      }
    }
    // The room available comes from the *window* (surface-backed, see
    // groundWindowSize), never from `content`'s own allocation: when the
    // window is too small for what the content asks, GTK hands the box its
    // minimum instead — and that minimum contains the very margin being
    // computed here, so clamping against it is a tautology that settles
    // *above* the window and clips (measured at the 400x360 floor: content
    // asked 359, got 359, window had 350 → clipped, and libadwaita then
    // logged "snapshot … without a current allocation"). The window's size is
    // the one number a margin cannot inflate. Same story sideways: `content`
    // is only the window minus the sidebar in side-by-side mode, so that share
    // is subtracted here rather than trusted from the box.
    const { width: groundWidth, height: groundHeight } = groundWindowSize()
    if (groundWidth <= 0 || groundHeight <= 0) return // not allocated yet
    const sidebarInFlow = !split.collapsed && split.getShowSidebar()
    const sidebarWidth = sidebarInFlow
      ? timesList.widget.getSize(Gtk.Orientation.HORIZONTAL)
      : 0
    const margins = timerMargins({
      diagramVisible: scramblePanel.hasImage(),
      diagramWidth: diagram.width,
      diagramHeight: diagram.height,
      viewWidth: Math.min(content.getSize(Gtk.Orientation.HORIZONTAL), groundWidth - sidebarWidth),
      viewHeight: Math.min(content.getSize(Gtk.Orientation.VERTICAL), groundHeight),
      regionTop: headerHeight + scramblePanel.slotBottom(),
      naturalWidth,
      naturalHeight,
    })
    if (timerView.widget.marginEnd !== margins.marginEnd) {
      timerView.widget.marginEnd = margins.marginEnd
    }
    if (timerView.widget.marginBottom !== margins.marginBottom) {
      timerView.widget.marginBottom = margins.marginBottom
    }
  }

  /**
   * The width bands, as breakpoint conditions — written from the same
   * constants layoutFor() reads, so the two cannot drift. Added largest first
   * for tidiness (only one can match anyway). The normal band, 801–1199,
   * deliberately has no breakpoint of its own: arriving and leaving it is
   * covered by the bands either side of it.
   */
  const heldBreakpoints: Array<InstanceType<typeof Adw.Breakpoint>> = []
  const widthBands: Array<[string, string]> = [
    ['L', `min-width: ${BREAKPOINTS.largeMin}px`],
    [
      'M',
      `min-width: ${BREAKPOINTS.mediumMin}px and max-width: ${BREAKPOINTS.largeMin - 1}px`,
    ],
    [
      'B',
      `min-width: ${BREAKPOINTS.selectorRowMax + 1}px and max-width: ${BREAKPOINTS.drawerMax}px`,
    ],
    [
      'C',
      `min-width: ${BREAKPOINTS.smallMax + 1}px and max-width: ${BREAKPOINTS.selectorRowMax}px`,
    ],
    ['S', `max-width: ${BREAKPOINTS.smallMax}px`],
  ]
  for (const [band, condition] of widthBands) {
    const breakpoint = Adw.Breakpoint.new(Adw.BreakpointCondition.parse(condition))
    breakpoint.on('apply', () => applyLayout())
    breakpoint.on('unapply', () => applyLayout())
    window.addBreakpoint(breakpoint)
    heldBreakpoints.push(breakpoint) // keep the wrapper with its closures
  }
  console.error(
    `[layout] ${heldBreakpoints.length} width bands ` +
      `(S ≤${BREAKPOINTS.smallMax} … L ≥${BREAKPOINTS.largeMin})`,
  )

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

  // M6: Escape also closes an open drawer — in the *bubble* phase, which runs
  // last. Anything that wanted the key first has already had it by then (an
  // open dialog or popover, or the capture controller above stopping a run),
  // so the drawer only gives way when Escape had nothing better to do. The
  // timer's own Escape job — cancelling an inspection — happened in capture
  // and is unaffected: both can fire, which is what M6 specified.
  const drawerKeyController = new Gtk.EventControllerKey()
  drawerKeyController.setPropagationPhase(Gtk.PropagationPhase.BUBBLE)
  window.addController(drawerKeyController)
  drawerKeyController.on('key-pressed', (keyval) => {
    if (keyval !== Gdk.KEY_Escape) return false
    if (window.getVisibleDialog() !== null) return false
    if (!split.collapsed || !split.showSidebar) return false
    // Escape closes the drawer, and that is the whole of it: the next uncollapse
    // re-shows the list (libadwaita's own pin-sidebar=FALSE contract, adopted
    // deliberately — see the binding above), rather than our code remembering a
    // decision the property no longer holds.
    split.setShowSidebar(false)
    return true
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
  // the session menu).
  app.setAccelsForAction('app.statistics', ['<Control>t'])

  /**
   * The single path for a settings change (M5): merge the patch into this
   * run's Preferences, persist it, then push the new values into everything
   * they drive. The preferences dialog is the only writer (the app-functions
   * menu's inspection check item was retired, user call 2026-10-02), so the
   * timer and prefs.json can never disagree.
   */
  const applyPreferences = (patch: Partial<Preferences>): void => {
    prefs = { ...prefs, ...patch }
    store.savePreferences(prefs)

    if ('holdThresholdMs' in patch) timer.setHoldThreshold(prefs.holdThresholdMs)
    if ('colorScheme' in patch) applyColorScheme(prefs.colorScheme)
    // imageFor reads `prefs`, so a plain re-render shows or drops the
    // diagram — the SVG is already in the cache (images are always fetched).
    if ('scrambleImage' in patch) scramblePanel.render(feed.state)
    if ('inspection' in patch) timer.setInspection(prefs.inspection, nowMs())
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
  layoutReady = true // the adaptive layout may now measure and write (M6)
  window.present()
  applyLayout() // the tier for the size we were actually given

  // The two continuous sources (M6), both only available once realized: a
  // resize the breakpoints cannot see (height-only — no width band changes,
  // but the short-window tier does), and any repaint that moved the bottom
  // edge of the scramble, which is where the timer's region starts.
  const surface = window.getSurface()
  if (surface === null) {
    console.error('[layout] no Gdk.Surface after present() — resizes will not re-apply the tier')
  } else {
    surface.on('layout', () => applyLayout())
  }
  const frameClock = window.getFrameClock()
  if (frameClock === null) {
    console.error('[layout] no frame clock — the timer keeps its first position')
  } else {
    frameClock.on('after-paint', () => updateNudge())
  }

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
