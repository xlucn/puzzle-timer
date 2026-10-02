/*
 * scramblePanel.ts — the scramble above the timer.
 *
 * Component module (see timerLabel.ts): the top level registers styles and
 * exports a factory, so `styles.add()` hot-reloads the CSS under `npm run dev`.
 *
 * Three things can be true at once, and this is the display rule:
 *   scramble   → show it (wrapped, selectable so it can be copied), with its
 *                diagram floating in the view's bottom-right corner when the
 *                type has one (M5 — main.ts places it, see `image`);
 *   generating → the previous scramble stays on screen as a dimmed ghost
 *                (`.pending`) with the spinner + status line over it: the
 *                slot keeps the *text's* height, so the timer holds still
 *                while the next scramble generates — dropping the text
 *                would collapse a tall slot and jump the timer (first load
 *                has no ghost and shows the bare slot);
 *   error      → the reason, in @error_color, over the ghost the same way
 *                (or in the bare slot when there is nothing to ghost). A
 *                failure of the *warm* scramble is reported under the
 *                scramble currently on screen — the solve in front of you
 *                is still usable, you just know the next one is not ready.
 *
 * The image follows the same ghost rule as the text: it is looked up from
 * the scramble on screen (or its ghost), so it swaps in the same frame the
 * text does. While the feed is busy, the last image stays up with its
 * ghost; the lookup is a Map read, so re-renders are free. The panel does
 * not *place* the picture — it is handed to an overlay (main.ts), so its
 * presence or size can never move the text or the timer.
 */
import Gdk from 'gi:Gdk-4.0'
import GdkPixbuf from 'gi:GdkPixbuf-2.0'
import Gtk from 'gi:Gtk-4.0'
import Rsvg from 'gi:Rsvg-2.0'

import { styles } from 'node-gtk/styles'

import type { ScrambleFeedState } from '../core/scrambleFeed.js'

styles.add(`
  .scramble-text {
    font-family: monospace;
    font-size: 18px;
  }
  /* Ghost of the scramble being replaced: it keeps its space (so the timer
     doesn't move while the next one generates) without reading as live. */
  .scramble-text.pending {
    opacity: 0.4;
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

/**
 * Diagram size cap (logical px). The natural sizes run from ~375×180 (clock)
 * to ~526×393 (4x4) — a 396×296 3x3 image would eat half the window, so the
 * pixbuf is scaled down to fit, keeping its aspect. Within one type the size
 * is constant, which is what keeps the timer from moving between solves.
 */
const IMAGE_MAX_WIDTH = 440
const IMAGE_MAX_HEIGHT = 150

/**
 * SVG → scaled Gdk.Texture, or null when it cannot be rendered (never throws:
 * a broken picture must not cost the scramble that came with it).
 */
function svgToTexture(svg: string): InstanceType<typeof Gdk.Texture> | null {
  try {
    const handle = Rsvg.Handle.newFromData(Array.from(new TextEncoder().encode(svg)))
    if (handle === null) return null
    const original = handle.getPixbuf()
    if (original === null) return null

    const width = original.getWidth()
    const height = original.getHeight()
    const scale = Math.min(IMAGE_MAX_WIDTH / width, IMAGE_MAX_HEIGHT / height, 1)
    const pixbuf =
      scale < 1 && width > 0 && height > 0
        ? original.scaleSimple(
            Math.max(1, Math.round(width * scale)),
            Math.max(1, Math.round(height * scale)),
            GdkPixbuf.InterpType.BILINEAR,
          )
        : original
    if (pixbuf === null) return null
    return Gdk.Texture.newForPixbuf(pixbuf)
  } catch (error) {
    console.error(
      `[scramble] could not render the image: ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}

export interface ScramblePanelOptions {
  /**
   * The SVG for a scramble, or null when its type has none (or images are
   * switched off in the preferences). Looked up from the scramble on screen,
   * including the ghost while the next one generates.
   */
  getImage: (type: string, scramble: string) => string | null
}

