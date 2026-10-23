/*
 * scramblePanel.ts — the scramble above the timer.
 *
 * Component module (see timerLabel.ts): the top level registers styles and
 * exports a factory, so `styles.add()` hot-reloads the CSS under `npm run dev`.
 *
 * Display rule for the three possible states:
 *   scramble   → show it (wrapped, display only — copy is the header's
 *                button / Ctrl+C), diagram floating in the view's
 *                bottom-right corner when the type has one (main.ts places
 *                it, see `image`);
 *   generating → the previous scramble stays as a dimmed ghost (`.pending`)
 *                with the spinner + status over it: the slot keeps the
 *                *text's* height, so the timer holds still (first load has
 *                no ghost and shows the bare slot);
 *   error      → the reason, in @error_color, over the ghost the same way.
 *                A failure of the *warm* scramble reports under the
 *                scramble currently on screen — the solve in front of you
 *                is still usable, you just know the next one is not ready.
 *
 * The image follows the same ghost rule, looked up from the scramble on
 * screen (or its ghost), so it swaps in the same frame the text does. The
 * panel does not *place* the picture — it is handed to an overlay
 * (main.ts), so its presence or size can never move the text or the timer.
 */
import Adw from 'gi:Adw-1'
import GLib from 'gi:GLib-2.0'
import Gtk from 'gi:Gtk-4.0'

import { styles } from 'node-gtk/styles'

import type { ScrambleFeedState } from '../core/scrambleFeed.js'

styles.add(`
  .scramble-text {
    /* Monospace comes from the built-in 'monospace' class (which also picks
       up the platform's --monospace-font-family). The size stays ours: the
       layout's char caps (scrambleChars per tier) are measured against 18px,
       so this number is load-bearing, not decoration. */
    font-size: 18px;
  }
  /* Ghost of the scramble being replaced: it keeps its space (so the timer
     doesn't move while the next one generates) without reading as live. */
  .scramble-text.pending {
    opacity: 0.4;
  }
  /* Only the failure keeps a rule — red is semantics; the resting status
     gets its size and dim from the built-in caption/dim-label classes. */
  .scramble-status.error {
    color: @error_color;
  }
`)

const GENERATING = 'Generating scramble…'
const FAILED = (reason: string) => `Scramble failed: ${reason}`

/**
 * Default diagram size cap (logical px), i.e. the cap of the normal window
 * tier — applyLayout() pushes larger caps into the panel on a wide
 * window (see setDiagramMax). The natural sizes run from ~375×180 (clock) to
 * ~526×393 (4x4) — a 396×296 3x3 image would eat half the window, so the
 * picture is asked for the cap-fitted box (svgPaintable), keeping its
 * aspect. Within one type and one window size the result is constant,
 * which is what keeps the timer from moving between solves.
 */
const IMAGE_MAX_WIDTH = 440
const IMAGE_MAX_HEIGHT = 150

/** The scramble text's default cap (normal tier), in characters. */
const TEXT_MAX_CHARS = 60

/** The scramble slot's default cap (normal tier), in px. */
const TEXT_MAX_HEIGHT = 160

/**
 * The panel's own vertical margins (see `widget` below). They are *outside*
 * the panel's height — GTK allots a child its margins plus its size, and the
 * next child starts after the lot — so the timer begins this much below the
 * panel's measured bottom edge. They are also part of the *window's* height
 * minimum: bars + panel + timer must fit the 294px floor with room to spare.
 */
const PANEL_MARGIN_TOP = 8
const PANEL_MARGIN_BOTTOM = 4

