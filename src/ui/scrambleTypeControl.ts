/*
 * scrambleTypeControl.ts — the header's scramble-type control.
 *
 * One `Adw.SplitButton`, two halves: the button opens the type picker (the
 * "category - type" label itself lives in the header's centre as an
 * `Adw.WindowTitle`, src/ui/scrambleTypeTitle.ts, so the half is icon-only),
 * and the dropdown arrow opens the current type's options
 * (src/ui/scrambleOptions.ts).
 *
 * The halves must be able to disagree: a type whose length the catalogue
 * fixes (e.g. the random-state 3x3) has no options, yet its type is still
 * choosable. Detaching the popover is how `Adw.SplitButton` disables only the
 * arrow — libadwaita makes the dropdown's inner toggle insensitive and leaves
 * the button half alone — so nothing is ever a dead button that looks alive.
 *
 * The picker dialog is passed in as `onChoose`: main.ts owns the single
 * instance, so the wide header and the narrow bottom bar open the same dialog.
 */
import Adw from 'gi:Adw-1'

import { t } from '../core/i18n.js'
import { scrambleLength } from '../core/scrambleTypes.js'
import { createScrambleOptions } from './scrambleOptions.js'

export interface ScrambleTypeControlOptions {
  /** Type to open on; the rest is read from the catalogue. */
  initialType: string
  /** Called when the button half is activated — main.ts opens the picker. */
  onChoose: () => void
  /** Called with an edited length, after the user changes the spinner. */
  onLengthChange: (length: number) => void
  /** Called when the fast-scramble switch flips. */
  onFastScrambleChange: (fast: boolean) => void
}

export function createScrambleTypeControl(options: ScrambleTypeControlOptions) {
  const scrambleOptions = createScrambleOptions({
    initialType: options.initialType,
    onChange: options.onLengthChange,
    onFastScramble: options.onFastScrambleChange,
  })

  const widget = new Adw.SplitButton({
    // Icon-only, so the tooltip is the only thing that names the action —
    // without it the half would be indistinguishable from refresh/copy.
    // A two-pane grid, not the session manager's list: this half opens the
    // category/type picker, whose dialog is exactly those two panes.
    iconName: 'view-grid-symbolic',
    tooltipText: t('scramble.chooseType'),
    dropdownTooltip: t('scramble.options'),
    popover: scrambleOptions.popover,
    cssClasses: ['flat'],
  })
  widget.on('clicked', () => options.onChoose())

  /** Point the control at `type`: picker icon always, arrow when it has options. */
  const setType = (type: string): void => {
    scrambleOptions.setType(type)
    if (scrambleLength(type) > 0) {
      if (widget.getPopover() !== scrambleOptions.popover) {
        widget.setPopover(scrambleOptions.popover)
      }
      return
    }
    // Nothing to edit: close the popover before detaching it, or it would be
    // left mapped over a header whose arrow no longer opens it.
    scrambleOptions.popover.popdown()
    if (widget.getPopover() !== null) widget.setPopover(null)
  }

  setType(options.initialType)

  /** The control, and the way to follow the selected type. */
  return { widget, setType }
}
