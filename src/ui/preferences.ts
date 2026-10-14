/*
 * preferences.ts — the Preferences dialog.
 *
 * An Adw.PreferencesDialog (libadwaita's stock settings UI: pages → groups →
 * rows) built fresh every time it opens, reading the *current* preferences
 * through `get` and reporting every change as a patch through `set`. The
 * caller (main.ts) owns the single Preferences object: it persists the patch
 * and pushes the new value into whatever the setting drives (timer, action
 * state, theming), so the dialog never becomes a second source of truth.
 *
 * Rows are the stock Adw ones — Adw.SpinRow for the hold threshold (a real
 * SpinButton inside an action row), Adw.SwitchRow for the flags, Adw.ComboRow
 * for the theme. Every row announces on `notify::…`; the dialog is modal, so
 * nothing outside can move a value under it and there is no echo to guard
 * against.
 *
 * The label units: the hold threshold is stored in milliseconds (the timer's
 * unit) but shown in seconds, because "0.30 s" is how csTimer's own
 * "time of keeping space down" reads and what a cuber expects.
 */
import Adw from 'gi:Adw-1'
import Gio from 'gi:Gio-2.0'
import Gtk from 'gi:Gtk-4.0'

import {
  HOLD_THRESHOLD_STEP_MS,
  MAX_HOLD_THRESHOLD_MS,
  MIN_HOLD_THRESHOLD_MS,
  type ColorScheme,
  type Preferences,
} from '../core/preferences.js'

/*
 * The `gi:*` shims export a *value* namespace only (AGENTS.md), so widget
 * types come from InstanceType.
 */
type Application = InstanceType<typeof Adw.Application>
type Window = InstanceType<typeof Adw.ApplicationWindow>

export interface PreferencesPanelOptions {
  /** The application the `app.preferences` action is registered on. */
  app: Application
  /** Toplevel the dialog is presented on. */
  window: Window
  /** Current preferences — read fresh every time the dialog opens. */
  get: () => Preferences
  /**
   * Apply one change. The caller merges the patch, persists it and pushes it
   * into the running app (timer threshold, action state, theming, …).
   */
  set: (patch: Partial<Preferences>) => void
}

/** The colour-scheme choices, in the order the ComboRow lists them. */
const COLOR_SCHEME_CHOICES: { id: ColorScheme; label: string }[] = [
  { id: 'system', label: 'Follow system' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

export function createPreferences(options: PreferencesPanelOptions) {
  const open = (): InstanceType<typeof Adw.PreferencesDialog> => {
    const prefs = options.get()
    const dialog = new Adw.PreferencesDialog({ title: 'Preferences', searchEnabled: false })

    // ---- page: timer ------------------------------------------------------
    const timerPage = new Adw.PreferencesPage({
      title: 'Timer',
      iconName: 'preferences-system-time-symbolic',
    })
    const timerGroup = new Adw.PreferencesGroup({ title: 'Starting a solve' })

    // Hold threshold, in seconds (stored as ms — see the file header). The
    // value arrives as 0.05 s steps or whatever the user types; rounding to
    // whole milliseconds is the storage contract, not a display concern.
    const holdRow = new Adw.SpinRow({
      title: 'Hold time',
      subtitle: 'How long Space must be held before the timer arms',
      digits: 2,
      numeric: true, // the entry takes digits only — no "1e3" nonsense
      adjustment: new Gtk.Adjustment({
        lower: MIN_HOLD_THRESHOLD_MS / 1000,
        upper: MAX_HOLD_THRESHOLD_MS / 1000,
        stepIncrement: HOLD_THRESHOLD_STEP_MS / 1000,
        value: prefs.holdThresholdMs / 1000,
      }),
    })
    holdRow.on('notify::value', () => {
      options.set({ holdThresholdMs: Math.round(holdRow.value * 1000) })
    })
    timerGroup.add(holdRow)

    const inspectionRow = new Adw.SwitchRow({
      title: 'WCA inspection',
      subtitle: 'Count down from 15 s before the solve starts',
      active: prefs.inspection,
    })
    inspectionRow.on('notify::active', () => {
      options.set({ inspection: inspectionRow.active })
    })
    timerGroup.add(inspectionRow)

    const cuesRow = new Adw.SwitchRow({
      title: 'Inspection sound cues',
      subtitle: 'One beep at 8 s, two at 12 s',
      active: prefs.inspectionSound,
    })
    cuesRow.on('notify::active', () => {
      options.set({ inspectionSound: cuesRow.active })
    })
    timerGroup.add(cuesRow)

    timerPage.add(timerGroup)
    dialog.add(timerPage)

    // ---- page: appearance ------------------------------------------------
    // libadwaita's StyleManager is application-wide, so choosing here
    // repaints every window at once — including this one.
    const appearancePage = new Adw.PreferencesPage({
      title: 'Appearance',
      iconName: 'preferences-desktop-appearance-symbolic',
    })
    const appearanceGroup = new Adw.PreferencesGroup({ title: 'Colour scheme' })

    const schemeRow = new Adw.ComboRow({
      title: 'Theme',
      model: Gtk.StringList.new(COLOR_SCHEME_CHOICES.map((choice) => choice.label)),
    })
    // No GtkExpression: a plain Gtk.StringList labels itself — measured
    // side by side with and without on GTK 4.22.5 / libadwaita 1.9.4;
    // tools/prefs_probe.mjs asserts the label renders, so a libadwaita that
    // stops doing this fails the probe rather than showing an empty row. The
    // docs still name AdwComboRow:expression as the default factory's
    // binding mechanism, and *search* needs it too, so if this row ever gets
    // enableSearch, hand setExpression(makeStringExpression()) back to it —
    // positional/setter, never the `expression` *property* (that path
    // aborts node-gtk; stringExpression.ts).
    schemeRow.selected = Math.max(
      0,
      COLOR_SCHEME_CHOICES.findIndex((choice) => choice.id === prefs.colorScheme),
    )
    schemeRow.on('notify::selected', () => {
      const choice = COLOR_SCHEME_CHOICES[schemeRow.selected]
      if (choice !== undefined) options.set({ colorScheme: choice.id })
    })
    appearanceGroup.add(schemeRow)

    appearancePage.add(appearanceGroup)
    dialog.add(appearancePage)

    // ---- page: scramble --------------------------------------------------
    const scramblePage = new Adw.PreferencesPage({
      title: 'Scramble',
      iconName: 'image-x-generic-symbolic',
    })
    const scrambleGroup = new Adw.PreferencesGroup({
      title: 'Diagram',
      description:
        'A picture of the scramble when its type has one — 177 of the 206 types do. ' +
        'It is generated with the scramble, so switching this never changes the scramble itself.',
    })

    const imageRow = new Adw.SwitchRow({
      title: 'Show the scramble image',
      active: prefs.scrambleImage,
    })
    imageRow.on('notify::active', () => {
      options.set({ scrambleImage: imageRow.active })
    })
    scrambleGroup.add(imageRow)

    scramblePage.add(scrambleGroup)
    dialog.add(scramblePage)

    dialog.present(options.window)
    return dialog
  }

  const action = Gio.SimpleAction.new('preferences', null)
  action.on('activate', () => open())
  options.app.addAction(action)

  return { open }
}
