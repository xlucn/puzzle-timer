/*
 * Puzzle Timer — an Adwaita application built with node-gtk.
 *
 * Run with `node --import tsx --import node-gtk/register src/main.ts` (the
 * npm scripts do). Two ESM caveats: the `gi:` import scheme needs
 * node-gtk's loader hooks, and `app.run()` returns immediately instead of
 * blocking — so it is the last statement and teardown happens in the
 * window's close handler / quit action.
 *
 * This file assembles the app: core policy lives in src/core/ (pure
 * TypeScript, no GTK), widgets in src/ui/, persistence in src/platform/,
 * the scramble worker in src/scramble/. Layout: the sidebar owns the app
 * chrome (app name, app menu, session switch, solve list); the content
 * header keeps the timer's controls (sidebar toggle, type title/button,
 * refresh, image toggle, window controls).
 */
import Adw from 'gi:Adw-1'
import Gdk from 'gi:Gdk-4.0'
import Gio from 'gi:Gio-2.0'
import GLib from 'gi:GLib-2.0'
import GObject from 'gi:GObject-2.0'
import Gtk from 'gi:Gtk-4.0'
import { fileURLToPath } from 'node:url'

import { styles } from 'node-gtk/styles'

import {
  BREAKPOINTS,
  layoutFor,
  type ContentSize,
  type DiagramPlacement,
} from './core/layout.js'
import { ScrambleFeed } from './core/scrambleFeed.js'
import type { Preferences } from './core/preferences.js'
import { SCRAMBLE_DEFAULT_TYPE, scrambleLength } from './core/scrambleTypes.js'
import { Session, type RemovedSolve, type Solve, type Unsubscribe } from './core/session.js'
import { SessionLibrary } from './core/sessionLibrary.js'
import type { Penalty } from './core/time.js'
import { Timer, type TimerState } from './core/timer.js'
import { playInspectionCue } from './platform/audio.js'
import { APP_ISSUES, APP_REPOSITORY, APP_VERSION, releaseNotesHtml } from './platform/meta.js'
import * as store from './platform/store.js'
import { createScrambleService } from './scramble/service.js'
import { createPreferences } from './ui/preferences.js'
import { createScramblePanel } from './ui/scramblePanel.js'
import { createScrambleTypePicker } from './ui/scrambleTypePicker.js'
import { createScrambleTypeButton } from './ui/scrambleTypeButton.js'
import { createScrambleTypeTitle } from './ui/scrambleTypeTitle.js'
import { createSessionMenu } from './ui/sessionMenu.js'
import { createShortcutsDialog } from './ui/shortcuts.js'
import { createStatsPanel } from './ui/statsPanel.js'
import { createStatsStrip } from './ui/statsStrip.js'
import { createTimerView } from './ui/timerLabel.js'
import { createTimesList } from './ui/timesList.js'

const APP_ID = 'io.github.xlucn.PuzzleTimer'
const APP_NAME = 'Puzzle Timer'
/** Matches the hicolor tree under data/icons. */
const ICON_NAME = 'puzzle-timer'

/** ~60 fps is plenty for a centisecond readout, and costs almost nothing. */
const TICK_MS = 16

/** Identity the core Timer uses for the start key (see src/core/timer.ts). */
const START_KEY = 'space'

