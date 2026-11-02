// Scramble-diagram box probe: the paintable is parsed once at the SVG's own
// size, and the box the picture is drawn into (a Gtk.Overlay whose spacer is
// the only size request) follows the layout's cap, trimmed to the picture's
// own aspect. Nothing here re-parses on a cap change, which is what makes a
// resize free.
//
// Usage (any display; it only measures):
//   DISPLAY=:99 GDK_BACKEND=x11 node --import tsx --import node-gtk/register \
//     tools/diagram_box_probe.mjs
import Gtk from 'gi:Gtk-4.0'
import GLib from 'gi:GLib-2.0'
Gtk.init()

const { createScramblePanel } = await import('../src/ui/scramblePanel.ts')

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" ' +
  'viewBox="0 0 400 300"><rect width="400" height="300" fill="#9ab"/></svg>'

const panel = createScramblePanel({ getImage: () => SVG })

const natural = (orientation) => panel.image.measure(orientation, -1)[1]
/** measure() counts the box's own margins, which are part of the layout. */
const MARGIN = 16

const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok })
  console.error(`[d] ${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`)
}

panel.render({ type: '333', scramble: "R U R' U'", error: null })
check('no cap yet → the box is hidden', panel.image.getVisible() === false)

panel.setDiagramMax(180, 150)
check('a cap shows the box', panel.image.getVisible() === true)
check(
  'the box asks the cap (+ its margin), not the SVG’s 400×300',
  natural(Gtk.Orientation.HORIZONTAL) === 180 + MARGIN &&
    natural(Gtk.Orientation.VERTICAL) === 150 + MARGIN,
  `${natural(Gtk.Orientation.HORIZONTAL)}×${natural(Gtk.Orientation.VERTICAL)}`,
)

panel.setDiagramMax(320, 240)
check(
  'a new cap moves the box, with no repaint of the SVG',
  natural(Gtk.Orientation.HORIZONTAL) === 320 + MARGIN,
  String(natural(Gtk.Orientation.HORIZONTAL)),
)
check(
  'the paintable keeps the SVG’s own size',
  (() => {
    const paintable = panel.image.getLastChild().getPaintable()
    return (
      paintable !== null &&
      paintable.getIntrinsicWidth() === 400 &&
      paintable.getIntrinsicHeight() === 300
    )
  })(),
)

panel.setDiagramMax(400, 150)
check(
  'a 2:1 cap is trimmed to the picture’s own aspect (4:3)',
  natural(Gtk.Orientation.HORIZONTAL) === Math.round(150 * (400 / 300)) + MARGIN,
  `${natural(Gtk.Orientation.HORIZONTAL)}×${natural(Gtk.Orientation.VERTICAL)}`,
)

panel.setDiagramMax(0, 0)
check('a zero cap hides it again', panel.image.getVisible() === false)

// csTimer declares 74 of its 177 images with a fractional size (4x4 is
// 526×392.667) while Gtk.Svg reports whole px. An exact parse check hid all of
// them, so this case is the regression guard.
{
  const fractional = createScramblePanel({
    getImage: () =>
      '<svg xmlns="http://www.w3.org/2000/svg" width="526" height="392.667" ' +
      'viewBox="0 0 526 392.667"><rect width="526" height="392.667" fill="#9ab"/></svg>',
  })
  fractional.setDiagramMax(180, 150)
  fractional.render({ type: '444wca', scramble: 'R U', error: null })
  check(
    'a fractional declared size still renders',
    fractional.image.getVisible() === true &&
      fractional.image.getLastChild().getPaintable() !== null,
  )
}

panel.setDiagramMax(200, 120)
panel.setChromeVisible(false)
check('the timer view hides it', panel.image.getVisible() === false)
panel.setChromeVisible(true)
check('…and restores it', panel.image.getVisible() === true)

// A press over the picture must reach the content's timer gesture, not stop
// on the box: the picture, the spacer and the box itself are all
// non-targetable, so a pick over the picture lands on what is behind it.
{
  const host = new Gtk.Box()
  host.append(panel.image)
  const window = new Gtk.Window({ child: host, defaultWidth: 800, defaultHeight: 600 })
  window.present()
  const context = GLib.MainContext.default()
  for (let i = 0; i < 100 && panel.image.getWidth() === 0; i++) context.iteration(false)
  const bounds = panel.image.computeBounds(window)
  const pick = window.pick(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
    Gtk.PickFlags.DEFAULT,
  )
  check(
    'the box is not a pointer target (presses reach the timer gesture)',
    pick === host,
    pick === null ? 'null' : pick.constructor.name,
  )
  window.destroy()
}

const failed = checks.filter((c) => !c.ok)
console.error(failed.length === 0 ? '[d] ALL PASS' : `[d] ${failed.length} FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
