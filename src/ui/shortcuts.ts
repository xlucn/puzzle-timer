/*
 * shortcuts.ts — the keyboard reference (M3, layout F).
 *
 * A Gtk.ShortcutsWindow listing the app's key bindings: Space on the timer
 * (and Escape to cancel an inspection), Delete and the penalty/comment keys
 * on the solve list (Ctrl+1/2/3, Ctrl+E), the session accelerators
 * (Ctrl+S / Ctrl+N / F2 / Ctrl+Delete), Statistics (Ctrl+T), and
 * Preferences / Quit (Ctrl+, / Ctrl+Q). It opens from
 * the sidebar's app menu ("Keyboard Shortcuts") — no accelerator of its own,
 * the window *is* the accelerator documentation.
 *
 * Gtk.ShortcutsWindow is deprecated as of GTK 4.18 but still the only stock
 * widget for this (libadwaita ships no replacement); it renders fine on GTK
 * 4.22. If node-gtk misbehaves on it (open segfaults around widget
 * construction are the usual failure mode here), fall back to listing the
 * keys in the About dialog's body — see AGENTS.md.
 *
 * Structure: window → section → group → shortcut. Sections become tabs when
 * there is more than one; we use a single section with one group per area.
 *
 * Keep this in sync with the accelerators in src/main.ts (setAccelsForAction)
 * and the timer/delete key handling in the same file.
 */
import Gtk from 'gi:Gtk-4.0'

type AppWindow = InstanceType<typeof Gtk.ApplicationWindow>
export type ShortcutsWindow = InstanceType<typeof Gtk.ShortcutsWindow>

/**
 * Build (but do not present) the shortcuts window. One group per area of the
 * app; accelerator strings are GTK's parseable form and are displayed by the
 * widget itself (e.g. `<Ctrl>S` renders as "Ctrl+S").
 */
export function createShortcutsWindow(transientFor: AppWindow): ShortcutsWindow {
  const win = new Gtk.ShortcutsWindow({
    transientFor,
    modal: true,
    destroyWithParent: true,
    hideOnClose: true,
    title: 'Keyboard Shortcuts',
  })

  const section = new Gtk.ShortcutsSection({
    title: 'General',
    name: 'general',
  })

  const group = (title: string, entries: Array<[string, string]>): void => {
    const g = new Gtk.ShortcutsGroup({ title })
    for (const [desc, accel] of entries) {
      g.append(new Gtk.ShortcutsShortcut({ title: desc, accelerator: accel }))
    }
    section.addGroup(g)
  }

  group('Timer', [
    // Key names are case-sensitive gdk_keyval names: "space", not "Space"
    // (an unparsable accelerator silently renders as an empty chip).
    ['Start a solve (hold, then release)', 'space'],
    ['Stop a running solve', 'space'],
    ['Cancel the inspection countdown', 'Escape'],
  ])
  group('Solve list', [
    ['Delete the selected solves', 'Delete'],
    ['Clear the penalty of the newest solve', '<Ctrl>1'],
    ['Give the newest solve +2', '<Ctrl>2'],
    ['Mark the newest solve DNF', '<Ctrl>3'],
    ['Edit the selected (or newest) solve — penalty, comment', '<Ctrl>E'],
  ])
  group('Sessions', [
    ['Open the session menu', '<Ctrl>S'],
    ['New session', '<Ctrl>N'],
    ['Rename the active session', 'F2'],
    ['Delete the active session', '<Ctrl>Delete'],
  ])
  group('Statistics', [
    ['Open the statistics dialog', '<Ctrl>T'],
  ])
  group('General', [
    ['Open preferences', '<Ctrl>comma'],
    ['Quit', '<Ctrl>Q'],
  ])

  win.addSection(section)
  return win
}
