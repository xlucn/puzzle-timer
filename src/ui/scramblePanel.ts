/*
 * scramblePanel.ts — the scramble above the timer.
 *
 * Component module (see timerLabel.ts): the top level registers styles and
 * exports a factory, so `styles.add()` hot-reloads the CSS under `npm run dev`.
 *
 * Display rule for the three possible states:
 *   scramble   → show it (wrapped, display only — copy is the header's
 *                button / Ctrl+C), diagram in the lower area when the type
 *                has one (main.ts owns its dock, see `image`);
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
 * panel renders the picture but does not place it: main.ts owns the dock
 * that puts it beside the timer or in its bottom-right cell.
 */
import Adw from 'gi:Adw-1'
import GLib from 'gi:GLib-2.0'
import Gtk from 'gi:Gtk-4.0'

import { styles } from 'node-gtk/styles'

import { t } from '../core/i18n.js'
import type { ScrambleFeedState } from '../core/scrambleFeed.js'
import { createFontSize } from './fontSize.js'

styles.add(`
  /* The scramble text's size is the layout's curve plus the user's scale,
     written into its own sheet by createFontSize() (src/core/layout.ts
     measures the char caps against it); 'monospace' is the built-in class,
     which also picks up the platform's --monospace-font-family. */
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

/** The warm-up failure keeps its reason; the catalog carries the frame. */
const FAILED = (reason: string) => t('scramble.failed', { reason })

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
 * "Not decided yet": every cap below starts unset and the first layout pass
 * fills it in before the window is presented. A zero cap would read as "no
 * room" (which the diagram takes literally), and a plausible-looking default
 * would be a second source for a number the layout owns.
 */
const UNSET = -1

/**
 * A declared size as `GdkPaintable` can report it. csTimer declares some
 * images with a fractional size (4x4 is 526×392.667) while the intrinsic
 * getters answer whole px, so an exact comparison would reject 74 of the 177
 * images that do render. Accepting floor/ceil/round covers every rounding rule
 * without loosening the check into "anything near it".
 */
function plausibleSize(reported: number, declared: number): boolean {
  return (
    reported === Math.floor(declared) ||
    reported === Math.ceil(declared) ||
    reported === Math.round(declared)
  )
}

/**
 * SVG → a `Gtk.Svg` paintable at the SVG's own size, or null when it cannot
 * be parsed (never throws: a broken picture must not cost the scramble that
 * came with it).
 *
 * Nothing here knows about the layout's cap. The paintable is parsed once per
 * scramble and then drawn at whatever size `Gtk.Picture` gives it (CONTAIN),
 * because `Gtk.Svg` rasterizes at paint time: resizing re-parses nothing, and
 * the diagram stays crisp at any size. Fitting inside the cap is the *box*'s
 * job — the picture sits in a pinned `Gtk.Overlay` (see `diagramBox` below) —
 * which is why a resize costs no SVG work at all.
 *
 * `Gtk.Svg` (GTK 4.22+) replaces the old Rsvg → GdkPixbuf → Texture pipeline.
 *
 * Two csTimer-SVG quirks are rewritten on the way in: literal `undefined`
 * colours (a headless module never loads the kernel preferences that would
 * fill them — subbed with csTimer's own defaults, black on #ffdddd), and
 * the `font:` shorthand, which Gtk.Svg's minimal CSS declines (expanded to
 * the longhand). A `viewBox` is added when the generator omitted one, so the
 * content scales with the size the picture is given. Anything else that warns
 * is logged once per message: a partial render beats no scramble, and a
 * failed parse is caught by the intrinsic-size check below.
 */
function svgPaintable(svg: string): InstanceType<typeof Gtk.Svg> | null {
  try {
    // csTimer's generator emits a fixed root: <svg width="W" height="H" …>.
    const root = svg.match(/^<svg\b([^>]*)>/)
    if (root === null) return null
    const declaredWidth = root[1].match(/\bwidth="([\d.]+)"/)
    const declaredHeight = root[1].match(/\bheight="([\d.]+)"/)
    if (declaredWidth === null || declaredHeight === null) return null
    const intrinsicWidth = Number.parseFloat(declaredWidth[1])
    const intrinsicHeight = Number.parseFloat(declaredHeight[1])
    // NaN here is csTimer's own answer for `cubennn`
    // (<svg width="NaN" height="NaN">): no drawing rule, not a failure.
    if (!(intrinsicWidth > 0) || !(intrinsicHeight > 0)) return null

    const withViewBox =
      root[1] +
      (/\bviewBox="/.test(root[1]) ? '' : ` viewBox="0 0 ${intrinsicWidth} ${intrinsicHeight}"`)
    let rewritten = svg.replace(root[0], `<svg${withViewBox}>`)
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
    // (200×200), which is not a declared size of any csTimer image we ship.
    // The comparison allows floor/ceil/round because the declared size is
    // fractional for 74 of the 177 images (4x4 is 526×392.667) and
    // `getIntrinsicWidth()` answers whole px.
    if (!plausibleSize(paintable.getIntrinsicWidth(), intrinsicWidth) ||
        !plausibleSize(paintable.getIntrinsicHeight(), intrinsicHeight)) {
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
    maxWidthChars: UNSET,
  })

  // Long scrambles would otherwise grow the window without bound — a
  // 7-cube relay is ~3000 characters, i.e. fifty lines. Cap the area and
  // let the rest scroll; short scrambles keep their natural height.
  const scroll = new Gtk.ScrolledWindow({
    child: text,
    hscrollbarPolicy: Gtk.PolicyType.NEVER, // the text wraps, it never scrolls sideways
    // AUTOMATIC makes scroll take up 58px vertical space even if they are hidden,
    // EXTERNAL won't, leaving more space for the timer and diagram.
    vscrollbarPolicy: Gtk.PolicyType.EXTERNAL,
    propagateNaturalHeight: true,
    maxContentHeight: UNSET,
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
    label: t('scramble.generating'),
    wrap: true,
    maxWidthChars: 60, // cap the natural width so long errors wrap too
    visible: false,
  })

  // The diagram: same source as the text, same frame, but placed by main.ts
  // in the lower area beside the timer or in its bottom-right cell. No card
  // behind it: the SVGs arrive transparent, and a white backdrop reads as a
  // stray box. Trade-off: black outlines go low-contrast on the dark theme —
  // worth a scheme-aware card if it reads badly.
  const picture = new Gtk.Picture({
    alternativeText: t('scramble.diagram'),
    canShrink: true,
    // Decorative: a press over the picture must reach the content's timer
    // gesture, not stop at the picture.
    canTarget: false,
    contentFit: Gtk.ContentFit.CONTAIN,
    halign: Gtk.Align.END,
    valign: Gtk.Align.END,
  })
  // The picture's natural size is the SVG's own (~375×180 … 526×393) and its
  // width/height requests only raise the *minimum*, so on its own it would
  // drag the window past the cap. Overlay children are not part of the size
  // request, so the spacer below is what the layout sees and the picture is
  // drawn into it with CONTAIN, keeping its aspect and the box the layout
  // asked for. The cap becomes a size request here, never an SVG rewrite.
  const diagramSpacer = new Gtk.Box({ canTarget: false })
  const diagramBox = new Gtk.Overlay({
    child: diagramSpacer,
    // END keeps it flush right in the dock; the dock decides whether that is
    // the bottom-right corner or the bottom-right of its own column.
    halign: Gtk.Align.END,
    valign: Gtk.Align.END,
    marginEnd: 16,
    marginBottom: 16,
    // Decorative all the way down: a press must reach the content's timer
    // gesture, never stop at the box or at the spacer behind the picture.
    canTarget: false,
    visible: false,
  })
  diagramBox.addOverlay(picture)
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

  // The diagram is deliberately *not* appended here: main.ts puts it in the
  // lower area beside the timer or in its bottom-right cell.
  widget.append(overlay)
  widget.append(warmError)

  // The last scramble that had a turn on screen; while the feed is busy it
  // stays visible as a ghost so the slot never collapses mid-update.
  let lastText: string | null = null
  /** Which type the ghost belongs to — the image lookup keys on it too. */
  let lastType: string | null = null
  /** The SVG currently rendered, so re-renders only pay for a real change. */
  let currentSvg: string | null = null

  // The caps in force: unset until the first layout pass pushes the curve's
  // numbers in, and only ever a request on the diagram's box.
  let textMaxChars = UNSET
  let textMaxHeight = UNSET
  let diagramMaxWidth = UNSET
  let diagramMaxHeight = UNSET
  const applyFontSize = createFontSize('.scramble-text')

  /** The panel and diagram are hidden while the timer has the floor. */
  let chromeVisible = true
  /** Whether the current scramble produced a paintable (a parse may fail). */
  let pictureReady = false
  /** The picture's own width/height (0 while there is none). */
  let pictureAspect = 0

  /**
   * The spacer is the box's only size request. The layout hands a bound for
   * the *widest* diagram (2.1:1); trimming the request to the picture's own
   * aspect keeps a 4:3 diagram from reserving a 2:1 column and pushing the
   * timer left for empty space. A resize or a new picture re-asks; nothing is
   * re-parsed (the paintable keeps the SVG's own size).
   */
  const applyDiagramSize = (): void => {
    const width =
      pictureAspect > 0
        ? Math.min(diagramMaxWidth, diagramMaxHeight * pictureAspect)
        : diagramMaxWidth
    diagramSpacer.setSizeRequest(
      Math.max(0, Math.round(width)),
      Math.max(0, Math.round(diagramMaxHeight)),
    )
  }

  /** Push the current state of three independent booleans into the box. */
  const updateDiagramVisibility = (): void => {
    // A zero cap is the layout saying "no room for the picture" (a short,
    // narrow window). The parse has nothing to say about size.
    const hasRoom = diagramMaxWidth > 0 && diagramMaxHeight > 0
    diagramBox.setVisible(chromeVisible && pictureReady && hasRoom)
  }

  let spinning = false
  const setSpinning = (on: boolean) => {
    if (on === spinning) return
    spinning = on
    spinner.setVisible(on)
  }

  /** Redraw for a new feed state. */
  const render = (state: ScrambleFeedState): void => {
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
      status.setLabel(generating ? t('scramble.generating') : FAILED(state.error ?? ''))
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
    // image, or images switched off): the picture hides and the dock
    // collapses to zero in either placement.
    const svg =
      lastText !== null && lastType !== null ? options.getImage(lastType, lastText) : null
    if (svg !== currentSvg) {
      currentSvg = svg
      // Parsed once per scramble at its own size: a resize or a cap change
      // only moves the box the picture is drawn into.
      const paintable = svg === null ? null : svgPaintable(svg)
      pictureReady = paintable !== null
      picture.setPaintable(paintable)
      pictureAspect =
        paintable !== null && paintable.getIntrinsicHeight() > 0
          ? paintable.getIntrinsicWidth() / paintable.getIntrinsicHeight()
          : 0
      applyDiagramSize()
      updateDiagramVisibility()
    }
  }

  return {
    /** Container to place between the header bar and the timer. */
    widget,
    /**
     * The diagram for the caller's lower-area dock — the panel renders it,
     * main.ts decides whether it sits beside the timer or in its bottom-right
     * cell. This is the *box* (the picture rides in an overlay inside it), so
     * a caller's margin applies to the box.
     */
    image: diagramBox,
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
      updateDiagramVisibility()
    },
    /**
     * How wide the scramble text may ask to be, and how tall the slot may
     * grow — both from the layout curve, already carrying the user's text
     * scale. The label's own `maxWidthChars` caps its natural width (the
     * minimum is the longest word, so the window can still shrink past it)
     * and `maxContentHeight` caps a tall scramble.
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
     * The scramble text's font size — the layout curve times the user's
     * preference (src/core/layout.ts). The char caps above are measured
     * against it, so the two always travel together.
     */
    setFontSize(px: number): void {
      applyFontSize(px)
    },
    /**
     * The diagram box's cap for this window (src/core/layout.ts): an upper
     * bound for the widest picture, trimmed here to the one on screen. Only
     * the box's size request moves: the paintable was parsed at the SVG's own
     * size, so a cap change — every resize — re-parses nothing and the
     * picture's placement stays main.ts's decision.
     */
    setDiagramMax(width: number, height: number): void {
      if (width === diagramMaxWidth && height === diagramMaxHeight) return
      diagramMaxWidth = width
      diagramMaxHeight = height
      applyDiagramSize()
      updateDiagramVisibility()
    },
  }
}
