/*
 * scrambleOptions.ts — the popover the type control's dropdown shows.
 *
 * The type picker chooses *which* scrambler runs; this edits how the chosen
 * one runs, so it lives on the header control rather than inside the picker.
 *
 * Two options, and the same split between a per-type value and a global tweak:
 *   - length — the number the worker passes to getScramble(): moves for
 *     random-move types, a count of scrambles or cubes for multi-blind and
 *     relays. The catalogue owns the default and the meaning.
 *   - fast scramble — swap a slow solver for its random-move stand-in
 *     (`fastScrambleType`). Only shown for the types that have one.
 *
 * Nothing here is persisted: a type change resets the length to that type's
 * default, and the fast switch lasts for the session only.
 */
import Adw from 'gi:Adw-1'
import Gtk from 'gi:Gtk-4.0'

import {
  fastScrambleType,
  scrambleLength,
  scrambleLengthKind,
} from '../core/scrambleTypes.js'

export interface ScrambleOptionsOptions {
  /** Type to open on; the rows read the rest from the catalogue. */
  initialType: string
  /** Called with the new length, after the user changes the spinner. */
  onChange: (length: number) => void
  /** Called when the fast-scramble switch flips. */
  onFastScramble: (fast: boolean) => void
}

/** csTimer's length input allows three digits; the same ceiling here. */
const MAX_LENGTH = 999

const titleFor = (type: string): string => {
  switch (scrambleLengthKind(type)) {
    case 'scrambles':
      return 'Number of scrambles'
    case 'cubes':
      return 'Number of cubes'
    case 'moves':
      return 'Moves'
  }
}

export function createScrambleOptions(options: ScrambleOptionsOptions) {
  const lengthRow = new Adw.SpinRow({
    digits: 0,
    numeric: true,
    adjustment: new Gtk.Adjustment({
      lower: 1,
      upper: MAX_LENGTH,
      stepIncrement: 1,
      value: 1,
    }),
  })

  const fastRow = new Adw.SwitchRow({ title: 'Fast scramble' })

  const list = new Gtk.ListBox({
    cssClasses: ['boxed-list'],
    selectionMode: Gtk.SelectionMode.NONE,
    widthRequest: 260,
  })
  list.append(lengthRow)
  list.append(fastRow)

  const popover = new Gtk.Popover({ child: list })

  // Programmatic updates (a type or session change) must not look like a
  // user edit and write the default back to main.ts; a rounded spin must not
  // report the same number twice, either.
  let syncing = false
  let lastSent = 0
  lengthRow.on('notify::value', () => {
    if (syncing) return
    const value = Math.round(lengthRow.value)
    if (value !== lengthRow.value) {
      syncing = true
      lengthRow.value = value
      syncing = false
    }
    if (value === lastSent) return
    lastSent = value
    options.onChange(value)
  })

  fastRow.on('notify::active', () => {
    if (syncing) return
    options.onFastScramble(fastRow.active)
  })

  /**
   * Point the rows at `type`. The fast switch appears only where the
   * catalogue has a stand-in; a type with no length leaves the length row
   * untouched: the control detaches this popover, so the stale number can
   * never be read, and it is never a wrong one either.
   */
  const setType = (type: string): void => {
    fastRow.visible = fastScrambleType(type) !== null
    const length = scrambleLength(type)
    if (length <= 0) return
    syncing = true
    lengthRow.title = titleFor(type)
    lengthRow.value = length
    lastSent = length
    syncing = false
  }

  setType(options.initialType)

  /** The popover, and the way to follow the selected type. */
  return { popover, setType }
}
