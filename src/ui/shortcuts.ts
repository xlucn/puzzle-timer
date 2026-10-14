/*
 * shortcuts.ts — the keyboard reference (M3, layout F; Adw.ShortcutsDialog
 * since 2026-10-02).
 *
 * An Adw.ShortcutsDialog listing the app's key bindings: Space on the timer
 * (and Escape to cancel an inspection, or to close the solve list when the
 * window is narrow enough for it to be a drawer), copy the scramble
 * (Ctrl+C), Delete and the penalty/comment keys
 * on the solve list (Ctrl+1/2/3, Ctrl+E), the session accelerators
 * (Ctrl+S / Ctrl+N / F2 / Ctrl+Delete), Statistics (Ctrl+T),
 * Preferences / Quit (Ctrl+, / Ctrl+Q), and this dialog itself (Ctrl+?,
 * user call 2026-10-11). It opens from the sidebar's app menu
 * ("Keyboard Shortcuts") or that accelerator.
 *
 * This replaces Gtk.ShortcutsWindow, deprecated since GTK 4.18 — libadwaita
 * gained the same idea in AdwShortcutsDialog (1.9, what this box ships):
 * sections of items, an item being a title plus an accelerator. The mapping
 * from the old structure is one to one: a Gtk.ShortcutsGroup (Timer, Solve
 * list, …) is a titled AdwShortcutsSection, a Gtk.ShortcutsShortcut is an
 * AdwShortcutsItem, and the old single-section-with-groups layout becomes a
 * list of sections — no tabs, since a dialog scrolls instead.
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
 * case-sensitive gdk_keyval rule below matters here as much as it did in the
 * window this replaced ("space", never "Space").
 */
export function createShortcutsDialog(): ShortcutsDialog {
  const dialog = new Adw.ShortcutsDialog({ title: 'Keyboard Shortcuts' })

  const section = (title: string, entries: Array<[string, string]>): void => {
    const group = Adw.ShortcutsSection.new(title)
    for (const [desc, accel] of entries) {
      group.add(new Adw.ShortcutsItem({ title: desc, accelerator: accel }))
    }
    dialog.add(group)
  }

  section('Timer', [
    // Key names are case-sensitive gdk_keyval names: "space", not "Space"
    // (an unparsable accelerator silently renders as an empty chip).
    ['Start a solve (hold, then release)', 'space'],
    ['Stop a running solve', 'space'],
    ['Cancel the inspection countdown', 'Escape'],
  ])
  section('Scramble', [
    // The scramble text is display-only (user call, 2026-10-02): not
    // selectable, so this is how the text gets out — beside refresh in the
    // header, or here.
    ['Copy the scramble', '<Ctrl>C'],
  ])
  section('Solve list', [
    // M6: in a narrow window the list is a drawer over the content;
    // Ctrl+B is the way in and out at any size (the split view's own
    // toggle button has no accelerator of its own), and Escape is the
    // drawer's way out — after anything else that wanted the key (the
    // inspection cancel above, an open popover) has had it.
    ['Show or hide the solve list', '<Ctrl>b'],
    ['Hide the solve list (when it is a drawer)', 'Escape'],
    ['Delete the selected solves', 'Delete'],
    ['Clear the penalty of the newest solve', '<Ctrl>1'],
    ['Give the newest solve +2', '<Ctrl>2'],
    ['Mark the newest solve DNF', '<Ctrl>3'],
    ['Edit the selected (or newest) solve — penalty, comment', '<Ctrl>E'],
  ])
  section('Sessions', [
    ['Open the session menu', '<Ctrl>S'],
    ['New session', '<Ctrl>N'],
    ['Rename the active session', 'F2'],
    ['Delete the active session', '<Ctrl>Delete'],
  ])
  section('Statistics', [
    ['Open the statistics dialog', '<Ctrl>T'],
  ])
  section('General', [
    // <Ctrl>question is the gdk keyval name for '?': a literal '?' does
    // not parse and would render an empty chip (the keyval rule above).
    ['Open the keyboard reference', '<Ctrl>question'],
    ['Open preferences', '<Ctrl>comma'],
    ['Quit', '<Ctrl>Q'],
  ])

  return dialog
}
