/*
 * shortcuts.ts — the keyboard reference.
 *
 * An Adw.ShortcutsDialog listing the app's key bindings: Space on the timer
 * (and Escape to cancel an inspection, or to close the solve list when the
 * window is narrow enough for it to be a drawer), copy the scramble
 * (Ctrl+C), Delete and the penalty/comment keys
 * on the solve list (Ctrl+1/2/3, Ctrl+E), the session accelerators
 * (Ctrl+S / Ctrl+N / F2 / Ctrl+Delete), Statistics (Ctrl+T),
 * Preferences / Fullscreen / Quit (Ctrl+, / F11 / Ctrl+Q), and this dialog
 * itself (Ctrl+?).
 * It opens from the header's app menu ("Keyboard Shortcuts") or that
 * accelerator.
 *
 * Adw.ShortcutsDialog (libadwaita 1.9) is the successor to
 * Gtk.ShortcutsWindow (deprecated since GTK 4.18): sections of items, an
 * item being a title plus an accelerator.
 *
 * Built fresh on every open, like Preferences: an AdwDialog is gone when it
 * closes, so there is nothing to keep hold of. If node-gtk ever fails around
 * it, only this menu item is lost, not the startup path — construction stays
 * inside the action.
 *
 * Keep this in sync with the accelerators in src/main.ts (setAccelsForAction)
 * and the timer/delete key handling in the same file.
 */
import Adw from 'gi:Adw-1'

import { t } from '../core/i18n.js'

/**
 * The `gi:*` shims export a *value* namespace only (AGENTS.md), so widget
 * types come from InstanceType.
 */
export type ShortcutsDialog = InstanceType<typeof Adw.ShortcutsDialog>

/**
 * Build (but do not present) the keyboard reference. One section per area of
 * the app; accelerator strings are GTK's parseable form and are displayed by
 * Adw.ShortcutLabel itself (e.g. `<Ctrl>S` renders as "Ctrl+S").
 *
 * A typo in one is still silent: the chip renders *empty*, so the
 * case-sensitive gdk_keyval rule below matters here ("space", never
 * "Space").
 */
export function createShortcutsDialog(): ShortcutsDialog {
  const dialog = new Adw.ShortcutsDialog({ title: t('shortcuts.title') })

  const section = (title: string, entries: Array<[string, string]>): void => {
    const group = Adw.ShortcutsSection.new(title)
    for (const [desc, accel] of entries) {
      group.add(new Adw.ShortcutsItem({ title: desc, accelerator: accel }))
    }
    dialog.add(group)
  }

  section(t('shortcuts.group.timer'), [
    // Key names are case-sensitive gdk_keyval names: "space", not "Space"
    // (an unparsable accelerator silently renders as an empty chip).
    [t('shortcuts.startStop'), 'space'],
    [t('shortcuts.cancelInspection'), 'Escape'],
  ])
  section(t('shortcuts.group.scramble'), [
    // The scramble text is display-only (not selectable), so this is how the
    // text gets out — beside refresh in the header, or here.
    [t('shortcuts.copyScramble'), '<Ctrl>C'],
  ])
  section(t('shortcuts.group.list'), [
    // In a narrow window the list is a drawer over the content; Ctrl+B is
    // the way in and out at any size (the split view's own toggle button has
    // no accelerator of its own), and Escape is the drawer's way out — after
    // anything else that wanted the key (the inspection cancel above, an open
    // popover) has had it.
    [t('shortcuts.sidebar'), '<Ctrl>b'],
    [t('shortcuts.hideDrawer'), 'Escape'],
    [t('shortcuts.deleteSolves'), 'Delete'],
    [t('shortcuts.clearPenalty'), '<Ctrl>1'],
    [t('shortcuts.plus2'), '<Ctrl>2'],
    [t('shortcuts.dnf'), '<Ctrl>3'],
    [t('shortcuts.editSolve'), '<Ctrl>E'],
  ])
  section(t('shortcuts.group.sessions'), [
    [t('shortcuts.sessionMenu'), '<Ctrl>S'],
    [t('shortcuts.newSession'), '<Ctrl>N'],
    [t('shortcuts.renameSession'), 'F2'],
    [t('shortcuts.deleteSession'), '<Ctrl>Delete'],
  ])
  section(t('stats.title'), [
    [t('shortcuts.statistics'), '<Ctrl>T'],
  ])
  section(t('shortcuts.group.general'), [
    // <Ctrl>question is the gdk keyval name for '?': a literal '?' does
    // not parse and would render an empty chip (the keyval rule above).
    [t('shortcuts.keyboard'), '<Ctrl>question'],
    [t('shortcuts.preferences'), '<Ctrl>comma'],
    [t('shortcuts.fullscreen'), 'F11'],
    [t('shortcuts.quit'), '<Ctrl>Q'],
  ])

  return dialog
}
