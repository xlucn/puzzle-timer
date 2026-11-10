// Scramble-control probe (2026-11-03; fast switch 2026-11-05): the header's
// Adw.SplitButton — the button half opens the type picker, the arrow half opens
// the current type's options in one popover.
//
// Rows: the length (per type) and the fast-scramble switch (only for types with
// a random-move stand-in — the pre-scramble is a preference). Checks both
// halves and their tooltips, the per-type length, the switch's visibility and
// callback, the single-callback edit, rounding, and — the reason this is a
// split button at all — that a type with no length detaches the popover, which
// libadwaita renders as an insensitive arrow while the picker half stays live.
//
// Usage: node --import tsx --import node-gtk/register tools/scramble_control_probe.mjs
import Adw from 'gi:Adw-1'
import Gio from 'gi:Gio-2.0'
import GLib from 'gi:GLib-2.0'
import Gtk from 'gi:Gtk-4.0'

import { setLocale } from '../src/core/i18n.js'
import { createScrambleTypeControl } from '../src/ui/scrambleTypeControl.js'

// Probes assert English labels, so fix the catalog rather than the host locale.
setLocale('en')

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
  const fasts = []
  let chooses = 0
  const control = createScrambleTypeControl({
    initialType: 'r3ni',
    onChoose: () => {
      chooses += 1
    },
    onLengthChange: (length) => lengths.push(length),
    onFastScrambleChange: (fast) => fasts.push(fast),
  })

  const header = new Adw.HeaderBar({ showTitle: false })
  header.packStart(control.widget)
  const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
  box.append(header)
  window.setContent(box)

  const split = control.widget
  const popover = split.getPopover()
  const list = popover.getChild()
  const lengthRow = list.getFirstChild()
  const fastRow = lengthRow.getNextSibling()
  const arrow = childOf(split, 'GtkMenuButton')
  const arrowToggle = childOf(arrow, 'GtkToggleButton')

  const checkStructure = () => {
    check(
      split.constructor.name === 'AdwSplitButton' &&
        split.iconName === 'view-grid-symbolic' &&
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
        lengthRow.constructor.name === 'AdwSpinRow' &&
        fastRow.constructor.name === 'AdwSwitchRow' &&
        fastRow.getNextSibling() === null,
      `popover holds the length and fast rows (${list.constructor.name} > ${lengthRow.constructor.name}, ${fastRow.constructor.name})`,
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
      lengthRow.title === 'Number of scrambles' && Math.abs(lengthRow.value - 5) < 1e-9,
      `3x3 mbld: "Number of scrambles", starts at 5 (title "${lengthRow.title}", value ${lengthRow.value})`,
    )
    check(!fastRow.visible, `3x3 mbld has no fast switch (visible=${fastRow.visible})`)
    const before = lengths.length
    lengthRow.value = 3
    check(
      lengths.length === before + 1 && lengths.at(-1) === 3,
      `a user edit reports 3 once (${JSON.stringify(lengths)})`,
    )
    // Re-selecting the same type must not write its default back.
    const again = lengths.length
    control.setType('r3ni')
    check(
      lengths.length === again && Math.abs(lengthRow.value - 5) < 1e-9,
      `a type refresh at the same default stays silent and restores 5 (${lengthRow.value})`,
    )
  }

  const checkMoves = () => {
    control.setType('333o')
    check(
      lengthRow.title === 'Moves' && Math.abs(lengthRow.value - 25) < 1e-9,
      `random move: "Moves", 25 (title "${lengthRow.title}", value ${lengthRow.value})`,
    )
    const before = lengths.length
    lengthRow.value = 10
    check(
      lengths.length === before + 1 && lengths.at(-1) === 10,
      `a real change reports 10 once (${JSON.stringify(lengths)})`,
    )
  }

  const checkCubes = () => {
    control.setType('r3')
    check(
      lengthRow.title === 'Number of cubes' && Math.abs(lengthRow.value - 5) < 1e-9,
      `relay: "Number of cubes", 5 (title "${lengthRow.title}", value ${lengthRow.value})`,
    )
  }

  const checkInteger = () => {
    control.setType('555wca') // 60 moves
    const before = lengths.length
    lengthRow.value = 12.6
    check(
      Math.abs(lengthRow.value - 13) < 1e-9 &&
        lengths.at(-1) === 13 &&
        lengths.length === before + 1,
      `a fractional spin is rounded before it leaves the row (got ${lengthRow.value}, reported ${lengths.at(-1)})`,
    )
  }

  const checkFast = () => {
    const before = fasts.length
    control.setType('444wca')
    check(
      fastRow.visible && Math.abs(lengthRow.value - 40) < 1e-9,
      `4x4x4 shows the fast switch and keeps its 40 moves (visible=${fastRow.visible}, value ${lengthRow.value})`,
    )
    check(fasts.length === before, `a type change does not flip the switch (${JSON.stringify(fasts)})`)
    fastRow.active = true
    fastRow.active = false
    check(
      fasts.length === before + 2 && fasts.at(-2) === true && fasts.at(-1) === false,
      `the switch reports both flips once each (${JSON.stringify(fasts)})`,
    )
    control.setType('555wca')
    check(!fastRow.visible, `5x5x5 has no fast switch (visible=${fastRow.visible})`)
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
        const choosesBefore = chooses
        split.emit('clicked')
        check(
          chooses === choosesBefore + 1,
          `the picker half still works on a length-less type (${chooses})`,
        )
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
          check(
            popover.visible,
            `the restored arrow opens the popover (visible=${popover.visible})`,
          )
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
    checkFast()
    checkNoLength()
  })
})

app.run([])
