/*
 * scrambleTypeTitle.ts — the header's type display: category over type name.
 *
 * The two levels the selector used to print on one line now live in the
 * header's centre as an `Adw.WindowTitle` (user call, 2026-10-08): title =
 * category, subtitle = type. main.ts assigns it as the HeaderBar's
 * titleWidget once at construction and never moves it — the slot is the one
 * place a HeaderBar centres a widget natively, and leaving it alone means
 * the stale `HeaderBar:title-widget` trap (adw-header-bar.c: remove() clears
 * the bin but not the property) can never be stepped in.
 *
 * The widget's template labels ellipsize END (adw-window-title.ui), so a long
 * name degrades to an ellipsis instead of raising the header's minimum — the
 * same guarantee the button label gave, and why headerSlack in
 * src/core/layout.ts stays dead.
 *
 * `selectType` keeps the picker's contract exactly: silent (a session switch
 * must not write the session's own value back), idempotent, and false for an
 * id this catalogue does not have (a hand-edited session index), so the
 * caller leaves the feed alone too. An empty subtitle is hidden by the widget
 * itself (adw-window-title.c), which is how an unknown id ends up alone on
 * one line instead of showing a dangling separator.
 */
import Adw from 'gi:Adw-1'

import { SCRAMBLE_GROUPS, scrambleTypeTitle } from '../core/scrambleTypes.js'

/**
 * The gi:* shims export a value namespace only (AGENTS.md), so widget types
 * come through InstanceType — this module only builds its own widget and
 * hands it back, so the base types say enough.
 */
type Title = InstanceType<typeof Adw.WindowTitle>

export interface ScrambleTypeTitleOptions {
  /** Type to show at startup; must be the feed's starting type. */
  initialType: string
}

export function createScrambleTypeTitle(options: ScrambleTypeTitleOptions) {
  let currentId = options.initialType

  const first = scrambleTypeTitle(currentId)
  const widget: Title = new Adw.WindowTitle({ title: first.category, subtitle: first.name })

  /**
   * Point the title at `id` — same contract as the picker's selectType: the
   * caller decides whether the id was real from the return value, and this
   * widget never reports a choice back.
   */
  const selectType = (id: string): boolean => {
    if (id === currentId) return true
    const known = SCRAMBLE_GROUPS.some((group) => group.choices.some((choice) => choice.id === id))
    if (!known) return false
    currentId = id
    const { category, name } = scrambleTypeTitle(id)
    widget.title = category
    widget.subtitle = name
    return true
  }

  /** The title widget, and the way in — main.ts owns the header it sits in. */
  return { widget, selectType }
}
