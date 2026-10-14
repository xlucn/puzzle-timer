/*
 * scrambleTypeSelect.ts — a two-dropdown scramble-type selector.
 *
 * **UNHOOKED: nothing imports this any more.** The header uses one
 * icon button (src/ui/scrambleTypeButton.ts) plus the picker dialog instead.
 * This file is kept as a reference for the two-level Gtk.DropDown approach
 * and, more importantly, for the *search* gotcha below, which bites any
 * Gtk.DropDown holding strings.
 *
 * All 206 types cstimer_module offers sit behind two Gtk.DropDown widgets,
 * mirroring csTimer's own menu: csTimer's `scrdata` is a two-level table of
 * `[category, [[name, id, len]…]]`, so we offer level 1 (category: "WCA",
 * "3x3x3 CFOP", …) and level 2 (type inside that category: "PLL", "ZBLL", …).
 * A name only has to be unique inside its category, which several groups
 * exploit — see SCRAMBLE_GROUPS in src/core/scrambleTypes.ts.
 *
 * Both popups are searchable (`enableSearch` adds a search entry). GTK only
 * filters when DropDown:expression is set — see stringExpression.ts. Display
 * needs no expression: a plain Gtk.StringList labels itself (the Preferences
 * ComboRow relies on that and keeps row search off).
 */
import Gtk from 'gi:Gtk-4.0'

import { styles } from 'node-gtk/styles'

import { SCRAMBLE_GROUPS, groupOfScrambleType } from '../core/scrambleTypes.js'
import { makeStringExpression } from './stringExpression.js'

styles.add(`
  /* Long category names ("FTO (Face-Turning Octahedron)") must not push the
     header bar wider than the window; the popup still shows them in full. */
  .scramble-category-select {
    min-width: 128px;
  }
  .scramble-type-select {
    min-width: 132px;
  }
`)

function makeDropDown(labels: string[], cssClass: string) {
  const model = Gtk.StringList.new(labels)
  const dropDown: any = Gtk.DropDown.new(model, makeStringExpression())
  dropDown.setEnableSearch(true)
  // Labels are matched anywhere, not just at the front, so "roux" finds
  // "3x3x3 Roux". (GTK's default is PREFIX.)
  dropDown.setSearchMatchMode(Gtk.StringFilterMatchMode.SUBSTRING)
  dropDown.addCssClass(cssClass)
  return dropDown
}

export interface ScrambleTypeSelectOptions {
  /** Type the selectors open on; must be the feed's starting type. */
  initialType: string
  /** Called whenever the user picks a different type. */
  onChange: (id: string) => void
}

export function createScrambleTypeSelect(options: ScrambleTypeSelectOptions) {
  const groups = SCRAMBLE_GROUPS
  const initialGroup = groupOfScrambleType(options.initialType) ?? groups[0].name

  const category = makeDropDown(
    groups.map((group) => group.name),
    'scramble-category-select',
  )
  category.setTooltipText('Scramble category')

  // Level 2 starts out showing the initial group's types; showTypeGroup()
  // replaces it with the same list anyway, so pick the group first.
  let groupIndex = Math.max(
    0,
    groups.findIndex((group) => group.name === initialGroup),
  )
  const initialGroupChoices = groups[groupIndex].choices
  let typeIndex = Math.max(
    0,
    initialGroupChoices.findIndex((choice) => choice.id === options.initialType),
  )

  const type = makeDropDown(
    initialGroupChoices.map((choice) => choice.label),
    'scramble-type-select',
  )
  type.setTooltipText('Scramble type')

  let currentId = initialGroupChoices[typeIndex]?.id ?? options.initialType
  /** True while level 2's model is being swapped — see showTypeGroup(). */
  let swapping = false
  /** True while the dropdowns are moved by code (selectType), not by hand. */
  let programmatic = false
  category.selected = groupIndex
  type.selected = typeIndex

  /** Point level 2 at a category, keeping the type if it still applies. */
  const showTypeGroup = (index: number, announce: boolean) => {
    const choices = groups[index].choices
    // Swapping the model drops `selected` back to 0 and emits
    // notify::selected for an index the user never chose, so hold the type
    // handler off until the intended selection is back in place.
    swapping = true
    type.model = Gtk.StringList.new(choices.map((choice) => choice.label))
    type.selected = Math.max(
      0,
      choices.findIndex((choice) => choice.id === currentId),
    )
    swapping = false

    const id = choices[type.selected]?.id
    if (id === undefined) return
    const changed = id !== currentId
    currentId = id
    if (announce && changed) options.onChange(id)
  }

  category.on('notify::selected', () => {
    groupIndex = category.selected
    // A session switch moves the category by hand-following, not by the
    // user — see selectType(); announcing that would feed the new type
    // straight back into the session it came from.
    showTypeGroup(groupIndex, !programmatic)
  })

  // Connected after the initial selection so construction never reports a
  // change the feed did not ask for.
  type.on('notify::selected', () => {
    if (swapping) return
    const id = groups[groupIndex].choices[type.selected]?.id
    if (id !== undefined && id !== currentId) {
      currentId = id
      options.onChange(id)
    }
  })

  const box = Gtk.Box.new(Gtk.Orientation.HORIZONTAL, 6)
  box.append(category)
  box.append(type)

  /**
   * Point both dropdowns at `id` programmatically — used when a session
   * switch (or startup) restores the session's own type. Returns false when
   * `id` is not a known type (a hand-edited index), in which case nothing
   * moves and the caller should leave the feed alone too. Never announces
   * onChange: the caller already has the type, re-reporting it would write
   * the session's value back onto itself.
   */
  const selectType = (id: string): boolean => {
    if (id === currentId) return true
    const index = groups.findIndex((group) => group.choices.some((choice) => choice.id === id))
    if (index < 0) return false

    currentId = id
    programmatic = true
    if (category.selected !== index) {
      category.selected = index // notify → showTypeGroup(..., announce=false)
    } else {
      showTypeGroup(index, false) // same category: only level 2 needs moving
    }
    programmatic = false
    return true
  }

  return { widget: box, selectType }
}
