/*
 * stringExpression.ts — the GtkExpression that makes GTK's string widgets
 * read a GtkStringList's labels.
 *
 * The preferences ComboRow holds a Gtk.StringList whose items are
 * GtkStringObject. (The header's type *button* needs no expression — it draws
 * one label itself — but scrambleTypeSelect.ts, now unhooked, was a Gtk.DropDown
 * and hit the first gotcha below; it is still worth knowing for any DropDown
 * holding strings.) GTK only binds a default label factory when the widget has
 * an expression pointing at `GtkStringObject:string`:
 *
 *   - DropDown: without it, `setEnableSearch(true)` is a silent no-op
 *     (gtk/gtkdropdown.c installs GtkEveryFilter instead of GtkStringFilter);
 *   - ComboRow: without it, the default factory has nothing to show.
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
