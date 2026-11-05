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
 * Rows are the stock Adw ones — Adw.SpinRow for the hold threshold and the
 * three size scales (a real SpinButton inside an action row), Adw.SwitchRow
 * for the flags, Adw.ComboRow for the theme. Every row announces on
 * `notify::…`; the dialog is modal, so nothing outside can move a value under
 * it and there is no echo to guard against.
 *
 * The label units: the hold threshold is stored in milliseconds (the timer's
 * unit) but shown in seconds, because "0.30 s" is how csTimer's own
 * "time of keeping space down" reads and what a cuber expects.
 */
import Adw from 'gi:Adw-1'
import Gio from 'gi:Gio-2.0'
import Gtk from 'gi:Gtk-4.0'

import { t, type Language } from '../core/i18n.js'
import {
  HOLD_THRESHOLD_STEP_MS,
  MAX_HOLD_THRESHOLD_MS,
  MAX_SIZE_SCALE,
  MIN_DIAGRAM_SCALE,
  MIN_HOLD_THRESHOLD_MS,
  MIN_SIZE_SCALE,
  SIZE_SCALE_STEP,
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

type ColorSchemeKey = 'prefs.theme.system' | 'prefs.theme.light' | 'prefs.theme.dark'

/** The colour-scheme choices, in the order the ComboRow lists them. */
const COLOR_SCHEME_CHOICES: { id: ColorScheme; key: ColorSchemeKey }[] = [
  { id: 'system', key: 'prefs.theme.system' },
  { id: 'light', key: 'prefs.theme.light' },
  { id: 'dark', key: 'prefs.theme.dark' },
]

type LanguageKey =
  | 'prefs.language.system'
  | 'prefs.language.english'
  | 'prefs.language.chinese'

/** The language choices, in the order the ComboRow lists them. */
const LANGUAGE_CHOICES: { id: Language; key: LanguageKey }[] = [
  { id: 'system', key: 'prefs.language.system' },
  { id: 'en', key: 'prefs.language.english' },
  { id: 'zh-CN', key: 'prefs.language.chinese' },
]

export function createPreferences(options: PreferencesPanelOptions) {
  const open = (): InstanceType<typeof Adw.PreferencesDialog> => {
    const prefs = options.get()
    const dialog = new Adw.PreferencesDialog({ title: t('prefs.title'), searchEnabled: false })

    // ---- page: timer ------------------------------------------------------
    const timerPage = new Adw.PreferencesPage({
      title: t('prefs.timer.title'),
      iconName: 'preferences-system-time-symbolic',
    })
    const timerGroup = new Adw.PreferencesGroup({ title: t('prefs.timer.group') })

    // Inspection first: it decides what the two starting gestures below
    // lead into.
    const inspectionRow = new Adw.SwitchRow({
      title: t('prefs.inspection'),
      subtitle: t('prefs.inspection.subtitle'),
      active: prefs.inspection,
    })
    inspectionRow.on('notify::active', () => {
      options.set({ inspection: inspectionRow.active })
    })
    timerGroup.add(inspectionRow)

    const cuesRow = new Adw.SwitchRow({
      title: t('prefs.cues'),
      subtitle: t('prefs.cues.subtitle'),
      active: prefs.inspectionSound,
    })
    cuesRow.on('notify::active', () => {
      options.set({ inspectionSound: cuesRow.active })
    })
    timerGroup.add(cuesRow)

    // Hold threshold, in seconds (stored as ms — see the file header). The
    // value arrives as 0.05 s steps or whatever the user types; rounding to
    // whole milliseconds is the storage contract, not a display concern.
    const holdRow = new Adw.SpinRow({
      title: t('prefs.hold'),
      subtitle: t('prefs.hold.subtitle'),
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

    const mouseRow = new Adw.SwitchRow({
      title: t('prefs.mouse'),
      subtitle: t('prefs.mouse.subtitle'),
      active: prefs.mouseStart,
    })
    mouseRow.on('notify::active', () => {
      options.set({ mouseStart: mouseRow.active })
    })
    timerGroup.add(mouseRow)

    timerPage.add(timerGroup)
    dialog.add(timerPage)

    // ---- page: appearance ------------------------------------------------
    // libadwaita's StyleManager is application-wide, so choosing here
    // repaints every window at once — including this one.
    const appearancePage = new Adw.PreferencesPage({
      title: t('prefs.appearance.title'),
      iconName: 'preferences-desktop-appearance-symbolic',
    })
    const appearanceGroup = new Adw.PreferencesGroup({ title: t('prefs.scheme.group') })

    const schemeRow = new Adw.ComboRow({
      title: t('prefs.theme'),
      model: Gtk.StringList.new(COLOR_SCHEME_CHOICES.map((choice) => t(choice.key))),
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

    // ---- group: sizes -----------------------------------------------------
    // The multipliers the adaptive layout applies to its own sizes
    // (src/core/layout.ts) — the curve still decides the size, these only say
    // how much of it is shown.
    const sizesGroup = new Adw.PreferencesGroup({
      title: t('prefs.sizes.group'),
      description: t('prefs.sizes.description'),
    })

    const scaleRow = (row: {
      title: string
      subtitle: string
      value: number
      min: number
      onChange: (value: number) => void
    }): void => {
      const spin = new Adw.SpinRow({
        title: row.title,
        subtitle: row.subtitle,
        digits: 2,
        numeric: true,
        adjustment: new Gtk.Adjustment({
          lower: row.min,
          upper: MAX_SIZE_SCALE,
          stepIncrement: SIZE_SCALE_STEP,
          value: row.value,
        }),
      })
      spin.on('notify::value', () => {
        // Two decimals is the storage contract: a step of 0.05 must not be
        // stored as 1.0500000000000003.
        row.onChange(Math.round(spin.value * 100) / 100)
      })
      sizesGroup.add(spin)
    }

    scaleRow({
      title: t('prefs.size.timer'),
      subtitle: t('prefs.size.timer.subtitle'),
      value: prefs.timerScale,
      min: MIN_SIZE_SCALE,
      onChange: (timerScale) => options.set({ timerScale }),
    })
    scaleRow({
      title: t('prefs.size.scramble'),
      subtitle: t('prefs.size.scramble.subtitle'),
      value: prefs.scrambleScale,
      min: MIN_SIZE_SCALE,
      onChange: (scrambleScale) => options.set({ scrambleScale }),
    })
    scaleRow({
      title: t('prefs.size.diagram'),
      subtitle: t('prefs.size.diagram.subtitle'),
      value: prefs.diagramScale,
      min: MIN_DIAGRAM_SCALE,
      onChange: (diagramScale) => options.set({ diagramScale }),
    })

    appearancePage.add(sizesGroup)

    // ---- group: language --------------------------------------------------
    // The change is persisted like any other, but catalogs are read while
    // widgets are built: only a restart re-labels the window (main.ts toasts
    // that reminder). Offering it here, not on its own page, keeps the
    // Appearance page's "how it looks" grouping intact.
    const languageGroup = new Adw.PreferencesGroup({
      title: t('prefs.language.group'),
      description: t('prefs.language.restart'),
    })
    const languageRow = new Adw.ComboRow({
      title: t('prefs.language.row'),
      model: Gtk.StringList.new(LANGUAGE_CHOICES.map((choice) => t(choice.key))),
    })
    languageRow.selected = Math.max(
      0,
      LANGUAGE_CHOICES.findIndex((choice) => choice.id === prefs.language),
    )
    languageRow.on('notify::selected', () => {
      const choice = LANGUAGE_CHOICES[languageRow.selected]
      if (choice !== undefined) options.set({ language: choice.id })
    })
    languageGroup.add(languageRow)
    appearancePage.add(languageGroup)

    dialog.add(appearancePage)

    // ---- page: scramble --------------------------------------------------
    const scramblePage = new Adw.PreferencesPage({
      title: t('prefs.page.scramble'),
      iconName: 'image-x-generic-symbolic',
    })

    // One value for every type: it is csTimer's `preScr`, which the module
    // applies when it draws the diagram. Committed on Enter, on the apply
    // button (the touch path) or when the dialog closes.
    const preScrambleGroup = new Adw.PreferencesGroup({
      title: t('prefs.preScramble.group'),
      description: t('prefs.preScramble.description'),
    })
    const preScrambleRow = new Adw.EntryRow({
      title: t('prefs.preScramble.row'),
      text: prefs.preScramble,
      showApplyButton: true,
    })
    const commitPreScramble = (): void => {
      const text = (preScrambleRow.text ?? '').trim()
      if (text === options.get().preScramble) return
      preScrambleRow.text = text
      options.set({ preScramble: text })
    }
    preScrambleRow.on('apply', commitPreScramble)
    preScrambleRow.on('entry-activated', commitPreScramble)
    dialog.on('closed', commitPreScramble)
    preScrambleGroup.add(preScrambleRow)
    scramblePage.add(preScrambleGroup)

    const scrambleGroup = new Adw.PreferencesGroup({
      title: t('prefs.image.group'),
      description: t('prefs.image.description'),
    })

    const imageRow = new Adw.SwitchRow({
      title: t('prefs.image.row'),
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
