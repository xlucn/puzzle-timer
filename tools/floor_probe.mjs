// Window-floor probe (2026-10-15): how BREAKPOINTS.minHeight maps onto the
// widget/surface on this stack — the numbers the AGENTS floor walk expects.
//   1. the real constants are the HIG phone minimum (360x294), and
//   2. heightRequest floors the widget on initial allocation — and holds
//      that floor when an *external* resize (xdotool, like the floor walk)
//      tries to push below it? widget clamps to the request, or the
//      configure is followed all the way down?
// The second decides the `[layout]` line at the floor.
//
// Usage: GDK_BACKEND=x11 node --import tsx --import node-gtk/register tools/floor_probe.mjs
import Adw from 'gi:Adw-1'
import Gtk from 'gi:Gtk-4.0'
import GLib from 'gi:GLib-2.0'
import { spawnSync } from 'node:child_process'
Gtk.init()

const { BREAKPOINTS } = await import('../src/core/layout.ts')

const app = new Adw.Application({ applicationId: 'org.cstimer.gtk.floorprobe' })
const checks = []
const check = (name, ok) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${name}`)
const read = (win) => {
  const surface = win.getSurface()
  return {
    widget: `${win.getWidth()}x${win.getHeight()}`,
    surface: `${surface.getWidth()}x${surface.getHeight()}`,
    w: win.getWidth(),
    h: win.getHeight(),
    sW: surface.getWidth(),
    sH: surface.getHeight(),
  }
}

app.on('activate', () => {
  const win = new Adw.ApplicationWindow({ application: app, title: 'cstimer-floor-probe' })
  // Empty content: its own minimum is ~0, so only the request can floor it.
  win.setContent(new Gtk.Box())
  win.setDefaultSize(900, 540) // above the floor: initial alloc follows default
  win.widthRequest = BREAKPOINTS.minWidth
  win.heightRequest = BREAKPOINTS.minHeight
  win.present()

  GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 300, () => {
    const first = read(win)
    console.error(`[e] constants ${BREAKPOINTS.minWidth}x${BREAKPOINTS.minHeight}; initial widget ${first.widget} surface ${first.surface}`)

    // External resize below both candidate floors — the floor walk's move.
    const ids = spawnSync('xdotool', ['search', '--name', 'cstimer-floor-probe'], { encoding: 'utf8' })
    const wid = (ids.stdout ?? '').trim().split('\n')[0]
    let forced = 'no xid'
    if (wid) {
      const r = spawnSync('xdotool', ['windowsize', '--sync', wid, '350', '280'], { encoding: 'utf8' })
      forced = `wid ${wid}: ${r.status === 0 ? 'resized to surface 350x280' : 'xdotool failed ' + r.stderr}`
    }
    console.error(`[e] force: ${forced}`)

    GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 300, () => {
      const second = read(win)
      console.error(`[e] after forced 350x280: widget ${second.widget} surface ${second.surface}`)

      check('constants are the HIG phone minimum (360x294)', BREAKPOINTS.minWidth === 360 && BREAKPOINTS.minHeight === 294)
      check(`initial allocation follows the default (${first.widget})`, first.w === 900 && first.h === 540)
      // Widget-min enforcement: widget never drops below the request, so a
      // forced 350x280 clamps to widget 360x294. Bypass: widget follows down.
      const enforced = second.w >= BREAKPOINTS.minWidth && second.h >= BREAKPOINTS.minHeight
      check(
        `floor holds against a forced resize (widget ${second.widget}, surface ${second.surface})`,
        enforced,
      )
      const delta = `${second.sW - second.w}x${second.sH - second.h}`
      console.error(`[e] surface - widget at rest: ${delta} (environment CSD, not asserted)`)

      for (const c of checks) console.error(`[e] ${c}`)
      const fails = checks.filter((c) => c.startsWith('FAIL'))
      console.error(
        `[e] RESULT: ${checks.length - fails.length}/${checks.length} ${fails.length === 0 ? 'ALL PASS' : 'FAILURES: ' + fails.join('; ')}`,
      )
      app.quit()
      return false
    })
    return false
  })
})
app.run([])
