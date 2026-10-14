/*
 * statsStrip.ts — the ao5/ao12 label strip under the timer readout.
 *
 * Component module (see timerLabel.ts): the top level only registers styles
 * and defines exports, so `styles.add()` hot-reloads the CSS below under
 * `npm run dev`.
 *
 * Two cells, `ao5` and `ao12` — no PB, no target here; those live in the
 * Statistics dialog behind the app menu. Values are the *current* window
 * averages, computed by src/core/stats.ts on the effective (penalised)
 * times, so a +2 or DNF in the last five solves shows up here immediately.
 * An incomplete window — fewer solves than the average needs — is an em
 * dash, never a partial average: a 3-solve "ao5" would lie about what it is.
 *
 * The strip follows the session the same way the solve list does
 * (src/ui/timesList.ts): subscribe to the live Session, and re-point on a
 * library switch.
 */
import Gtk from 'gi:Gtk-4.0'

import { styles } from 'node-gtk/styles'

import type { Session, Unsubscribe } from '../core/session.js'
import type { SessionLibrary } from '../core/sessionLibrary.js'
import { currentWindow } from '../core/stats.js'
import { effectiveMs, formatAverage } from '../core/time.js'

// Dimming goes through alpha(@window_fg_color): GTK3's @dim_label does not
// exist in GTK4 (see the risk table in PLAN.md). Tabular figures keep the
// digits from jittering as the average changes width.
styles.add(`
  /* Small secondary text comes from the built-in 'caption' (82% size) and
     'dim-label' (55% opacity) classes on the labels — no rules of ours. */
  .stats-value {
    font-weight: 600;
    /* Tabular figures from the built-in 'numeric' class; the weight stays a
       rule because no Adwaita class is exactly semibold. */
  }
  .stats-value.incomplete {
    font-weight: 400;
    color: alpha(@window_fg_color, 0.4);
  }
`)

export interface StatsStripOptions {
  /** Whose session is on show: the strip follows the active one. */
  library: SessionLibrary
  /**
   * The session to read. Called live — not captured once — because a switch
   * hands the strip a different Session with different solves.
   */
  getSession: () => Session
}

export function createStatsStrip(options: StatsStripOptions) {
  const cell = () => {
    // Built-ins: caption = 82% size + 400 weight, dim-label = 55% dim —
    // close cousins of the 13px dim rule this replaces, but they track the
    // user's font and contrast preferences instead of fighting them.
    const kind = new Gtk.Label({ cssClasses: ['caption', 'dim-label'] })
    const value = new Gtk.Label({ cssClasses: ['stats-value', 'numeric'] })
    const box = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6 })
    box.append(kind)
    box.append(value)
    return { kind, value, box }
  }

  const ao5 = cell()
  ao5.kind.setLabel('ao5')
  const ao12 = cell()
  ao12.kind.setLabel('ao12')

  const widget = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 28,
    halign: Gtk.Align.CENTER,
  })
  widget.append(ao5.box)
  widget.append(ao12.box)

  /** The last `size` solves as scored times — all the window needs. */
  const lastTimes = (session: Session, size: number): number[] => {
    const solves = session.solves
    const from = Math.max(0, solves.length - size)
    const times: number[] = []
    for (let i = from; i < solves.length; i++) {
      times.push(effectiveMs(solves[i].timeMs, solves[i].penalty))
    }
    return times
  }

  // A `Gtk.Label` type annotation is not possible (the gi:* shims export a
  // value namespace only — AGENTS.md), so the parameter type is inferred.
  const paint = (target: ReturnType<typeof cell>, average: number) => {
    const incomplete = Number.isNaN(average)
    target.value.setLabel(incomplete ? '—' : formatAverage(average))
    target.value.setCssClasses(
      incomplete ? ['stats-value', 'incomplete'] : ['stats-value', 'numeric'],
    )
  }

  const refresh = () => {
    const session = options.getSession()
    paint(ao5, currentWindow(lastTimes(session, 5), 'ao5'))
    paint(ao12, currentWindow(lastTimes(session, 12), 'ao12'))
  }

  // ---- follow the session (same re-point pattern as timesList.ts) --------
  let current = options.getSession()
  let unsubscribe: Unsubscribe = current.subscribe(refresh)
  options.library.subscribe(() => {
    const next = options.getSession()
    if (next !== current) {
      unsubscribe()
      current = next
      unsubscribe = current.subscribe(refresh)
    }
    refresh()
  })
  refresh()

  return { widget, refresh }
}
