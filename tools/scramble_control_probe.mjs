// Scramble-control probe (2026-11-03): the header's Adw.SplitButton — the
// button half opens the type picker, the arrow half opens the current type's
// options, one popover holding a single length SpinRow.
//
// Checks the two halves (icon, both tooltips, flat), the row per type (Moves /
// Number of scrambles / Number of cubes), that a programmatic type change does
// not look like a user edit, that a user edit reaches the callback once and
// integer-only, and — the reason this is a split button at all — that a type
// with no length detaches the popover, which libadwaita renders as an
// insensitive arrow while the picker half stays live.
//
// Usage: node --import tsx --import node-gtk/register tools/scramble_control_probe.mjs
import Adw from 'gi:Adw-1'
import Gio from 'gi:Gio-2.0'
import GLib from 'gi:GLib-2.0'
import Gtk from 'gi:Gtk-4.0'

import { createScrambleTypeControl } from '../src/ui/scrambleTypeControl.js'

const log = (...args) => console.error('[o]', ...args)
let failures = 0
const check = (ok, what) => {
  log(`${ok ? 'PASS' : 'FAIL'} — ${what}`)
  if (!ok) failures += 1
}

/** G_PRIORITY_DEFAULT; a boolean source callback keeps the timeout one-shot. */
const GLIB_PRIORITY_DEFAULT = 0
const after = (ms, fn) => {
  GLib.timeoutAdd(GLIB_PRIORITY_DEFAULT, ms, () => {
    fn()
    return false
  })
}

/**
 * The halves are libadwaita's own children, not ours: the arrow is the
 * GtkMenuButton next to the button, and the toggle inside it is what carries
 * the insensitive state when the popover is detached.
 */
const childOf = (parent, name) => {
  let c = parent.getFirstChild()
  while (c) {
    if (c.constructor.name === name) return c
    c = c.getNextSibling()
  }
  return null
}

const app = new Adw.Application({
  applicationId: 'io.github.xlucn.PuzzleTimer.probe.scramblecontrol',
  flags: Gio.ApplicationFlags.FLAGS_NONE,
})

app.on('activate', () => {
  const window = new Adw.ApplicationWindow({ application: app })
  window.setDefaultSize(900, 540)

  const lengths = []
  let chooses = 0
  const control = createScrambleTypeControl({
    initialType: 'r3ni',
    onChoose: () => {
      chooses += 1
    },
    onLengthChange: (length) => lengths.push(length),
  })

  const header = new Adw.HeaderBar({ showTitle: false })
  header.packStart(control.widget)
  const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
  box.append(header)
  window.setContent(box)

  const split = control.widget
  const popover = split.getPopover()
  const list = popover.getChild()
  const row = list.getFirstChild()
  const arrow = childOf(split, 'GtkMenuButton')
  const arrowToggle = childOf(arrow, 'GtkToggleButton')

  const checkStructure = () => {
    check(
      split.constructor.name === 'AdwSplitButton' &&
        split.iconName === 'view-list-symbolic' &&
        split.cssClasses.includes('flat'),
      `control is a flat AdwSplitButton with the type icon (${split.iconName}, classes ${split.cssClasses.join(',') || 'none'})`,
    )
    check(
      split.tooltipText === 'Choose the scramble type',
      `button half tooltip = "${split.tooltipText}"`,
    )
    check(
      split.dropdownTooltip === 'Scramble options',
      `arrow half tooltip = "${split.dropdownTooltip}"`,
    )
    check(
      list.constructor.name === 'GtkListBox' &&
        list.cssClasses.includes('boxed-list') &&
        row.constructor.name === 'AdwSpinRow' &&
        row.getNextSibling() === null,
      `popover holds a boxed list with one SpinRow (${list.constructor.name} > ${row.constructor.name})`,
    )
    check(
      split.getPopover() === popover && popover.getParent() === arrow,
      `popover is attached to the arrow half (${popover.getParent()?.constructor.name ?? 'no parent'})`,
    )
  }

  const checkChoose = () => {
    const before = chooses
    split.emit('clicked')
    check(chooses === before + 1, `the button half reaches onChoose once (${chooses})`)
  }

  const checkR3ni = () => {
    check(
      row.title === 'Number of scrambles' && Math.abs(row.value - 5) < 1e-9,
      `3x3 mbld: "Number of scrambles", starts at 5 (title "${row.title}", value ${row.value})`,
    )
    const before = lengths.length
    row.value = 3
    check(
      lengths.length === before + 1 && lengths.at(-1) === 3,
      `a user edit reports 3 once (${JSON.stringify(lengths)})`,
    )
    // Re-selecting the same type must not write its default back.
    const again = lengths.length
    control.setType('r3ni')
    check(
      lengths.length === again && Math.abs(row.value - 5) < 1e-9,
      `a type refresh at the same default stays silent and restores 5 (${row.value})`,
    )
  }

  const checkMoves = () => {
    control.setType('333o')
    check(
      row.title === 'Moves' && Math.abs(row.value - 25) < 1e-9,
      `random move: "Moves", 25 (title "${row.title}", value ${row.value})`,
    )
    const before = lengths.length
    row.value = 10
    check(
      lengths.length === before + 1 && lengths.at(-1) === 10,
      `a real change reports 10 once (${JSON.stringify(lengths)})`,
    )
  }

  const checkCubes = () => {
    control.setType('r3')
    check(
      row.title === 'Number of cubes' && Math.abs(row.value - 5) < 1e-9,
      `relay: "Number of cubes", 5 (title "${row.title}", value ${row.value})`,
    )
  }

  const checkInteger = () => {
    control.setType('555wca') // 60 moves
    const before = lengths.length
    row.value = 12.6
    check(
      Math.abs(row.value - 13) < 1e-9 &&
        lengths.at(-1) === 13 &&
        lengths.length === before + 1,
      `a fractional spin is rounded before it leaves the row (got ${row.value}, reported ${lengths.at(-1)})`,
    )
  }

  const checkNoLength = () => {
    // Open the popover first, so the closing can be observed.
    arrow.popup()
    after(400, () => {
      check(popover.visible, `the arrow opens the popover (visible=${popover.visible})`)
      control.setType('333') // random-state: no length
      after(300, () => {
        check(
          split.getPopover() === null && popover.visible === false,
          `3x3x3 detaches the popover and closes it (attached=${split.getPopover() !== null}, visible=${popover.visible})`,
        )
        check(
          split.sensitive && arrowToggle.sensitive === false,
          `only the arrow is disabled: picker half sensitive=${split.sensitive}, arrow toggle sensitive=${arrowToggle.sensitive}`,
        )
        const before = chooses
        split.emit('clicked')
        check(chooses === before + 1, `the picker half still works on a length-less type (${chooses})`)
        // Detaching must not be a one-way door.
        control.setType('444wca')
        check(
          split.getPopover() === popover && arrowToggle.sensitive,
          `a length type re-attaches the popover (attached=${split.getPopover() === popover}, arrow sensitive=${arrowToggle.sensitive})`,
        )
        // `SplitButton.popup()` does not reopen after a detach; the arrow's own
        // path — what a click takes — does.
        arrow.popup()
        after(400, () => {
          check(popover.visible, `the restored arrow opens the popover (visible=${popover.visible})`)
          log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`)
          app.quit()
        })
      })
    })
  }

  window.on('close-request', () => false)
  window.present()

  after(500, () => {
    checkStructure()
    checkChoose()
    checkR3ni()
    checkMoves()
    checkCubes()
    checkInteger()
    checkNoLength()
  })
})

app.run([])
