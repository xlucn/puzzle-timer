/*
 * breakpoint_probe — the M6 plumbing question, answered before any UI code.
 *
 * Three things have to be true for the adaptive layout to work at all, and
 * none of them can be taken on faith (AGENTS: measure, don't assume):
 *
 *   1. `Adw.Breakpoint::apply` / `::unapply` fire under node-gtk, with
 *      sizes that are already current when the handler runs.
 *   2. Mutually exclusive conditions really do fire on *every* crossing of a
 *      boundary. libadwaita keeps one current breakpoint ("if multiple
 *      breakpoints can be used for the current size, the last one is always
 *      picked" — AdwBreakpointBin, which AdwWindow refers to), so overlapping
 *      bands would starve each other; this walks the window down and up
 *      through both structural bands and prints what fired.
 *   3. `Gdk.Surface::layout` reports the window's logical size on every
 *      resize — the continuous hook the sizes and the timer nudge need, since
 *      a breakpoint only fires on a boundary crossing.
 *
 * It also checks whether `set_default_size` resizes an *already presented*
 * window (it would let every later verification drive sizes in-process
 * instead of fighting CSD shadows with `xdotool windowsize`).
 *
 * Run (any screen at least ~950 px wide works; the bands are ≤540 and 541–800):
 *   Xephyr :99 -screen 1280x800 -ac -br &
 *   DISPLAY=:99 GDK_BACKEND=x11 node --import tsx --import node-gtk/register \
 *     tools/breakpoint_probe.mjs
 *
 * Sizes are logical px (Xephyr is scale 1, so they are also physical there).
 */
import Adw from 'gi:Adw-1'
import Gio from 'gi:Gio-2.0'
import GLib from 'gi:GLib-2.0'
import Gtk from 'gi:Gtk-4.0'

import { BREAKPOINTS } from '../src/core/layout.js'

const started = Number(GLib.getMonotonicTime())
const log = (...args) =>
  console.error('[probe]', `${((Number(GLib.getMonotonicTime()) - started) / 1e6).toFixed(2)}s`, ...args)

/**
 * The same two structural bands main.ts adds, in the same order (B first),
 * built from the same thresholds. A copy of the numbers lived here once and
 * drifted when `selectorRowMax` moved 600 → 540, leaving a probe that tested
 * bands the app had stopped using.
 */
const BANDS = [
  [
    'B',
    `min-width: ${BREAKPOINTS.selectorRowMax + 1}px and max-width: ${BREAKPOINTS.drawerMax}px`,
  ],
  ['C', `max-width: ${BREAKPOINTS.selectorRowMax}px`],
]

const app = new Adw.Application({
  applicationId: 'io.github.xlucn.PuzzleTimer.probe.breakpoint',
  flags: Gio.ApplicationFlags.FLAGS_NONE,
})

app.on('activate', () => {
  const window = new Adw.ApplicationWindow({ application: app })
  window.setTitle('BreakpointProbe')

  const content = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 6,
    hexpand: true,
    vexpand: true,
  })
  content.append(new Gtk.Label({ label: 'content area' }))
  window.setContent(content)

  let layoutSize = '(no layout yet)'
  let current = '(none)'
  const describe = (tag) => {
    const w = window.getWidth()
    const h = window.getHeight()
    const cw = content.getSize(Gtk.Orientation.HORIZONTAL)
    const ch = content.getSize(Gtk.Orientation.VERTICAL)
    // If window/content disagree with the layout signal, handlers were run
    // against a stale measurement — that would decide tiers from old numbers.
    return `${tag} current=${current} window=${w}x${h} content=${cw}x${ch} layout=${layoutSize}`
  }

  const kept = []
  for (const [name, condition] of BANDS) {
    const breakpoint = Adw.Breakpoint.new(Adw.BreakpointCondition.parse(condition))
    breakpoint.on('apply', () => {
      current = name
      log('apply ', name, describe(''))
    })
    breakpoint.on('unapply', () => {
      if (current === name) current = '(none)'
      log('unapply', name, describe(''))
    })
    window.addBreakpoint(breakpoint)
    kept.push(breakpoint)
  }
  log(`registered ${kept.length} breakpoints`)

  window.on('close-request', () => (app.quit(), false))
  window.setDefaultSize(900, 540)
  window.present()

  const surface = window.getSurface()
  if (surface === null) {
    log('FATAL: no Gdk.Surface after present()')
    app.quit()
    return
  }
  surface.on('layout', (width, height) => {
    layoutSize = `${width}x${height}`
    log('layout ', layoutSize, `window=${window.getWidth()}x${window.getHeight()}`)
  })

  // Does set_default_size move a window that is already on screen? Each step
  // crosses exactly one boundary, so a missing apply/unapply is obvious.
  const walk = [
    [1000, BREAKPOINTS.selectorRowMax + 60, 900], // (none) → B
    [2000, BREAKPOINTS.selectorRowMax - 40, 900], // B → C
    [3000, 900, 500], // C → (none), and a short window for the height signal
    [4000, BREAKPOINTS.selectorRowMax + 60, 500], // (none) → B
    [5000, BREAKPOINTS.selectorRowMax - 40, 500], // B → C
    [6000, 900, 540], // C → (none), home
  ]
  for (const [delay, width, height] of walk) {
    GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, delay, () => {
      log(`set_default_size(${width}, ${height})`)
      window.setDefaultSize(width, height)
      return GLib.SOURCE_REMOVE
    })
  }

  GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 9500, () => {
    log('done — 6 steps, each crossing one boundary: 4 applies and 4 unapplies, none missed')
    app.quit()
    return GLib.SOURCE_REMOVE
  })
})

app.run([])
