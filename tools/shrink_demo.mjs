/*
 * shrink_demo.mjs — five selector options, side by side, for looking at.
 *
 * Goal (user call, 2026-10-03): the selectors stay **in the header bar** —
 * this demo deliberately does NOT apply layoutFor's selectorRow rule, so every
 * option can be dragged narrow and judged by eye. Testing which ones prevent
 * the window reaching 600px is the user's to do, not the demo's.
 *
 * No maximum width anywhere: every option just lets its label ellipsize, so
 * the widget shrinks instead of pinning the header.
 *
 * Each window shows its current width plus the header's natural and minimum
 * widths — the two numbers that decide how far it can go.
 *
 *   DISPLAY=:99 node --import tsx --import node-gtk/register tools/shrink_demo.mjs
 */
import Gtk from 'gi:Gtk-4.0'
import Adw from 'gi:Adw-1'
import GLib from 'gi:GLib-2.0'

const { SCRAMBLE_GROUPS, scrambleTypeLabel } = await import('../src/core/scrambleTypes.ts')
const { makeStringExpression } = await import('../src/ui/stringExpression.ts')
const { createScrambleTypePicker } = await import('../src/ui/scrambleTypePicker.ts')
const { BREAKPOINTS } = await import('../src/core/layout.ts')

Gtk.init()

const longest = (xs, f) => xs.reduce((a, b) => (f(a).length >= f(b).length ? a : b))
const group = longest(SCRAMBLE_GROUPS, (g) => g.name)
const choice = longest(group.choices, (c) => c.label)
const combined = scrambleTypeLabel(choice.id)
const groupIdx = SCRAMBLE_GROUPS.indexOf(group)
const choiceIdx = group.choices.indexOf(choice)

let currentType = choice.id
const syncs = []
const onChange = (id) => {
  currentType = id
  for (const s of syncs) s(id)
}

const dd = (labels, idx) => {
  const d = Gtk.DropDown.new(Gtk.StringList.new(labels), makeStringExpression())
  d.selected = idx
  return d
}
const twoDropdowns = () => {
  const box = Gtk.Box.new(Gtk.Orientation.HORIZONTAL, 6)
  box.append(dd(SCRAMBLE_GROUPS.map((g) => g.name), groupIdx))
  box.append(dd(group.choices.map((c) => c.label), choiceIdx))
  return box
}

/** ellipsize lets the label shrink; NO maxWidthChars, natural width untouched. */
const ellipFactory = () => {
  const f = new Gtk.SignalListItemFactory()
  f.on('setup', (li) => li.setChild(new Gtk.Label({ xalign: 0, ellipsize: 3 })))
  f.on('bind', (li) => {
    const item = li.item // node-gtk passes only the listItem
    li.getChild().label = (item && item.string) || ''
  })
  return f
}
const twoEllipsized = () => {
  const box = Gtk.Box.new(Gtk.Orientation.HORIZONTAL, 6)
  const c = dd(SCRAMBLE_GROUPS.map((g) => g.name), groupIdx)
  const t = dd(group.choices.map((c) => c.label), choiceIdx)
  c.factory = ellipFactory()
  c.listFactory = ellipFactory()
  t.factory = ellipFactory()
  t.listFactory = ellipFactory()
  box.append(c)
  box.append(t)
  return box
}

const OPTIONS = [
  {
    key: 'A',
    name: 'A · two dropdowns (today)',
    note: 'No ellipsize — labels cannot shrink, min = natural.',
    makeWidget: () => twoDropdowns(),
  },
  {
    key: 'A2',
    name: 'A2 · two dropdowns, ellipsize only',
    note: 'Identical natural width; labels just allowed to ellipsise. No cap.',
    makeWidget: () => twoEllipsized(),
  },
  {
    key: 'D',
    name: 'D · single ButtonRow',
    note: 'Your idea. AdwButtonRow ellipsises its own title already.',
    makeWidget: () => new Adw.ButtonRow({ title: combined, useMarkup: false }),
  },
  {
    key: 'J',
    name: 'J · one button → picker dialog',
    note: 'Label we own, ellipsize only. Click it for the real dialog.',
    makeWidget: (win, register) => {
      const text = new Gtk.Label({ label: combined, xalign: 0, ellipsize: 3 })
      const button = new Gtk.Button({ child: text, cssClasses: ['flat'] })
      const picker = createScrambleTypePicker({ initialType: currentType, onChange, window: win })
      picker.selectType(currentType)
      register.push((id) => picker.selectType(id))
      button.on('clicked', () => picker.open())
      return button
    },
  },
  {
    key: 'G',
    name: 'G · MenuButton, ellipsize only',
    note: 'Same label as J in a MenuButton shell; no dialog wired.',
    makeWidget: () =>
      new Gtk.MenuButton({ child: new Gtk.Label({ label: combined, xalign: 0, ellipsize: 3 }) }),
  },
  {
    // Nautilus' idea (nautilus-pathbar.c wraps its buttons in a
    // GtkScrolledWindow): let the *scroller* absorb the shortage instead of
    // the label. The button keeps its full width and no scrollbar is drawn in
    // the header.
    //
    // hscrollbarPolicy is EXTERNAL, not NEVER — the docs distinguish them and
    // it decides whether the window can shrink at all (measured):
    //   NEVER     "in this mode the content determines the size" → min pins 734
    //   EXTERNAL  "don't show a scrollbar, but don't force the size to follow
    //              the content" → no bar drawn, min 320 (lowest of any config)
    //
    // propagateNaturalWidth is what keeps natural at the button's full width:
    // without it a scroller reports ~46px and the header hides the button
    // (measured with the earlier two-dropdown scroller).
    key: 'S',
    name: 'S · scroller, no scrollbar, MenuButton inside',
    note:
      'EXTERNAL policy: no bar drawn, min free to shrink. Full text is kept — ' +
      'squeeze the window and it clips rather than ellipsising.',
    makeWidget: (win, register) => {
      const button = new Gtk.MenuButton({
        child: new Gtk.Label({ label: combined, xalign: 0 }),
        tooltipText: 'Choose the scramble type',
      })
      const picker = createScrambleTypePicker({ initialType: currentType, onChange, window: win })
      picker.selectType(currentType)
      register.push((id) => picker.selectType(id))
      // A MenuButton with no popover pops nothing, so open the dialog from a
      // gesture — keeps S clickable like J.
      const press = new Gtk.GestureClick()
      press.on('pressed', () => picker.open())
      button.addController(press)

      return new Gtk.ScrolledWindow({
        child: button,
        hscrollbarPolicy: Gtk.PolicyType.EXTERNAL,
        vscrollbarPolicy: Gtk.PolicyType.NEVER,
        propagateNaturalWidth: true,
        hasFrame: false,
      })
    },
  },
]

