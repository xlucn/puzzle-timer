/*
 * scrambleTypeButton.ts — the header's scramble-type selector.
 *
 * Icon-only: the "category - type" label lives in the header's centre as an
 * `Adw.WindowTitle` (src/ui/scrambleTypeTitle.ts), so this is just the way
 * in — one flat button, one dialog, no state of its own: there is nothing
 * type-specific left to display, hence no selectType either. Fixed width at
 * every window size, in the header and in the narrow layout's bottom toolbar
 * alike, so its *min* never competes for header room.
 *
 * Clicking opens the picker dialog — the same instance the narrow layout
 * uses, passed in by main.ts rather than built here, so there is one dialog
 * and one `onChange` path for every control that can choose a type.
 */
import Gtk from 'gi:Gtk-4.0'

/**
 * The gi:* shims export a value namespace only (AGENTS.md), so widget types
 * come through InstanceType — this module only builds its own widget and
 * hands it back, so the base types say enough.
 */
type Button = InstanceType<typeof Gtk.Button>

export interface ScrambleTypeButtonOptions {
  /** Called when the button is activated — main.ts points this at the picker. */
  onActivate: () => void
}

export function createScrambleTypeButton(options: ScrambleTypeButtonOptions) {
  // Icon-only, so the tooltip is the only thing that names the action —
  // without it the button would be indistinguishable from refresh/copy.
  const widget: Button = new Gtk.Button({
    iconName: 'view-list-symbolic',
    tooltipText: 'Choose the scramble type',
    cssClasses: ['flat'],
  })
  widget.on('clicked', () => options.onActivate())

  /** The button, and the way in — main.ts owns the header it sits in. */
  return { widget }
}
