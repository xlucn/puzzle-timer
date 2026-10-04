/*
 * scrambleTypeButton.ts — the header's scramble-type selector.
 *
 * One button, one label, one dialog (user call, 2026-10-04). This replaces the
 * two Gtk.DropDowns of scrambleTypeSelect.ts — category and type in one line
 * reading `Category - type`, which is the same string the narrow layout's
 * Adw.ButtonRow shows (src/ui/scrambleTypePicker.ts), so the header and the
 * bottom row are two views of one decision.
 *
 * The label **ellipsizes and is never capped**: `Pango.EllipsizeMode.END` with
 * no `maxWidthChars`. That distinction is the whole reason this widget exists
 * — a capped label would put a ceiling on the header's demand, and an
 * uncapped-but-unshrinkable one (what the dropdowns were: `ellipsize` unset,
 * so min === natural) forces Gtk.HeaderBar to keep its natural width and push
 * the window controls off the right edge. Ellipsizing alone leaves *min* small,
 * so the header absorbs whatever room it is given and the text degrades to an
 * ellipsis instead of an overflow. With that, layoutFor no longer needs its
 * label-driven escape hatch (`headerSlack` — removed the same day).
 *
 * Clicking opens the picker dialog — the same instance the narrow layout uses,
 * passed in by main.ts rather than built here, so there is one dialog and one
 * `onChange` path for both controls.
 *
 * `selectType` matches scrambleTypePicker's contract exactly: silent (never
 * announces the choice back, so a session switch cannot write the session's
 * own value onto itself), idempotent, and false for an id this catalogue does
 * not have — a hand-edited session index — so the caller leaves the feed
 * alone.
 */
import Gtk from 'gi:Gtk-4.0'
import Pango from 'gi:Pango-1.0'

import { SCRAMBLE_GROUPS, scrambleTypeLabel } from '../core/scrambleTypes.js'

/**
 * The gi:* shims export a value namespace only (AGENTS.md), so widget types
 * come through InstanceType — this module only builds its own widget and
 * hands it back, so the base types say enough.
 */
type Button = InstanceType<typeof Gtk.Button>

export interface ScrambleTypeButtonOptions {
  /** Type to show at startup; must be the feed's starting type. */
  initialType: string
  /** Called when the button is activated — main.ts points this at the picker. */
  onActivate: () => void
}

export function createScrambleTypeButton(options: ScrambleTypeButtonOptions) {
  let currentId = options.initialType

  /**
   * The current type *is* the label: an icon alone would say "a chooser is
   * here" but not "you are solving FTO - Diamond". Left-aligned so long names
   * ellipsize at the right edge, where the chevron says there is a list
   * behind it.
   */
  const label = new Gtk.Label({
    label: scrambleTypeLabel(currentId),
    ellipsize: Pango.EllipsizeMode.END,
    xalign: 0,
  })
  const chevron = new Gtk.Image({ iconName: 'pan-down-symbolic' })

  const box = Gtk.Box.new(Gtk.Orientation.HORIZONTAL, 6)
  box.append(label)
  box.append(chevron)

  const button: Button = new Gtk.Button({
    child: box,
    tooltipText: 'Choose the scramble type',
    cssClasses: ['flat'],
  })
  button.on('clicked', () => options.onActivate())

  /**
   * Point the button at `id` — same contract as the picker's selectType: the
   * caller decides whether the id was real from the return value, and this
   * widget never reports a choice back.
   */
  const selectType = (id: string): boolean => {
    if (id === currentId) return true
    const known = SCRAMBLE_GROUPS.some((group) => group.choices.some((choice) => choice.id === id))
    if (!known) return false
    currentId = id
    label.label = scrambleTypeLabel(id)
    return true
  }

  /** The button, and the way in — main.ts owns the header it sits in. */
  return { widget: button, selectType }
}