const app = new Adw.Application({ applicationId: 'org.cstimer.gtk.shrinkdemo' })
let started = false

app.on('activate', () => {
  if (started) return
  started = true
  const { minWidth, minHeight } = BREAKPOINTS

  for (const opt of OPTIONS) {
    const win = new Adw.ApplicationWindow({ application: app, defaultWidth: 900, defaultHeight: 540 })
    win.setTitle(`csTimer shrink · ${opt.key}`)

    // --- header: chrome + the selectors, which stay here --------------------
    const header = new Adw.HeaderBar({ showTitle: false })
    header.packStart(new Gtk.ToggleButton({ iconName: 'sidebar-show-symbolic' }))
    const selectors = opt.makeWidget(win, syncs)
    header.packStart(selectors)
    const refresh = new Gtk.Button({ iconName: 'view-refresh-symbolic' })
    const copy = new Gtk.Button({ iconName: 'edit-copy-symbolic' })
    header.packStart(refresh)
    header.packStart(copy)
    header.packEnd(new Gtk.MenuButton({ iconName: 'open-menu-symbolic' }))

    const verdict = new Gtk.Label({
      xalign: 0, wrap: true, cssClasses: ['heading'],
      marginStart: 18, marginEnd: 18, marginTop: 12,
    })
    const note = new Gtk.Label({ label: opt.note, xalign: 0, wrap: true, marginStart: 18, marginEnd: 18, marginTop: 6 })
    const body = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 4, vexpand: true })
    body.append(verdict)
    body.append(note)
    body.append(new Gtk.Label({
      label: `Drag narrower: labels should ellipsize, and the window should reach 600×${minHeight}.`,
      xalign: 0, wrap: true, marginStart: 18, marginEnd: 18, marginTop: 6, cssClasses: ['dim-label'],
    }))
    body.append(new Gtk.Label({ label: '0.00', cssClasses: ['title-1'], vexpand: true, halign: Gtk.Align.CENTER }))

    const root = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
    root.append(header)
    root.append(body)
    win.setContent(root)
    win.present()

    // Selectors stay in the header — deliberately no selectorRow reparenting
    // here. This demo exists to show each option's header widgets as they are,
    // so they can be dragged narrow and judged by eye (user call, 2026-10-03).
    const update = () => {
      const surface = win.getSurface()
      const w = surface ? surface.getWidth() : 900
      if (w <= 0) return
      const [min, nat] = header.measure(Gtk.Orientation.HORIZONTAL, -1)
      const text =
        `${opt.name}\n` +
        `window ${w}px · selectors in the header\n` +
        `header natural ${nat}px · header min ${min}px`
      verdict.setLabel(text)
      // Log the exact string each window shows: grabs of stacked windows on
      // Xephyr keep returning the wrong window's frame, so the log is the only
      // trustworthy readout (AGENTS trap 4).
      const line = `${opt.key}: w=${w} nat=${nat} min=${min}`
      if (line !== opt.lastLine) {
        opt.lastLine = line
        console.error(`[state] ${line}`)
      }
    }
    update()
    const surface = win.getSurface()
    if (surface) surface.on('layout', update)
  }

  console.error(`[demo] ${OPTIONS.length} windows — selectors stay in the header, no width caps`)
  console.error(`[demo] worst case: "${group.name}" + "${choice.label}"`)
  console.error(`[demo] drag each narrower and judge which reach 600px`)
})

app.run([])