export function createScramblePanel(options: ScramblePanelOptions) {
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

  // The diagram (M5): same source as the text, same frame — but placed as
  // an *overlay* child of the view (main.ts), tucked into the bottom-right
  // corner (user call, 2026-10-02). Overlay children are not counted in the
  // parent's size request, so the picture cannot move the text or the timer
  // at any window size, and switching the image off reflows nothing. Its
  // size is the *scaled pixbuf's* (see IMAGE_MAX_*), constant within a
  // type; `canShrink` + CONTAIN take it down again when the window narrows
  // instead of clipping.
  //
  // No card behind it: the SVGs come transparent from cstimer_module and
  // the white backdrop added in the first draft read as a stray box on the
  // window (user call, 2026-10-02). Trade-off: the diagrams are drawn with
  // black outlines, so on a dark theme the outlines go low-contrast — worth
  // revisiting if it reads badly (e.g. a scheme-aware card).
  const picture = new Gtk.Picture({
    alternativeText: 'Scramble diagram',
    canShrink: true,
    contentFit: Gtk.ContentFit.CONTAIN,
    // The corner: END/END anchors it (the FILL default would stretch it
    // over whatever room the overlay has), with a small inset from the
    // window edges. It never overlaps the stats strip — that row is
    // centred and stops well left of the diagram's left edge.
    halign: Gtk.Align.END,
    valign: Gtk.Align.END,
    marginEnd: 16,
    marginBottom: 16,
    visible: false,
  })
  const statusRow = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 8,
    halign: Gtk.Align.CENTER,
    valign: Gtk.Align.CENTER, // centred in the slot, not stretched by it
    visible: false,
  })
  statusRow.append(spinner)
  statusRow.append(status)

  // The one status that shares the panel with visible text (a warm failure)
  // stays stacked, reported under the scramble as documented above.
  const warmError = new Gtk.Label({
    cssClasses: ['scramble-status', 'error'],
    wrap: true,
    maxWidthChars: 60,
    visible: false,
  })

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
  // The status row rides *in* the text's slot (an overlay), never under it.
  // Stacked, the panel asked for the slot plus spacing plus the row —
  // measured, 86 against a one-line scramble's 64 — so the timer jumped
  // ~22 px down every time the gear spun. GTK4 does not count overlay
  // children in the size request, so the panel keeps the slot's height
  // alone: the ghost text's height while updating, or the empty scrolled
  // window's own 46 px reservation on first load (for an 18 px row).
  const overlay = new Gtk.Overlay({ child: scroll })
  overlay.addOverlay(statusRow)

  // The picture is deliberately *not* appended here: main.ts overlays it on
  // the whole view so it can reach the bottom-right corner.
  widget.append(overlay)
  widget.append(warmError)

  // The last scramble that had a turn on screen; while the feed is busy it
  // stays visible as a ghost so the slot never collapses mid-update.
  let lastText: string | null = null
  /** Which type the ghost belongs to — the image lookup keys on it too. */
  let lastType: string | null = null
  /** The SVG currently rendered, so re-renders only pay for a real change. */
  let currentSvg: string | null = null

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
    /**
     * The diagram, for the caller to place as an overlay child (bottom-right
     * corner of the view) — the panel renders it, the view owns its position.
     */
    image: picture,
    /** Redraw for a new feed state. */
    render(state: ScrambleFeedState) {
      const hasScramble = state.scramble !== null
      const generating = !hasScramble && state.error === null

      // A new scramble replaces the ghost; while there is none, the last
      // one stays on screen dimmed — the slot keeps *its* height, so the
      // timer holds still for the whole update. First load has no ghost:
      // the bare slot shows the spinner.
      if (state.scramble !== null) {
        lastText = state.scramble
        lastType = state.type
        text.setLabel(lastText)
        text.setCssClasses(['scramble-text'])
      } else if (lastText !== null) {
        text.setCssClasses(['scramble-text', 'pending'])
      }
      text.setVisible(lastText !== null)

      // No scramble on screen (updating or failed): the row *is* the
      // slot's content, overlaid — it can never add height to the panel.
      statusRow.setVisible(state.scramble === null)
      setSpinning(generating)
      if (state.scramble === null) {
        status.setLabel(generating ? GENERATING : FAILED(state.error ?? ''))
        status.setCssClasses(generating ? ['scramble-status'] : ['scramble-status', 'error'])
      }

      // A warm failure reports under the scramble still on screen.
      const warmFailure = hasScramble ? state.error : null
      warmError.setVisible(warmFailure !== null)
      if (warmFailure !== null) warmError.setLabel(FAILED(warmFailure))

      // The diagram follows the scramble on screen *or its ghost* — same
      // lookup, same frame as the text, and it stays up while the next one
      // generates. Null means "no picture for this one" (type without an
      // image, or images switched off): the overlay child just hides, and
      // since overlay children cost no height, the timer cannot move.
      const svg =
        lastText !== null && lastType !== null ? options.getImage(lastType, lastText) : null
      if (svg !== currentSvg) {
        currentSvg = svg
        const texture = svg === null ? null : svgToTexture(svg)
        picture.setPaintable(texture)
        picture.setVisible(texture !== null)
      }
    },
  }
}
