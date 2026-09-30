/*
 * scramblePanel.ts — the scramble above the timer.
 *
 * Component module (see timerLabel.ts): the top level registers styles and
 * exports a factory, so `styles.add()` hot-reloads the CSS under `npm run dev`.
 *
 * Three things can be true at once, and this is the display rule:
 *   scramble  → show it (wrapped, selectable so it can be copied);
 *   generating → spinner + status line;
 *   error     → the reason, in @error_color.
 * A failure of the *warm* scramble is reported under the scramble currently
 * on screen — the solve in front of you is still usable, you just know the
 * next one is not ready.
 */
import Gtk from 'gi:Gtk-4.0'

import { styles } from 'node-gtk/styles'

import type { ScrambleFeedState } from '../core/scrambleFeed.js'

styles.add(`
  .scramble-text {
    font-family: monospace;
    font-size: 18px;
  }
  .scramble-status {
    font-size: 13px;
    color: alpha(@window_fg_color, 0.55);
  }
  .scramble-status.error {
    color: @error_color;
  }
`)

const GENERATING = 'Generating scramble…'
const FAILED = (reason: string) => `Scramble failed: ${reason}`

export function createScramblePanel() {
  const text = new Gtk.Label({
    cssClasses: ['scramble-text'],
    label: '',
    visible: false,
    wrap: true,
    selectable: true,
    xalign: 0.5, // centred while unwrapped…
    justify: Gtk.Justification.CENTER, // …and when the lines wrap
    // A wrapping label asks for its *unwrapped* width, so a multi-cube
    // scramble (r234567 is ~3000 characters) would otherwise drag the window
    // wider than the screen. Cap the request; the label still fills the
    // window when there is room and wraps there.
    maxWidthChars: 60,
  })

  // Long scrambles would otherwise grow the window without bound — a
  // 7-cube relay is ~3000 characters, i.e. fifty lines. Cap the area and
  // let the rest scroll; short scrambles keep their natural height.
  const scroll = new Gtk.ScrolledWindow({
    child: text,
    hscrollbarPolicy: Gtk.PolicyType.NEVER, // the text wraps, it never scrolls sideways
    vscrollbarPolicy: Gtk.PolicyType.AUTOMATIC,
    propagateNaturalHeight: true,
    maxContentHeight: 160,
  })

  const spinner = new Gtk.Spinner()
  const status = new Gtk.Label({
    cssClasses: ['scramble-status'],
    label: GENERATING,
    wrap: true,
    maxWidthChars: 60, // cap the natural width so long errors wrap too
    visible: false,
  })

  const statusRow = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 8,
    halign: Gtk.Align.CENTER,
    visible: false,
  })
  statusRow.append(spinner)
  statusRow.append(status)

  const widget = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 6,
    // GTK4's CSS box model has no margin-start/margin-end (only left/right),
    // so the panel's breathing room comes from widget properties instead.
    marginTop: 14,
    marginBottom: 4,
    marginStart: 18,
    marginEnd: 18,
  })
  widget.append(scroll)
  widget.append(statusRow)

  let spinning = false
  const setSpinning = (on: boolean) => {
    if (on === spinning) return
    spinning = on
    if (on) spinner.start()
    else spinner.stop()
  }

  return {
    /** Container to place between the header bar and the timer. */
    widget,
    /** Redraw for a new feed state. */
    render(state: ScrambleFeedState) {
      const hasScramble = state.scramble !== null
      const generating = !hasScramble && state.error === null

      text.setVisible(hasScramble)
      if (hasScramble) text.setLabel(state.scramble ?? '')

      const showStatus = generating || state.error !== null
      statusRow.setVisible(showStatus)
      setSpinning(generating)
      if (showStatus) {
        status.setLabel(generating ? GENERATING : FAILED(state.error ?? ''))
        status.setCssClasses(generating ? ['scramble-status'] : ['scramble-status', 'error'])
      }
    },
  }
}
