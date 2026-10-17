#!/usr/bin/env node
/*
 * icon_probe.mjs — does the icon theme resolve the icons in the repo?
 *
 * Structural, not visual: typecheck proves the Gtk calls exist, not that the
 * theme finds anything. Needs a display server, but opens no window and sends
 * no input, so it is safe on the live session.
 *
 *   node --import tsx --import node-gtk/register tools/icon_probe.mjs
 */
import { fileURLToPath } from 'node:url'

import Gdk from 'gi:Gdk-4.0'
import Gtk from 'gi:Gtk-4.0'

const NAME = 'puzzle-timer'
// The search path holds *theme directories*, so it is the parent of hicolor
// and not hicolor itself — pointing at hicolor finds nothing.
const searchPath = fileURLToPath(new URL('../data/icons', import.meta.url))

// Gtk.init() is what opens the display. node-gtk's generated types do not
// surface it, which is part of why this file is .mjs rather than .ts.
Gtk.init()

const display = Gdk.Display.getDefault()
if (display === null) {
  console.error('FAIL: no display. Set WAYLAND_DISPLAY or DISPLAY (tools/README.md).')
  process.exit(1)
}

// The same call main.ts makes at startup; the search path is the repo's
// hicolor tree, which a packaged install would replace with
// /usr/share/icons/hicolor.
const theme = Gtk.IconTheme.getForDisplay(display)
theme.addSearchPath(searchPath)

let failed = false
for (const icon of [NAME, `${NAME}-symbolic`]) {
  const found = theme.hasIcon(icon)
  console.log(`  ${found ? 'PASS' : 'FAIL'}  ${icon}`)
  if (!found) failed = true
}
console.log(`  search path: ${searchPath}`)
console.log(failed ? 'FAIL' : 'ALL PASS')
process.exit(failed ? 1 : 0)
