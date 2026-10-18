// Adaptive-preview probe (2026-10-11): the two premises behind
// groundWindowSize() reading `window.content` in src/main.ts —
//   1. toggling the preview reparents the content into an emulated screen
//      whose allocation is NOT the window's, and
//   2. the window's breakpoints are evaluated against that screen (they
//      live on the content bin below the preview), not against the surface.
// Premise 1 is why the surface is the wrong rectangle there; premise 2 is
// what keeps the width bands correct by construction.
//
// Usage: node --import tsx --import node-gtk/register tools/preview_probe.mjs
import Adw from 'gi:Adw-1'
import Gtk from 'gi:Gtk-4.0'
import GLib from 'gi:GLib-2.0'
Gtk.init()
const app = new Adw.Application({ applicationId: 'io.github.xlucn.PuzzleTimer.probe.preview' })
const checks = []
const check = (name, ok) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${name}`)

app.on('activate', () => {
  const win = new Adw.ApplicationWindow({ application: app, defaultWidth: 1000, defaultHeight: 700 })
  const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
  box.append(
    new Gtk.Label({
      label: 'app content',
      hexpand: true,
      vexpand: true,
      halign: Gtk.Align.CENTER,
      valign: Gtk.Align.CENTER,
    }),
  )
  win.setContent(box)
  win.present()

  // The user's path: present first, then toggle (Ctrl+Shift+M does this
  // through the shortcut; the property is the same setter).
  GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 200, () => {
    win.adaptivePreview = true

    GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 400, () => {
      const content = win.content
      const cW = content.getWidth()
      const cH = content.getHeight()
      const wW = win.getWidth()
      check(`adaptivePreview toggles on (=${win.adaptivePreview})`, win.adaptivePreview === true)
      check(
        `content is the emulated screen, not the window (${cW}x${cH} vs win ${wW}x${win.getHeight()})`,
        cW > 0 && cW < wW - 50 && cH > 0,
      )

      // Premise 2: a max-width equal to the screen applies although the
      // window is far wider — it could only apply if the *window* were
      // measured, and the window is not ≤ cW.
      let applied = false
      const bp = Adw.Breakpoint.new(Adw.BreakpointCondition.parse(`max-width: ${cW}px`))
      bp.on('apply', () => {
        applied = true
      })
      win.addBreakpoint(bp)

      // The breakpoint applies on a size pass of the bin, which can race a
      // fixed delay — poll until it lands (30 x 100ms), then report.
      let waits = 0
      GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 100, () => {
        if (!applied && ++waits < 30) return true
        check(
          `window breakpoint measures the screen (applied=${applied}; window wider by ${wW - cW}px)`,
          applied === true,
        )
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
    return false
  })
})
app.run([])