/**
 * SVG → a Gtk.Svg paintable whose intrinsic size is the cap-fitted box, or
 * null when it cannot be parsed (never throws: a broken picture must not
 * cost the scramble that came with it).
 *
 * `Gtk.Svg` (GTK 4.22+) rasterizes at paint time, so the diagram is crisp
 * at any scale — and replaces the old Rsvg → GdkPixbuf → Texture pipeline.
 *
 * The tier caps have to live in the SVG itself: Gtk.Picture's width/height
 * requests only raise the *minimum*, so the paintable's intrinsic size wins
 * (probe: request 201×150, allocated 396×296). The root viewport is
 * re-declared at the fitted size, with a viewBox in the original
 * coordinates when the generator omitted one — the content scales into the
 * box keeping its aspect.
 *
 * Two csTimer-SVG quirks are rewritten on the way in: literal `undefined`
 * colours (a headless module never loads the kernel preferences that would
 * fill them — subbed with csTimer's own defaults, black on #ffdddd), and
 * the `font:` shorthand, which Gtk.Svg's minimal CSS declines (expanded to
 * the longhand). Anything else that warns is logged once per message: a
 * partial render beats no scramble, and every tier keeps the height under
 * Gtk.Svg's 200×200 failed-parse default, so a size mismatch reads as "no
 * picture".
 */
