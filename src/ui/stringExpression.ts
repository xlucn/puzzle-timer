/*
 * stringExpression.ts — the GtkExpression that makes GTK's string widgets
 * read a Gtk.StringList's labels.
 *
 * Still needed by anything that *searches* a string list: GTK builds the
 * string filter from the expression, so without one `setEnableSearch(true)`
 * on a Gtk.DropDown is a silent no-op (gtk/gtkdropdown.c installs
 * GtkEveryFilter instead of GtkStringFilter). Its two users are
 * tools/shrink_demo.mjs (options A/A2) and the unhooked reference
 * scrambleTypeSelect.ts.
 *
 * The Preferences ComboRow dropped it 2026-10-06: a plain Gtk.StringList
 * renders its selected label and its popover items with *no* expression —
 * measured side by side, with and without, on GTK 4.22.5 / libadwaita 1.9.4
 * (the docs still describe expression as the default factory's mechanism, so
 * tools/prefs_probe.mjs now asserts the label actually appears; if that
 * assertion ever fails, restore setExpression() in ui/preferences.ts). That
 * row keeps search off, so it has no use for this module.
 *
 * node-gtk cannot set the `expression` *property* (its GValue converter has
 * no case for the GtkExpression fundamental type and aborts) — pass it to a
 * constructor/factory, or call setExpression() with a positional argument:
 * arguments are marshalled by a different path. See the full note in
 * scrambleTypeSelect.ts (decision 10 in PLAN.md §4).
 */
import GObject from 'gi:GObject-2.0'
import Gtk from 'gi:Gtk-4.0'

export function makeStringExpression(): any {
  return Gtk.PropertyExpression.new(
    GObject.typeFromName('GtkStringObject') as any,
    null,
    'string',
  )
}
