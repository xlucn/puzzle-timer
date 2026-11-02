/*
 * stringExpression.ts — the GtkExpression that makes GTK's string widgets
 * read a Gtk.StringList's labels.
 *
 * Needed by anything that *searches* a string list: GTK builds the string
 * filter from the expression, so without one `setEnableSearch(true)` on a
 * Gtk.DropDown is a silent no-op (gtk/gtkdropdown.c installs GtkEveryFilter
 * instead of GtkStringFilter). Displaying labels needs no expression — a
 * plain Gtk.StringList renders them on its own (see ui/preferences.ts), and
 * tools/prefs_probe.mjs asserts that against the running dialog.
 *
 * node-gtk cannot set the `expression` *property* (its GValue converter has
 * no case for the GtkExpression fundamental type and aborts with "Unhandled
 * GValue type: GtkExpression"), so pass it to a constructor or factory — or
 * call setExpression() with a positional argument, which is marshalled by a
 * different path. Search also defaults to matching at the front, so
 * setSearchMatchMode(SUBSTRING) is what makes "roux" find "3x3x3 Roux".
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