function svgPaintable(
  svg: string,
  maxWidth: number,
  maxHeight: number,
): InstanceType<typeof Gtk.Svg> | null {
  try {
    // csTimer's generator emits a fixed root: <svg width="W" height="H" …>.
    const root = svg.match(/^<svg\b([^>]*)>/)
    if (root === null) return null
    const declaredWidth = root[1].match(/\bwidth="([\d.]+)"/)
    const declaredHeight = root[1].match(/\bheight="([\d.]+)"/)
    if (declaredWidth === null || declaredHeight === null) return null
    const intrinsicWidth = Number.parseFloat(declaredWidth[1])
    const intrinsicHeight = Number.parseFloat(declaredHeight[1])
    if (!(intrinsicWidth > 0) || !(intrinsicHeight > 0)) return null

    const scale = Math.min(maxWidth / intrinsicWidth, maxHeight / intrinsicHeight, 1)
    const width = Math.max(1, Math.round(intrinsicWidth * scale))
    const height = Math.max(1, Math.round(intrinsicHeight * scale))

    const fitted =
      root[1]
        .replace(/\bwidth="[^"]*"/, `width="${width}"`)
        .replace(/\bheight="[^"]*"/, `height="${height}"`) +
      (/\bviewBox="/.test(root[1]) ? '' : ` viewBox="0 0 ${intrinsicWidth} ${intrinsicHeight}"`)
    let rewritten = svg.replace(root[0], `<svg${fitted}>`)
    // csTimer writes literal `undefined` for colours the headless module
    // never loads — sub csTimer's own defaults (black text, board-colour
    // outline so labels stay legible over the cube).
    rewritten = rewritten
      .replace(/\bfill:undefined\b/g, 'fill:#000000')
      .replace(/\bstroke:undefined\b/g, 'stroke:#ffdddd')
    // Gtk.Svg declines the `font:` shorthand ("No property named font") —
    // expand it so the text does not silently render at the wrong size.
    rewritten = rewritten.replace(
      /\bfont:\s*(\d+(?:\.\d+)?)px\s+([\w-]+)/g,
      'font-size:$1px;font-family:$2',
    )

    const paintable = Gtk.Svg.new()
    const warnings: string[] = []
    paintable.on('error', (error) => warnings.push(error.message))
    paintable.loadFromBytes(
      GLib.Bytes.new(Array.from(new TextEncoder().encode(rewritten))),
    )
    if (warnings.length > 0) {
      // Tripwire: the known defects above are rewritten before loading, so
      // anything left is new — log one line per distinct message (an image
      // repeats the same style on every label) rather than failing the
      // picture: a partial render still beats no scramble.
      const unique = [...new Set(warnings)]
      const repeat = warnings.length > unique.length ? ` (${warnings.length}×)` : ''
      console.error(`[scramble] svg warnings: ${unique.join('; ')}${repeat}`)
    }
    // Success reports the declared size; a failed parse reports the fallback
    // (200×200), which no fitted box can equal — see the doc comment.
    if (
      paintable.getIntrinsicWidth() !== width ||
      paintable.getIntrinsicHeight() !== height
    ) {
      return null
    }
    return paintable
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
    // 'monospace' is the built-in class (platform font-family + size); our
    // .scramble-text rule only pins the size the char caps are measured at.
    cssClasses: ['scramble-text', 'monospace'],
    label: '',
    visible: false,
    wrap: true,
    // Display, not an editor: a selectable label puts itself in the focus
    // chain (Tab would land on the scramble) and invites dragging a highlight
    // across the one thing on screen that is there to be read. Copying lives
    // on the header's copy button (Ctrl+C), which also copies text that has
    // wrapped over several lines.
    selectable: false,
    xalign: 0.5, // centred while unwrapped…
    justify: Gtk.Justification.CENTER, // …and when the lines wrap
    // A wrapping label asks for its *unwrapped* width, so a multi-cube
    // scramble (r234567 is ~3000 characters) would otherwise drag the window
    // wider than the screen. Cap the request; the label still fills the
    // window when there is room and wraps there.
    maxWidthChars: TEXT_MAX_CHARS,
  })

  // Long scrambles would otherwise grow the window without bound — a
  // 7-cube relay is ~3000 characters, i.e. fifty lines. Cap the area and
  // let the rest scroll; short scrambles keep their natural height.
  const scroll = new Gtk.ScrolledWindow({
    child: text,
    hscrollbarPolicy: Gtk.PolicyType.NEVER, // the text wraps, it never scrolls sideways
    vscrollbarPolicy: Gtk.PolicyType.AUTOMATIC,
    propagateNaturalHeight: true,
    maxContentHeight: TEXT_MAX_HEIGHT,
  })

  // Adw.Spinner, not Gtk.Spinner: it animates only while mapped, so its
  // visibility *is* the start/stop — that matters in the error state, where
  // the statusRow stays visible and a mapped spinner would spin over a
  // failure (hence the spinner hides itself there).
  const spinner = new Adw.Spinner({ visible: false })
  const status = new Gtk.Label({
    // Resting state = built-in caption (size) + dim-label (dim); the error
    // state swaps dim-label out so the red reads full-strength.
    cssClasses: ['scramble-status', 'caption', 'dim-label'],
    label: GENERATING,
    wrap: true,
    maxWidthChars: 60, // cap the natural width so long errors wrap too
    visible: false,
  })

  // The diagram: same source as the text, same frame, but placed as an
  // *overlay* child of the view (main.ts) — overlay children take no
  // size-request space, so the picture cannot move the text or the timer.
  // No card behind it: the SVGs arrive transparent, and a white backdrop
  // reads as a stray box. Trade-off: black outlines go low-contrast on the
  // dark theme — worth a scheme-aware card if it reads badly.
  const picture = new Gtk.Picture({
    alternativeText: 'Scramble diagram',
    canShrink: true,
    // Decorative: a press over the picture must reach the content's timer
    // gesture underneath, not stop at the picture.
    canTarget: false,
    contentFit: Gtk.ContentFit.CONTAIN,
    // END/END anchors it in the corner (FILL would stretch it over the
    // overlay's room). It never overlaps the stats strip — that row is
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
    cssClasses: ['scramble-status', 'caption', 'error'],
    wrap: true,
    maxWidthChars: 60,
    visible: false,
  })

  const widget = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 6,
    // GTK4's CSS box model has no margin-start/margin-end (only left/right),
    // so the panel's breathing room comes from widget properties instead.
    marginTop: PANEL_MARGIN_TOP,
    marginBottom: PANEL_MARGIN_BOTTOM,
    marginStart: 18,
    marginEnd: 18,
  })
  // The status row rides *in* the text's slot (an overlay), never under it:
  // stacked, the panel asked for the slot plus the row — 86px against a
  // one-line scramble's 64 — so the timer jumped every time the gear spun.
  // GTK4 does not count overlay children in the size request.
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
  /** The feed state last drawn — what a tier change redraws without waiting. */
  let lastState: ScrambleFeedState | null = null

  // The caps in force: they start at the normal tier's defaults and
  // applyLayout() pushes the tier's numbers in. Within one window size they
  // are constant, which is what keeps the timer from moving between solves.
  let textMaxChars = TEXT_MAX_CHARS
  let textMaxHeight = TEXT_MAX_HEIGHT
  let diagramMaxWidth = IMAGE_MAX_WIDTH
  let diagramMaxHeight = IMAGE_MAX_HEIGHT

  /** The panel and diagram are hidden while the timer has the floor. */
  let chromeVisible = true
  /** Whether the current scramble produced a paintable (caps may refuse it). */
  let pictureReady = false

  let spinning = false
  const setSpinning = (on: boolean) => {
    if (on === spinning) return
    spinning = on
    spinner.setVisible(on)
  }

  /** Redraw for a new feed state. */
  const render = (state: ScrambleFeedState): void => {
    lastState = state
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
      text.setCssClasses(['scramble-text', 'monospace'])
    } else if (lastText !== null) {
      text.setCssClasses(['scramble-text', 'monospace', 'pending'])
    }
    text.setVisible(lastText !== null)

    // No scramble on screen (updating or failed): the row *is* the
    // slot's content, overlaid — it can never add height to the panel.
    statusRow.setVisible(state.scramble === null)
    setSpinning(generating)
    if (state.scramble === null) {
      status.setLabel(generating ? GENERATING : FAILED(state.error ?? ''))
      status.setCssClasses(
        generating ? ['scramble-status', 'caption', 'dim-label'] : ['scramble-status', 'caption', 'error'],
      )
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
      // The paintable's intrinsic size is already the cap-fitted box
      // (svgPaintable rewrites the root viewport), so the Picture's natural
      // size *is* the cap — recomputed here on tier changes, since
      // setDiagramMax clears currentSvg and this block re-runs.
      const fit = svg === null ? null : svgPaintable(svg, diagramMaxWidth, diagramMaxHeight)
      pictureReady = fit !== null
      picture.setPaintable(fit)
      picture.setVisible(chromeVisible && pictureReady)
    }
  }

  return {
    /** Container to place between the header bar and the timer. */
    widget,
    /**
     * The diagram, for the caller to place as an overlay child (bottom-right
     * corner of the view) — the panel renders it, the view owns its position.
     */
    image: picture,
    render,
    /**
     * Hide the scramble and its diagram for the distraction-free timer view.
     * Render keeps the picture hidden until this is called with `true` again,
     * so a prefetched scramble cannot flash back mid-solve.
     */
    setChromeVisible(visible: boolean): void {
      if (visible === chromeVisible) return
      chromeVisible = visible
      widget.setVisible(visible)
      picture.setVisible(visible && pictureReady)
    },
    /**
     * How wide the scramble text may ask to be, and how tall the slot may
     * grow — both from the window's tier. The label's own `maxWidthChars`
     * caps its natural width (the minimum is the longest word, so the window
     * can still shrink past it) and `maxContentHeight` caps a tall scramble.
     */
    setLimits(maxWidthChars: number, maxContentHeight: number): void {
      if (maxWidthChars !== textMaxChars) {
        textMaxChars = maxWidthChars
        text.setMaxWidthChars(textMaxChars)
      }
      if (maxContentHeight !== textMaxHeight) {
        textMaxHeight = maxContentHeight
        scroll.maxContentHeight = textMaxHeight
      }
    },
    /**
     * The diagram cap for this tier. The paintable's viewport was written
     * against the old cap, so the cache is dropped and redrawn — the
     * picture changes size, never its position.
     */
    setDiagramMax(width: number, height: number): void {
      if (width === diagramMaxWidth && height === diagramMaxHeight) return
      diagramMaxWidth = width
      diagramMaxHeight = height
      currentSvg = null
      if (lastState !== null) render(lastState)
    },
    /**
     * The diagram's size *as drawn* — where the image actually is, since
     * overlay children take no layout space. Zero before the first
     * allocation; main.ts logs it on every change, it is the number most
     * likely to reveal clipping.
     */
    diagramSize: (): { width: number; height: number } => ({
      width: picture.getSize(Gtk.Orientation.HORIZONTAL),
      height: picture.getSize(Gtk.Orientation.VERTICAL),
    }),
  }
}
