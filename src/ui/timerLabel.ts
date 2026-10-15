/*
 * timerLabel.ts — the big timer readout plus its hint line.
 *
 * Component module: its top level only registers styles and defines exports,
 * so `styles.add()` hot-reloads the CSS below under `npm run dev` without
 * rebuilding widgets.
 */
import Gtk from 'gi:Gtk-4.0'

import { styles } from 'node-gtk/styles'

import type { TimerSize } from '../core/layout.js'
import { INSPECTION_DNF_MS, type TimerSnapshot, type TimerState } from '../core/timer.js'
import { formatInspection, formatSolve, formatTime } from '../core/time.js'
import type { createStatsStrip } from './statsStrip.js'

/**
 * The ao5/ao12 strip (src/ui/statsStrip.ts). Its widget type cannot be
 * spelled out — the `gi:*` shims export a value namespace only — so it is
 * inferred from the factory.
 */
type StatsStrip = ReturnType<typeof createStatsStrip>

// Named colors that libadwaita actually defines: @window_fg_color,
// @success_color, @error_color, @warning_color. Note that GTK3's
// @dim_label_color does NOT exist in GTK4 — it silently renders white, so the
// dimmed text here is derived from the foreground colour with alpha() instead.
styles.add(`
  .timer-display {
    font-size: 96px;
    font-weight: 700;
    /* Tabular figures come from the built-in 'numeric' class on the label
       (Adwaita: font-variant-numeric: tabular-nums) — keep the digits from
       shifting as the time changes. */
  }
  /* The readout steps with the window's tier. Small covers both narrow and
     short windows — the digits are the one thing that must never clip —
     and large is what a window over 1200 logical does with the room. */
  .timer-display.size-s { font-size: 72px; }
  .timer-display.size-l { font-size: 128px; }
  /* State colours are semantics, not styling: idle dimmed while waiting,
     red while holding, green at ready, orange through inspection and red
     once doomed (≥ 17 s → the readout spells DNF). The running/stopped
     states carry no rule on purpose — they are the default foreground. */
  .timer-display.state-idle     { color: alpha(@window_fg_color, 0.55); }
  .timer-display.state-holding  { color: @error_color; }
  .timer-display.state-ready    { color: @success_color; }
  .timer-display.state-inspecting          { color: @warning_color; }
  .timer-display.state-inspecting.expired  { color: @error_color; }
`)

const HINTS: Record<TimerState, string> = {
  idle: 'Hold Space to start',
  holding: 'Keep holding…',
  ready: 'Release to start',
  inspecting: 'Inspection — Space starts, Esc cancels',
  running: 'Press any key to stop',
  stopped: 'Hold Space for next solve',
}

/**
 * Build the timer view. The return type is inferred rather than annotated:
 * the generated `gi:*` type shims expose GTK as a value namespace, so widget
 * types are only available through inference (`InstanceType` otherwise).
 *
 * `statsStrip` is optional so the view can stand alone (timer_walk.py's
 * headless walks); when present it sits directly under the hint line — the
 * averages describe the *solves*, so they read as a footnote to the timer
 * rather than as part of it.
 */
export function createTimerView(options?: { statsStrip?: StatsStrip }) {
  const label = new Gtk.Label({
    label: '0.00',
    cssClasses: ['timer-display', 'numeric', 'size-m', 'state-idle'],
  })

  /**
   * The class list is assembled from three independent facts — the size tier
   * (changes with the window), the timer state, and whether an inspection
   * has already blown its DNF limit — so both entry points below go through
   * one function rather than one of them overwriting the other's classes.
   */
  let size: TimerSize = 'm'
  let state: TimerState = 'idle'
  let expired = false
  const applyClasses = (): void => {
    const classes = ['timer-display', 'numeric', `size-${size}`, `state-${state}`]
    if (expired) classes.push('expired')
    label.setCssClasses(classes)
  }

  const hint = new Gtk.Label({
    label: HINTS.idle,
    // Built-in dim-label (Adwaita: opacity var(--dim-opacity) = 55%) instead
    // of a hand-rolled color rule; the size is the default 11pt.
    cssClasses: ['dim-label'],
  })

  const widget = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    // Counted in the window's height minimum: bars + panel + timer must fit
    // the 294px floor, so label/hint/strip gaps are kept to a minimum.
    spacing: 2,
    halign: Gtk.Align.CENTER,
    valign: Gtk.Align.CENTER,
    vexpand: true,
  })
  widget.append(label)
  widget.append(hint)
  if (options?.statsStrip !== undefined) widget.append(options.statsStrip.widget)

  return {
    /** Container to place in the window. */
    widget,
    /**
     * The readout's size class follows the window's tier
     * (src/core/layout.ts). The state classes on screen are reapplied, so a
     * resize never repaints a running timer in the idle colour.
     */
    setSize(next: TimerSize): void {
      if (next === size) return
      size = next
      applyClasses()
    },
    /** Redraw for a new snapshot. */
    render(snapshot: TimerSnapshot) {
      // Inspection counts down (then +2 / DNF); a stopped solve shows its
      // graded result — `formatSolve` adds the "+" or prints DNF, so the
      // readout always matches what the list will record.
      const text =
        snapshot.state === 'inspecting'
          ? formatInspection(snapshot.inspectionMs)
          : snapshot.state === 'stopped' && snapshot.penalty !== undefined
            ? formatSolve(snapshot.elapsedMs, snapshot.penalty)
            : formatTime(snapshot.elapsedMs)
      state = snapshot.state
      expired = snapshot.state === 'inspecting' && snapshot.inspectionMs >= INSPECTION_DNF_MS
      label.setLabel(text)
      applyClasses()
      hint.setLabel(HINTS[snapshot.state])
    },
  }
}