/**
 * Keys carrying these modifiers are left alone entirely, so application
 * accelerators (Ctrl+Q, Ctrl+1-3, …) keep working.
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

  // The app icon lives in a hicolor tree inside the repo, because a source
  // checkout has no install prefix to drop icons into. The search path holds
  // *theme directories*, so it is the parent of hicolor — pointing it at
  // hicolor itself finds nothing. A packaged install needs none of this.
  const display = Gdk.Display.getDefault()
  if (display !== null) {
    Gtk.IconTheme.getForDisplay(display).addSearchPath(
      fileURLToPath(new URL('../data/icons', import.meta.url)),
    )
  }
  // The startup size. The header's controls need ~560; at 900 the sidebar
  // takes its 240 floor, leaving 660 for the header. Resizing is handled by
  // the breakpoints below (applyLayout).
  window.setDefaultSize(900, 540)
  // Hard floors, not suggestions: below these no tier in core/layout.ts can
  // keep the layout deliberate (the header alone needs ~282 of *width*).
  // 360×294 is the GNOME HIG's smallest phone window — see BREAKPOINTS.
  window.widthRequest = BREAKPOINTS.minWidth
  window.heightRequest = BREAKPOINTS.minHeight

  // ---- content header: the timer's controls ------------------------------
  // No *app name* here: that is the *sidebar's* header, and the window title
  // still goes to the taskbar. Leaving the centre slot free is part of what
  // lets the header render uncut at 900 px — see the setDefaultSize comment
  // above. The centre slot does show a title: the scramble type as
  // title/subtitle, assigned once below as the titleWidget.
  const header = new Adw.HeaderBar({ showTitle: false })

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

  // Settings: one object for the whole run. Every change goes through
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
      // stderr has the detail; the user gets the headline — toasted on first
      // touch, so an empty list is never silent about why it is empty.
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

  // First run, migration or recovery alike: with no index on disk the store
  // rebuilds one from the session files it finds, so write it back once.
  store.saveIndex(library.entries, library.activeId)

  /**
   * Deletion is always undoable: removals are restored in reverse order,
   * each at the index recorded when *it* happened, which lands every solve
   * exactly where it was. The toast restores into the session it deleted
   * from, even if another one is active by then.
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

  /**
   * True while the timer owns the view, from the first start press through
   * the solve.
   */
  let timerFocus = false

  // Built before createTimesList, which hosts it. Ctrl+S can arrive while
  // the sidebar is closed and a popover cannot anchor to an unmapped widget,
  // hence ensureVisible (see sessionMenu.ts).
  const sessionMenu = createSessionMenu({
    library,
    app,
    window,
    getSolveCount: (id) => sessionFor(id).size,
    ensureVisible: () => sidebarToggle.setActive(true),
    canOpen: () => !timerFocus,
  })

  // The app's one menu, in the sidebar. Two sections: Statistics alone, then
  // the application-level actions — a second section is what draws the
  // separator.
  const statisticsSection = new Gio.Menu()
  statisticsSection.append('Statistics', 'app.statistics')
  const applicationSection = new Gio.Menu()
  applicationSection.append('Preferences', 'app.preferences')
  applicationSection.append(`About ${APP_NAME}`, 'app.about')
  applicationSection.append('Keyboard Shortcuts', 'app.shortcuts')
  applicationSection.append('Quit', 'app.quit')
  const appMenuModel = new Gio.Menu()
  appMenuModel.appendSection(null, statisticsSection)
  appMenuModel.appendSection(null, applicationSection)
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
  // The timer starts on the stored preferences: the hold threshold it
  // arms on and whether the first release begins an inspection.
  const timer = new Timer({
    holdThresholdMs: prefs.holdThresholdMs,
    startKey: START_KEY,
    inspection: prefs.inspection,
  })
  // The ao5/ao12 strip rides under the timer's hint line: same live
  // session reading as the list, so it tracks adds, penalties and switches.
  const statsStrip = createStatsStrip({ library, getSession: activeSession })
  const timerView = createTimerView({ statsStrip })

  // ---- scramble images ----------------------------------------------------
  // The SVG rides in with its scramble (one worker round trip), so text and
  // diagram land in the same frame. The cache lives here to keep the feed
  // pure string state; imageFor() also serves the ghost. Images are always
  // fetched (~1 ms in the worker) — the preference only gates *display*, so
  // the toggle is instant with nothing to refetch. Bounded: only the last
  // few scrambles can be on screen.
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
   * Flips to true once the widgets the adaptive layout drives all exist.
   * The feed can announce before then — a session with a stored scramble type
   * retypes at startup — so the layout functions (declared below, hoisted)
   * have to no-op rather than read a half-built tree.
   */
  let layoutReady = false
  feed.subscribe(() => {
    scramblePanel.render(feed.state)
  })

  /**
   * Wherever a type is chosen, it lands here: the feed regenerates and the
   * choice is written to the active session (a switch restores it). The
   * other display is moved onto the same id — selectType is silent by
   * contract, so one handler keeps the title and picker from disagreeing.
   */
  const chooseType = (type: string): void => {
    feed.setType(type)
    // `retyped` rides the index subscription above, which writes the file.
    library.setScrambleType(library.activeId, type)
    typeTitle.selectType(type)
    typePicker.selectType(type)
  }

  // One dialog serves both controls (see the type chooser comment above);
  // built before the header button that opens it.
  const typePicker = createScrambleTypePicker({
    initialType: SCRAMBLE_DEFAULT_TYPE,
    onChange: chooseType,
    window,
  })

  // Assigned once and never reparented: the stale HeaderBar:title-widget
  // trap only exists for widgets that leave.
  const typeTitle = createScrambleTypeTitle({ initialType: SCRAMBLE_DEFAULT_TYPE })
  header.titleWidget = typeTitle.widget
  header.showTitle = true

  /**
   * A session's type applies on switch (absent = default, already on —
   * nothing moves). Both displays update silently: re-announcing would write
   * the session's value back onto itself. Unknown ids (hand-edited index)
   * fail selectType and the feed is left alone.
   */
  const applySessionType = (id: string): void => {
    const type = library.find(id)?.scrambleType ?? SCRAMBLE_DEFAULT_TYPE
    if (type === feed.state.type) return
    if (typeTitle.selectType(type) && typePicker.selectType(type)) feed.setType(type)
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

  // Copy: the scramble is display-only, so this button and Ctrl+C are the
  // only ways to get the text out. `set_text` is unintrospectable in the
  // Gdk binding, so the clipboard takes a content provider instead.
  const runCopy = (): void => {
    const scramble = feed.state.scramble
    if (scramble === null || scramble.length === 0) return
    const bytes = GLib.Bytes.new(Array.from(new TextEncoder().encode(scramble)))
    window
      .getDisplay()
      .getClipboard()
      .setContent(Gdk.ContentProvider.newForBytes('text/plain;charset=utf-8', bytes))
    // The accelerator has no visible subject — the toast is the only proof
    // the key did anything.
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

  // Icon-only — the type name lives in the header title (typeTitle).
  const typeButton = createScrambleTypeButton({ onActivate: () => typePicker.open() })
  header.packStart(typeButton.widget)

  // Drives the scrambleImage preference through applyPreferences — the same
  // single-writer path the Preferences SwitchRow uses, so prefs.json, the
  // dialog and this button can never disagree (the mirror-back is in
  // applyPreferences).
  const imageToggle = new Gtk.ToggleButton({
    iconName: 'image-x-generic-symbolic',
    tooltipText: 'Show the scramble image',
    active: prefs.scrambleImage,
    halign: Gtk.Align.END, // no effect in the header's natural-width end box; right-aligns in the bar
    cssClasses: ['flat'],
  })
  imageToggle.on('notify::active', () => {
    // Equality guard: applyPreferences syncs `active` back, which re-fires
    // this handler — only a real change writes.
    if (imageToggle.active !== prefs.scrambleImage) {
      applyPreferences({ scrambleImage: imageToggle.active })
    }
  })
  header.packEnd(imageToggle)

  // Escape's job with no keyboard: an inspection otherwise has no visible
  // way out. The button taps the same Escape key — `keyDown` then `keyUp` —
  // so there is one cancellation route, and it exists only while inspecting;
  // the timer subscription below shows and hides it.
  const cancelInspection = new Gtk.Button({
    label: 'Cancel',
    tooltipText: 'Cancel the inspection (Esc)',
    // `destructive-action` is Adwaita's alert red for a button; the inspection
    // is abandoned, so it reads as the one action that ends something.
    cssClasses: ['destructive-action'],
    visible: false,
  })
  // A click is a tap, not a held key: keyDown without the matching keyUp
  // would leave Escape in the pressed set, and the next cancel would be
  // ignored as auto-repeat.
  cancelInspection.on('clicked', () => {
    const now = nowMs()
    timer.keyDown('escape', now)
    timer.keyUp('escape', now)
  })
  header.packEnd(cancelInspection)

  // Record against the scramble on screen — read before advance() swaps in
  // the pre-generated one. Null only while the very first scramble is still
  // generating; record anyway.
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

  // WCA cues: one beep at 8 s, two at 12 s. Core decides *when* a cue is
  // due; the app decides whether the user wants to hear it.
  timer.onCue((cue) => {
    if (prefs.inspectionSound) playInspectionCue(cue)
  })

  // ---- content: adaptive top and bottom bars around scramble + timer ------
  // At ≤540 the scramble controls move from the header into this bottom-bar
  // slot (placeSelectors). `toolbar` class + FLAT bars give the native flat
  // styling; the inter-button gap comes from the style, not spacing. The
  // image toggle rides right-aligned (halign END + the bar's only hexpand,
  // so it takes the slack at natural width).
  const selectorBar = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    cssClasses: ['toolbar'],
    marginStart: 12,
    marginEnd: 12,
  })

  const mainContent = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
  mainContent.append(scramblePanel.widget)

  // The timer and diagram are both children of this grid. A landscape content
  // area puts them in one row, one column each; a portrait one stacks the
  // rows; a narrow short one has only the timer. applyDiagramPlacement()
  // re-attaches them.
  const lowerArea = new Gtk.Grid({
    rowSpacing: 8,
    hexpand: true,
    vexpand: true,
  })
  timerView.widget.hexpand = true
  lowerArea.attach(timerView.widget, 0, 0, 1, 1)
  const diagramDock = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    halign: Gtk.Align.END,
    valign: Gtk.Align.END, // bottom-right in every live placement
  })
  diagramDock.append(scramblePanel.image)
  lowerArea.attach(diagramDock, 0, 1, 1, 1)
  mainContent.append(lowerArea)

  const content = new Adw.ToolbarView({
    content: mainContent,
    revealBottomBars: false,
    topBarStyle: Adw.ToolbarStyle.FLAT,
    bottomBarStyle: Adw.ToolbarStyle.FLAT,
  })
  content.addTopBar(header)
  content.addBottomBar(selectorBar)

  // START puts the list on the left. `collapsed` is not set here — applyLayout
  // decides, per window width. With the default `pinSidebar`, collapsing
  // hides the list and uncollapsing shows it again, so a resize out and back
  // restores what you had.
  const split = new Adw.OverlaySplitView({
    content,
    sidebar: timesList.widget,
    sidebarPosition: Gtk.PackType.START,
    minSidebarWidth: BREAKPOINTS.sidebarMin,
    maxSidebarWidth: 320,
    sidebarWidthUnit: Adw.LengthUnit.PX,
    showSidebar: sidebarToggle.active,
  })

  // The list is a drawer below 800px. Adw.OverlaySplitView with the default
  // `pin-sidebar=false` already auto-hides on collapse and auto-shows on
  // uncollapse (libadwaita's "Overlay Sidebar" demo builds on this), so one
  // bidirectional binding makes the property the single state — do NOT add
  // an intent-memory flag around `notify::show-sidebar`: an earlier one
  // fought the property's own re-reports into a 43-flip loop per threshold
  // crossing. Ctrl+B and Escape below are just other callers of
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
    // libadwaita re-shows a collapsed split view's sidebar when it uncollapses.
    // The toggle is disabled for the timer's view, but that automatic reveal
    // still has to be put back down.
    if (timerFocus && split.getShowSidebar()) split.setShowSidebar(false)
    // No explicit layout pass here: showing/hiding the sidebar repaints the
    // view, and the next after-paint re-applies the tier.
  })

  /**
   * Show/hide the list. A plain Gtk.ToggleButton has no accelerator of its
   * own (AGENTS: every action a test drives must have one), so it goes
   * through an app action: Ctrl+B, listed in src/ui/shortcuts.ts.
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

  // ---- adaptive layout ----------------------------------------------------
  // Thresholds live in core/layout.ts; this block only measures and applies.
  // Three sources feed applyLayout(), all ending in the same idempotent
  // measure-compare-write:
  //
  //   • Adw.Breakpoints: five mutually exclusive width bands. libadwaita
  //     keeps a single current breakpoint, so overlapping conditions would
  //     starve each other; disjoint bands make every crossing fire
  //     apply/unapply.
  //   • Gdk.Surface::layout: every resize, including height-only ones no
  //     width band can see. Runs before widget allocations catch up, so it
  //     only re-applies the tier in force.
  //   • Frame-clock after-paint: the fresh-allocation pass — band crossings,
  //     height-only resizes, and Adaptive Preview screen switches (which
  //     raise no surface event) all land here.

  /** In header pack order, so one loop moves and repacks them together. */
  const scrambleControls = [refreshScramble, copyScramble, typeButton.widget]

  /**
   * Move the scramble controls between header and bottom bar (all together:
   * narrow keeps the header to toggle, title and Cancel, the bar gets the
   * scramble actions). The bar only appears in that narrow tier and while
   * the timer does not own the view; `syncBottomBar` owns the reveal. The
   * title never moves — it is the HeaderBar's titleWidget at every width, so
   * the stale-title-widget trap (remove() clears the bin but not the
   * property) is unreachable by construction.
   */
  let selectorsInRow = false
  function syncBottomBar(): void {
    content.revealBottomBars = selectorsInRow && !timerFocus
  }
  function placeSelectors(inRow: boolean): void {
    if (inRow === selectorsInRow) return
    selectorsInRow = inRow
    if (inRow) {
      for (const widget of scrambleControls) {
        header.remove(widget)
        selectorBar.append(widget)
      }
      header.remove(imageToggle)
      imageToggle.hexpand = true
      selectorBar.append(imageToggle)
      syncBottomBar()
    } else {
      syncBottomBar()
      selectorBar.remove(imageToggle)
      imageToggle.hexpand = false
      // Cancel is pinned to the header's end at every width; re-pack it last
      // so it stays rightmost once the image toggle returns.
      header.remove(cancelInspection)
      header.packEnd(imageToggle)
      for (const widget of scrambleControls) {
        selectorBar.remove(widget)
        header.packStart(widget)
      }
      header.packEnd(cancelInspection)
    }
  }

  /**
   * Put the diagram where the tier has room for it: wide puts the timer and
   * dock in one row, tall-narrow stacks the rows, and short-narrow leaves
   * only the timer. The dock is bottom-right in every live placement.
   */
  let placedDiagram: DiagramPlacement | null = null
  function applyDiagramPlacement(placement: DiagramPlacement): void {
    if (placement === placedDiagram) return
    placedDiagram = placement

    if (timerView.widget.getParent() === lowerArea) lowerArea.remove(timerView.widget)
    if (diagramDock.getParent() === lowerArea) lowerArea.remove(diagramDock)
    lowerArea.rowSpacing = 0
    if (placement === 'wide') {
      lowerArea.attach(timerView.widget, 0, 0, 1, 1)
      lowerArea.attach(diagramDock, 1, 0, 1, 1)
      scramblePanel.image.marginEnd = 8
    } else if (placement === 'tall-narrow') {
      lowerArea.rowSpacing = 8
      lowerArea.attach(timerView.widget, 0, 0, 1, 1)
      lowerArea.attach(diagramDock, 0, 1, 1, 1)
      scramblePanel.image.marginEnd = 16
    } else {
      lowerArea.attach(timerView.widget, 0, 0, 1, 1)
      scramblePanel.image.marginEnd = 16
    }
    diagramDock.setVisible(placement !== 'none')
  }

  /** The last tier reported, so applyLayout's log speaks only on a change. */
  let lastTier = ''

  /**
   * The rectangle the app lives in: `window.content`'s allocation (the
   * `getAllocated*` getters are deprecated; `getWidth()`/`getHeight()` are
   * the current names).
   *
   * `window.content` is the child of the very AdwBreakpointBin the window's
   * breakpoints are evaluated against (adw-application-window.c), so tiers
   * and bands always describe one rectangle — in a normal window, and under
   * the Adaptive Preview (Ctrl+Shift+M) where it sits inside the preview's
   * emulated screen. It is the whole app, sidebar included; not the `content`
   * ToolbarView, which is only what is left after the sidebar (a tier from
   * that would feed on its own result — see applyLayout).
   *
   * One more thing it must not believe: an over-allocated child. When the
   * content's own minimum exceeds the window, GTK still hands the child its
   * request (measured: 650px of content in a 505px window; 300 against the
   * 294 floor) — reporting that describes a window that does not exist and
   * holds the wrong tier open (the header keeps its controls at a width that
   * has already passed selectorRowMax, and the next measure warns). The
   * window widget caps the reading in both axes.
   */
  function groundWindowSize(): { width: number; height: number } {
    return {
      width: Math.min(window.content.getWidth(), window.getSize(Gtk.Orientation.HORIZONTAL)),
      height: Math.min(window.content.getHeight(), window.getSize(Gtk.Orientation.VERTICAL)),
    }
  }

  /**
   * The content area between the toolbar bars, which is what the timer and
   * diagram actually share. Zero until the first allocation, so the caller
   * can leave it out and let layoutFor() fall back to the window aspect.
   */
  function measuredMainContent(): ContentSize | undefined {
    const width = mainContent.getWidth()
    const height = mainContent.getHeight()
    return width > 0 && height > 0 ? { width, height } : undefined
  }

  /** Apply the tier for the window's current size. Safe to call any time. */
  function applyLayout(): void {
    if (!layoutReady) return
    // Measured from the window's content (see groundWindowSize) — never from
    // the `content` ToolbarView (in side-by-side that shrinks when the
    // drawer opens: a feedback loop) and never from the split view's
    // allocation (mid-shrink GTK hands out stale oversized numbers — a
    // measured 762 in a 450 window — which keeps selectors packed into a
    // header that cannot fit).
    // Before the first allocation the numbers are 0 — and that is the pass
    // that must get it right, because the first frame measures the tree
    // *during* present(). The size we *asked* for is the size that frame is
    // given, so it stands in until the content is allocated.
    let { width, height } = groundWindowSize()
    if (width <= 0 || height <= 0) {
      const [askedWidth, askedHeight] = window.getDefaultSize()
      width = askedWidth
      height = askedHeight
    }
    // Still nothing to decide from: a tier from 0×0 would reparent the
    // selectors for no reason. The surface's first `layout` brings the
    // real numbers.
    if (width <= 0 || height <= 0) return
    // The width bands still come from the window rectangle; the content area
    // only decides whether the diagram goes beside the timer or below it.
    const contentSize = measuredMainContent()
    const tier = layoutFor(width, height, contentSize)

    if (split.collapsed !== tier.drawer) split.collapsed = tier.drawer
    if (split.maxSidebarWidth !== tier.sidebarMax) split.maxSidebarWidth = tier.sidebarMax
    placeSelectors(tier.selectorRow)
    timerView.setSize(tier.timerSize)
    scramblePanel.setLimits(tier.scrambleChars, tier.scrambleMaxHeight)
    scramblePanel.setDiagramMax(tier.diagramMaxWidth, tier.diagramMaxHeight)
    applyDiagramPlacement(tier.diagramPlacement)

    // One line per *change* — the evidence trail when the window is walked
    // through its bands (and a cheap way to spot a tier decided from a stale
    // measurement, which is the one thing a breakpoint could get wrong).
    const signature =
      `${width}x${height} (win ${window.getSize(Gtk.Orientation.VERTICAL)}, ` +
      `content ${contentSize ? `${contentSize.width}x${contentSize.height}` : 'unallocated'}): ` +
      `${tier.drawer ? 'drawer' : 'side-by-side'}, ` +
      `selectors ${tier.selectorRow ? 'in their own row' : 'in the header'}, ` +
      `timer ${tier.timerSize}, diagram ${tier.diagramPlacement}, ` +
      `sidebar max ${tier.sidebarMax}`
    if (signature !== lastTier) {
      lastTier = signature
      console.error(`[layout] ${signature}`)
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

  /**
   * The sidebar is part of the distraction-free view too: remember whether it
   * was open when the timer takes over, hide it and grey out its toggle, and
   * put that state back when the timer returns to idle or stopped. Ctrl+B is
   * disabled meanwhile. Called on the focus transition only, not on every
   * timer update.
   */
  let sidebarWasShown = false
  function applySidebarFocus(focused: boolean): void {
    if (focused) {
      sidebarWasShown = split.getShowSidebar()
      sidebarToggle.setSensitive(false)
      sidebarAction.enabled = false
      split.setShowSidebar(false)
    } else {
      split.setShowSidebar(sidebarWasShown)
      sidebarToggle.setSensitive(true)
      sidebarAction.enabled = true
    }
  }

  /**
   * Arming, inspection and solving are the timer's own view: hide the
   * scramble, its diagram, the hint/averages, the selector bar and the solve
   * list, and grey out the list and diagram toggles. The header stays — it
   * carries Cancel and the app's controls — and everything returns when the
   * timer is idle or stopped.
   */
  const applyTimerFocus = (state: TimerState): void => {
    const focused = state !== 'idle' && state !== 'stopped'
    if (focused === timerFocus) return
    timerFocus = focused
    scramblePanel.setChromeVisible(!focused)
    timerView.setChromeVisible(!focused)
    // The diagram is hidden, so its toggle would only turn a hidden image on.
    imageToggle.setSensitive(!focused)
    applySidebarFocus(focused)
    syncBottomBar()
  }

  timer.subscribe(() => {
    render()
    cancelInspection.setVisible(timer.state === 'inspecting')
    applyTimerFocus(timer.state)
    ensureTicking()
  })

  // ---- touch: the main content is the start key -----------------------
  // The same keyDown/keyUp calls the keyboard makes, with the same key id,
  // so core/timer.ts never learns whether a finger or Space started the
  // hold (decision 15). Touch is always accepted; the mouse is opt-in via
  // `mouseStart`, so `touchOnly` keeps a stray click from arming a solve by
  // default. The gesture sits on the content under the bars, not on the
  // readout: a phone should not have to hit the digits, and the
  // header/selector buttons stay out of the target so they never arm a
  // solve by accident.
  const timerGesture = new Gtk.GestureClick({ button: 1, touchOnly: !prefs.mouseStart })
  timerGesture.on('pressed', () => {
    // A focused text entry owns the press, exactly as in the key handler.
    const focus = window.getFocus() as { getText?: () => string } | null
    if (focus !== null && typeof focus.getText === 'function') return
    // keyDown's running branch stops the solve for any fresh key, so this
    // needs no separate stop path.
    timer.keyDown(START_KEY, nowMs())
  })
  timerGesture.on('released', () => {
    timer.keyUp(START_KEY, nowMs())
  })
  // A competing gesture — the scramble's scroll, mainly — can cancel the
  // sequence without a release, and an unpaired release can arrive when the
  // implicit grab is lost. Either way the key must come back up without
  // starting the inspection that a real release would.
  const cancelPress = () => timer.cancelPress(START_KEY, nowMs())
  timerGesture.on('cancel', cancelPress)
  timerGesture.on('unpaired-release', cancelPress)
  mainContent.addController(timerGesture)

  // ---- keyboard: Space starts an inspection or arms the timer; any key stops ----
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
    const wasInspecting = timer.state === 'inspecting'

    // Delete removes the selected solve — but while a solve is running every
    // key means "stop", so the branch below gets it first.
    if (!wasRunning && keyval === Gdk.KEY_Delete && timesList.deleteSelected()) return true

    timer.keyDown(key, nowMs())

    // Consume the start key so it cannot activate a focused widget, and any
    // key press that stopped a running solve. Escape that cancelled an
    // inspection is consumed too, so the drawer handler cannot close the list
    // `applySidebarFocus` has just restored.
    return wasRunning || key === START_KEY || (wasInspecting && key === 'escape')
  })

  keyController.on('key-released', (keyval) => {
    const key = keyId(keyval)
    if (key !== null) timer.keyUp(key, nowMs())
  })

  // Escape also closes an open drawer — in the *bubble* phase, which runs
  // last. Anything that wanted the key first has already had it by then (an
  // open dialog or popover, or the capture controller above cancelling an
  // inspection or stopping a run), so the drawer only gives way when Escape
  // had nothing better to do.
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
    // GPL_3_0 means *3.0 or later* — GPL_3_0_ONLY would not. Version, repo
    // URLs and release notes come from meta.ts so they cannot drift from
    // package.json or CHANGELOG.md.
    const releaseNotes = releaseNotesHtml()
    const about = new Adw.AboutDialog({
      applicationName: APP_NAME,
      applicationIcon: ICON_NAME,
      developerName: 'Lu Xu',
      version: APP_VERSION,
      ...(APP_REPOSITORY === null ? {} : { website: APP_REPOSITORY }),
      ...(APP_ISSUES === null ? {} : { issueUrl: APP_ISSUES }),
      ...(releaseNotes === null
        ? {}
        : { releaseNotes, releaseNotesVersion: APP_VERSION }),
      comments:
        'A native GTK4 speedcubing timer, inspired by csTimer by Shuang Chen.\n' +
        'Scrambles are provided by the cstimer_module package, part of the ' +
        'csTimer project (GPL-3.0).\n' +
        'Written with the assistance of AI/LLM tools.',
      // No developers list: developerName already credits the author, and the
      // only thing it would add is a contact address, which stays unpublished.
      copyright: '© 2026 Lu Xu',
      licenseType: Gtk.License.GPL_3_0,
    })
    about.addAcknowledgementSection('Built with', [
      'csTimer and cstimer_module by Shuang Chen',
      'node-gtk',
      'GTK and libadwaita',
    ])
    about.present(window)
  }

  const aboutAction = Gio.SimpleAction.new('about', null)
  aboutAction.on('activate', () => showAbout())
  app.addAction(aboutAction)

  // Built fresh on open (an AdwDialog is gone when it closes); construction
  // stays inside the action so a node-gtk failure costs this menu item, not
  // the startup path.
  const shortcutsAction = Gio.SimpleAction.new('shortcuts', null)
  shortcutsAction.on('activate', () => createShortcutsDialog().present(window))
  app.addAction(shortcutsAction)
  // <Control>question is the gdk keyval name for '?' — a literal '?' does
  // not parse (AGENTS' keyval rule) — and GDK ignores the consumed Shift
  // that produces it (gdkevents.c), so the physical Ctrl+? matches.
  app.setAccelsForAction('app.shortcuts', ['<Control>question'])

  // Registers its own action, like the session menu does.
  createStatsPanel({ app, window, library, getSession: activeSession })
  // Every menu action needs an accelerator so tests never need a synthetic
  // click (tools/README traps 4–5). Ctrl+T: Statistics (Ctrl+S is the
  // session menu).
  app.setAccelsForAction('app.statistics', ['<Control>t'])

  /**
   * The single path for a settings change: merge the patch into this run's
   * Preferences, persist it, then push the new values into everything they
   * drive. The preferences dialog and the header's image toggle are the only
   * writers — both come through here, so the timer and prefs.json can never
   * disagree.
   */
  const applyPreferences = (patch: Partial<Preferences>): void => {
    prefs = { ...prefs, ...patch }
    store.savePreferences(prefs)

    if ('holdThresholdMs' in patch) timer.setHoldThreshold(prefs.holdThresholdMs)
    if ('mouseStart' in patch) timerGesture.touchOnly = !prefs.mouseStart
    if ('colorScheme' in patch) applyColorScheme(prefs.colorScheme)
    // imageFor reads `prefs`, so a re-render shows or drops the diagram (the
    // SVG is already cached). The equal-`active` mirror back is a no-op in
    // GtkToggleButton, so it cannot loop into the notify handler.
    if ('scrambleImage' in patch) {
      scramblePanel.render(feed.state)
      imageToggle.active = prefs.scrambleImage
    }
    if ('inspection' in patch) timer.setInspection(prefs.inspection, nowMs())
  }

  // Built fresh on open, one patch per row change, routed through
  // applyPreferences. Ctrl+comma — the freed `<Ctrl>S` is the session menu.
  createPreferences({
    app,
    window,
    get: () => prefs,
    set: (patch) => applyPreferences(patch),
  })
  app.setAccelsForAction('app.preferences', ['<Control>comma'])

  // ---- editing a solve ----------------------------------------------------
  // Ctrl+1/2/3 = OK / +2 / DNF on the *newest* solve; repeating a penalty
  // clears it, so Ctrl+2 twice is its own undo. Deliberately no Ctrl+Z — a
  // shortcut that deletes a record is not intuitive; deletions undo from
  // their toast. Ctrl+E opens the one edit dialog on the selection (or the
  // newest solve); see src/ui/timesList.ts.
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

  // The worker is a thread of this process: drop it before the loop goes, or
  // it outlives the window. Flush the pending session write first.
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
  layoutReady = true // the adaptive layout may now measure and write
  // The first applyLayout uses the size we *asked* for: the first frame
  // measures the tree during present(), so the tier must already be right
  // (see applyLayout).
  applyLayout()
  window.present()
  applyLayout() // the tier for the size we were actually given

  // The two continuous sources, both only available once realized: a
  // resize the breakpoints cannot see (height-only — no width band changes,
  // but the short-window tier does), and any repaint, where applyLayout
  // re-runs with fresh allocations and so carries every size change no
  // breakpoint sees, the Adaptive Preview's emulated-screen switches
  // included.
  const surface = window.getSurface()
  if (surface === null) {
    console.error('[layout] no Gdk.Surface after present() — resizes will not re-apply the tier')
  } else {
    surface.on('layout', () => applyLayout())
  }
  const frameClock = window.getFrameClock()
  if (frameClock === null) {
    console.error('[layout] no frame clock — resizes will not get the after-paint pass')
  } else {
    frameClock.on('after-paint', () => {
      // The fresh-allocation pass: surface layout can only re-apply what is
      // already in force (the widgets have not caught up yet), and the
      // Adaptive Preview raises no surface event at all — so every real
      // size change lands here, with no mode test. applyLayout is
      // compare-first everywhere (see the sources above), so an idle frame
      // costs one measurement and nothing else.
      applyLayout()
    })
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
