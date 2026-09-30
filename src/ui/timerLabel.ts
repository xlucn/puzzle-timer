/*
 * timerLabel.ts — the big timer readout plus its hint line.
 *
 * Component module: its top level only registers styles and defines exports,
 * so `styles.add()` hot-reloads the CSS below under `npm run dev` without
 * rebuilding widgets.
 */
import Gtk from 'gi:Gtk-4.0'

import { styles } from 'node-gtk/styles'

import type { TimerSnapshot, TimerState } from '../core/timer.js'
import { formatTime } from '../core/time.js'

// Named colors that libadwaita actually defines: @window_fg_color,
// @success_color, @error_color, @warning_color. Note that GTK3's
// @dim_label_color does NOT exist in GTK4 — it silently renders white, so the
// dimmed text here is derived from the foreground colour with alpha() instead.
styles.add(`
  .timer-display {
    font-size: 96px;
    font-weight: 700;
    /* Tabular figures keep the digits from shifting as the time changes. */
    font-feature-settings: "tnum" 1;
  }
  .timer-display.state-idle     { color: alpha(@window_fg_color, 0.55); }
  .timer-display.state-holding  { color: @error_color; }
  .timer-display.state-ready    { color: @success_color; }
  .timer-display.state-running  { color: @window_fg_color; }
  .timer-display.state-stopped  { color: @window_fg_color; }

  .timer-hint {
    font-size: 15px;
    color: alpha(@window_fg_color, 0.55);
  }
`)

const HINTS: Record<TimerState, string> = {
  idle: 'Hold Space to start',
  holding: 'Keep holding…',
  ready: 'Release to start',
  running: 'Press any key to stop',
  stopped: 'Hold Space for next solve',
}

/**
 * Build the timer view. The return type is inferred rather than annotated:
 * the generated `gi:*` type shims expose GTK as a value namespace, so widget
 * types are only available through inference (`InstanceType` otherwise).
 */
export function createTimerView() {
  const label = new Gtk.Label({
    label: '0.00',
    cssClasses: ['timer-display', 'state-idle'],
  })

  const hint = new Gtk.Label({
    label: HINTS.idle,
    cssClasses: ['timer-hint'],
  })

  const widget = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 4,
    halign: Gtk.Align.CENTER,
    valign: Gtk.Align.CENTER,
    vexpand: true,
  })
  widget.append(label)
  widget.append(hint)

  return {
    /** Container to place in the window. */
    widget,
    /** Redraw for a new snapshot. */
    render(snapshot: TimerSnapshot) {
      label.setLabel(formatTime(snapshot.elapsedMs))
      label.setCssClasses(['timer-display', `state-${snapshot.state}`])
      hint.setLabel(HINTS[snapshot.state])
    },
  }
}
