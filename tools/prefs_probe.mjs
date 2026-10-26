/*
 * prefs_probe.mjs — verifies the M5 preferences dialog's GTK plumbing:
 *
 *   1. Adw.PreferencesDialog + PreferencesPage + PreferencesGroup build and
 *      present under node-gtk (same class of risk as the other Adw widgets
 *      we probe-verified first);
 *   2. Adw.SpinRow reads back in seconds and reports `notify::value`;
 *   3. Adw.SwitchRow reports `notify::active`;
 *   4. a patch produced by a row change merges into the run's Preferences
 *      the way main.ts's applyPreferences() does;
 *   5. the Theme ComboRow renders the selected item's label from a plain
 *      Gtk.StringList with no Gtk.Expression (the expression was dropped
 *      2026-10-06 — this is what says a future libadwaita still does it).
 *
 * Run:
 *   GDK_BACKEND=x11 node --import tsx --import node-gtk/register tools/prefs_probe.mjs
 */
import Adw from 'gi:Adw-1'
import Gio from 'gi:Gio-2.0'
import GLib from 'gi:GLib-2.0'

import { DEFAULT_PREFERENCES, normalizePreferences } from '../src/core/preferences.js'
import { createPreferences } from '../src/ui/preferences.js'

const log = (...args) => console.error('[probe]', ...args)
let failures = 0
const check = (ok, what) => {
  log(`${ok ? 'PASS' : 'FAIL'} — ${what}`)
  if (!ok) failures += 1
}

const app = new Adw.Application({
  applicationId: 'io.github.xlucn.PuzzleTimer.probe.prefs',
  flags: Gio.ApplicationFlags.FLAGS_NONE,
})

/** Depth-first walk for the row whose title matches. */
const findRow = (root, title) => {
  if (root === null) return null
  if (root.getTitle?.() === title) return root
  let child = root.getFirstChild?.() ?? null
  while (child !== null) {
    const hit = findRow(child, title)
    if (hit !== null) return hit
    child = child.getNextSibling?.()
  }
  return null
}

/**
 * Text of every label under a widget that is actually showing. Descending
 * into a closed popover would pick up its item labels, so invisible subtrees
 * are skipped wholesale (`visible === false` — the popup reports that even
 * while its own children claim visible=true).
 */
const shownLabels = (root, out = []) => {
  if (root === null) return out
  if (root.visible === false) return out
  try {
    if (typeof root.label === 'string' && root.label.length > 0) out.push(root.label)
  } catch {
    /* not a label — nothing to read */
  }
  let child = root.getFirstChild?.() ?? null
  while (child !== null) {
    shownLabels(child, out)
    child = child.getNextSibling?.()
  }
  return out
}

app.on('activate', () => {
  const window = new Adw.ApplicationWindow({ application: app })
  window.setDefaultSize(640, 480)

  // The same state shape main.ts keeps: one object, patches merged in.
  let prefs = DEFAULT_PREFERENCES
  const patches = []
  const set = (patch) => {
    patches.push(patch)
    prefs = normalizePreferences({ ...prefs, ...patch })
  }

  const { open } = createPreferences({ app, window, get: () => prefs, set })
  const dialog = open()

  dialog.on('map', () => {
    // Walk the built dialog: page → group → rows. From the dialog itself, so
    // rows on pages that are not the visible one are found too.
    const page = dialog.getVisiblePage?.() ?? null
    check(page !== null, 'the dialog has a visible page')

    const hold = findRow(dialog, 'Hold time')
    check(hold !== null, 'found the Hold time SpinRow')
    if (hold !== null) {
      check(Math.abs(hold.value - 0.3) < 1e-9, `opens on the stored 0.30 s (got ${hold.value})`)
      hold.value = 0.55 // a user step / typed value
    }

    const mouse = findRow(dialog, 'Mouse control')
    check(mouse !== null, 'found the Mouse control SwitchRow')
    if (mouse !== null) {
      check(mouse.getActive() === false, 'mouse control starts OFF (default)')
      mouse.setActive(true)
    }

    const inspection = findRow(dialog, 'WCA inspection')
    check(inspection !== null, 'found the WCA inspection SwitchRow')
    if (inspection !== null) inspection.setActive(false)

    const cues = findRow(dialog, 'Inspection sound cues')
    check(cues !== null, 'found the sound cues SwitchRow')
    if (cues !== null) check(cues.getActive() === true, 'cues start ON (default)')

    // Appearance: the ComboRow opens on the stored scheme, and its default
    // factory labels a plain Gtk.StringList with no expression set (dropped
    // 2026-10-06 — measured identical trees with and without on GTK 4.22.5 /
    // libadwaita 1.9.4). Read from the row itself, so the popover's item
    // labels (invisible, skipped) cannot stand in for the selected label.
    const theme = findRow(dialog, 'Theme')
    check(theme !== null, 'found the Theme ComboRow')
    if (theme !== null) {
      check(theme.selected === 0, `opens on "Follow system" (got ${theme.selected})`)
      check(
        shownLabels(theme).includes('Follow system'),
        'the selected-item label renders without a Gtk.Expression',
      )
      theme.selected = 2 // "Dark"
    }

    // Scramble page: the image switch.
    const image = findRow(dialog, 'Show the scramble image')
    check(image !== null, 'found the scramble image SwitchRow')
    if (image !== null) {
      check(image.getActive() === true, 'images start ON (default)')
      image.setActive(false)
    }

    // Let the notify emissions settle, then read back the merged state.
    GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 100, () => {      check(
        patches.some((p) => p.holdThresholdMs === 550),
        `SpinRow in seconds reported 550 ms (${JSON.stringify(patches)})`,
      )
      check(
        patches.some((p) => p.inspection === false),
        'SwitchRow reported inspection off',
      )
      check(
        patches.some((p) => p.mouseStart === true),
        'SwitchRow reported mouse control on',
      )
      check(prefs.holdThresholdMs === 550, 'the merged preference holds 550 ms')
      check(prefs.inspection === false, 'the merged preference has inspection off')
      check(prefs.mouseStart === true, 'the merged preference has mouse control on')
      check(prefs.inspectionSound === true, 'untouched fields survive the merge')
      check(
        patches.some((p) => p.colorScheme === 'dark'),
        `the ComboRow reported the colour scheme (${JSON.stringify(patches)})`,
      )
      check(prefs.colorScheme === 'dark', 'the merged preference is dark')
      // The label follows the selection too — still with no expression set.
      if (theme !== null) {
        check(
          shownLabels(theme).includes('Dark'),
          'the selected-item label follows a change without a Gtk.Expression',
        )
      }
      check(prefs.scrambleImage === false, 'the image switch reported off')

      log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`)
      app.quit()
      return GLib.SOURCE_REMOVE // a source callback must yield a Boolean
    })
  })

  // node-gtk requires the close-request emission to yield a Boolean (main.ts
  // does the same); without it the probe ends in a TypeError after the PASSes.
  window.on('close-request', () => false)
  window.present()
})

app.run([])
