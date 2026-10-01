/*
 * sidebar_probe — verifies how Adw.OverlaySplitView applies
 * min/max-sidebar-width to the real solve-list sidebar.
 *
 * RESOLVED MYSTERY (2026-10-01): this session's display runs at scale 2
 * (Xft.dpi 192), so *all sizes here are logical px* while screenshots show
 * physical — divide screenshots by 2 to compare. The apparent "478px
 * sidebar ignoring max=320" was 240 logical (the min floor: 0.25 × 900
 * window < 240) × 2. This probe at a 1728-logical window proves the max
 * clamp: 0.25 × 1728 = 432 → clamped to 320.
 *
 * Adw.OverlaySplitView computes preferred = sidebar-width-fraction (0.25 by
 * default) × total width, clamped by min/max-sidebar-width — but "the
 * sidebar widget can still be allocated with larger width if its own minimum
 * width exceeds it". This probe rebuilds main.ts's split with the real
 * sidebar, then reports:
 *
 *   1. the properties read back from the live object (proof they were set),
 *   2. the sidebar widget's own minimum/natural width,
 *   3. the preferred and the actually allocated width.
 *
 *   GDK_BACKEND=x11 node --import tsx --import node-gtk/register tools/sidebar_probe.mjs
 */
import Adw from 'gi:Adw-1'
import Gio from 'gi:Gio-2.0'
import GLib from 'gi:GLib-2.0'
import Gtk from 'gi:Gtk-4.0'
import { Session } from '../src/core/session.js'
import { createTimesList } from '../src/ui/timesList.js'

const log = (...args) => console.error('[probe]', ...args)
// The shims expose the allocation under Gtk.Widget.getSize(orientation)
// (get_width/get_allocation are not in the generated types).
const width = (widget) => (typeof widget.getSize === 'function' ? widget.getSize(Gtk.Orientation.HORIZONTAL) : -1)

const app = new Adw.Application({
  applicationId: 'com.oliver.sidebarprobe',
  flags: Gio.ApplicationFlags.FLAGS_NONE,
})

app.on('activate', () => {
  const session = new Session([
    { id: 1, timeMs: 64_500, scramble: "R U R' U'", scrambleType: '333', createdAtMs: Date.now() - 300_000 },
    { id: 2, timeMs: 12_340, scramble: 'F2 L2', scrambleType: '333', createdAtMs: Date.now() - 60_000 },
  ])
  const list = createTimesList({ session, onDelete: () => {} })

  const window = new Adw.ApplicationWindow({ application: app, title: 'SidebarProbe' })
  // Identical settings to main.ts.
  const split = new Adw.OverlaySplitView({
    content: new Gtk.Label({ label: 'timer area', hexpand: true }),
    sidebar: list.widget,
    sidebarPosition: Gtk.PackType.END,
    minSidebarWidth: 240,
    maxSidebarWidth: 320,
    sidebarWidthUnit: Adw.LengthUnit.PX,
    showSidebar: true,
  })
  window.setContent(split)
  window.setDefaultSize(1900, 800)
  window.on('close-request', () => (app.quit(), false))
  window.present()

  GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 900, () => {
    log(`read back: min=${split.minSidebarWidth} max=${split.maxSidebarWidth} ` +
        `unit=${split.sidebarWidthUnit} fraction=${split.sidebarWidthFraction}`)
    const [ownMin, ownNat] = list.widget.measure(Gtk.Orientation.HORIZONTAL, -1)
    log(`timesList widget: own minimum=${ownMin}px natural=${ownNat}px`)
    const total = width(window)
    log(`window total=${total}px, split=${width(split)}px, ` +
        `preferred=0.25×total=${Math.round(0.25 * total)}px, clamped preferred=320px`)
    log(`sidebar ALLOCATED=${width(list.widget)}px  (320 = max applied; ~478 = not applied / own minimum wins)`)
    return GLib.SOURCE_REMOVE
  })

  GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 1300, () => {
    // If the sidebar really allocated ~478 with max=320 applied, find out
    // whether the fraction path responds at all: 0.10×1908 = 191, which the
    // min of 240 must clamp to 240.
    split.sidebarWidthFraction = 0.10
    log('set sidebarWidthFraction=0.10 (0.10×total should clamp up to min=240)')
    return GLib.SOURCE_REMOVE
  })

  GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 1700, () => {
    log(`after fraction change: sidebar ALLOCATED=${width(list.widget)}px`)
    return GLib.SOURCE_REMOVE
  })

  GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 2600, () => {
    log('done')
    app.quit()
    return GLib.SOURCE_REMOVE
  })
})

app.run([])
