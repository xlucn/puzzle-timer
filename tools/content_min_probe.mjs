// Content-min probe (2026-10-15): the AdwToastOverlay height warning at the
// 294 floor — the main content stack's minimum (Adw reported 300) broken
// down per widget, at the widths that matter. Headless: measure() only.
//
// Usage: node --import tsx --import node-gtk/register tools/content_min_probe.mjs
import Adw from 'gi:Adw-1'
import Gtk from 'gi:Gtk-4.0'
Gtk.init()

const base = '../src/ui'
const { createScramblePanel } = await import(`${base}/scramblePanel.ts`)
const { createTimerView } = await import(`${base}/timerLabel.ts`)
const { createStatsStrip } = await import(`${base}/statsStrip.ts`)
const { createScrambleTypeButton } = await import(`${base}/scrambleTypeButton.ts`)
const { createScrambleTypeTitle } = await import(`${base}/scrambleTypeTitle.ts`)
const { SCRAMBLE_DEFAULT_TYPE } = await import('../src/core/scrambleTypes.ts')

const statsStrip = createStatsStrip({
  library: { subscribe: () => () => {} },
  getSession: () => ({ solves: [], subscribe: () => () => {} }),
})
const timerView = createTimerView({ statsStrip })
const scramblePanel = createScramblePanel({ getImage: () => null })
const typeButton = createScrambleTypeButton({ onActivate: () => {} })

const typeTitle = createScrambleTypeTitle({ initialType: SCRAMBLE_DEFAULT_TYPE })
const header = new Adw.HeaderBar()
header.titleWidget = typeTitle.widget
const selectorBar = new Gtk.Box({
  orientation: Gtk.Orientation.HORIZONTAL,
  cssClasses: ['toolbar'],
  marginStart: 12,
  marginEnd: 12,
})
selectorBar.append(new Gtk.Button({ iconName: 'view-refresh-symbolic', cssClasses: ['flat'] }))
selectorBar.append(new Gtk.Button({ iconName: 'edit-copy-symbolic', cssClasses: ['flat'] }))
selectorBar.append(typeButton.widget)
selectorBar.append(new Gtk.ToggleButton({ iconName: 'image-x-generic-symbolic', cssClasses: ['flat'] }))

const mainContent = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
mainContent.append(scramblePanel.widget)
mainContent.append(timerView.widget)

const content = new Adw.ToolbarView({
  content: mainContent,
  revealBottomBars: true, // selectorRow — the failing configuration
  topBarStyle: Adw.ToolbarStyle.FLAT,
  bottomBarStyle: Adw.ToolbarStyle.FLAT,
})
content.addTopBar(header)
content.addBottomBar(selectorBar)
const viewOverlay = new Gtk.Overlay({ child: content })
viewOverlay.addOverlay(scramblePanel.image)
const split = new Adw.OverlaySplitView({ content: viewOverlay, sidebar: new Gtk.Box(), collapsed: true })
const toast = new Adw.ToastOverlay({ child: split })

const mn = (w, or, forSize) => {
  const [min, nat] = w.measure(or, forSize)
  return { min, nat }
}
const line = (name, w, forSize) => {
  const v = mn(w, Gtk.Orientation.VERTICAL, forSize)
  console.error(`[c] ${name.padEnd(22)} min ${String(v.min).padStart(4)}  nat ${String(v.nat).padStart(4)}`)
  return v.min
}

for (const width of [505, 480, 360]) {
  console.error(`[c] ---- width ${width} ----`)
  timerView.setSize('s') // tier: window 294 ≤ timerSmallMaxHeight
  scramblePanel.setLimits(60, 100) // tier: short window
  // The real strip renders values (the replica's subscribe was a stub):
  // .stats-value's line is taller than an empty label — this is the gap
  // between the replica's 287 and the app's reported 300.
  {
    let strip = null
    for (let c = timerView.widget.getFirstChild(); c; c = c.getNextSibling()) {
      if (c.constructor.name === 'GtkBox') strip = c
    }
    for (let cell = strip.getFirstChild(); cell; cell = cell.getNextSibling()) {
      for (let l = cell.getFirstChild(); l; l = l.getNextSibling()) {
        if (l.label === '' || l.label === undefined) l.setLabel('12.34')
      }
    }
  }
  const total = line('TOAST (the stack)', toast, width)
  line('header', header, width)
  line('selectorBar', selectorBar, width)
  line('scramblePanel.widget', scramblePanel.widget, width)
  const tMin = line('timerView.widget', timerView.widget, -1)
  // inside the timer: label / hint / statsStrip
  for (let c = timerView.widget.getFirstChild(); c; c = c.getNextSibling()) {
    line(`  timer > ${c.constructor.name}`, c, -1)
    if (c.constructor.name === 'GtkBox') {
      for (let g = c.getFirstChild(); g; g = g.getNextSibling()) {
        line(`    strip > ${g.constructor.name}`, g, -1)
      }
    }
  }
  // inside the panel: children of widget
  for (let c = scramblePanel.widget.getFirstChild(); c; c = c.getNextSibling()) {
    line(`  panel > ${c.constructor.name}`, c, width)
  }
  console.error(`[c] ---- width end ----`)
}
// Slot text probe: does the slot's MINIMUM grow with the wrapped text?
// (The steady total with a real scramble was 300 in the app vs 287 empty.)
const panelSlot = (() => {
  let scroll = null
  walkPanel: {
    const stack = [scramblePanel.widget]
    while (stack.length) {
      const w = stack.pop()
      if (w.constructor.name === 'GtkScrolledWindow') {
        scroll = w
        break walkPanel
      }
      let c = w.getFirstChild
        ? (() => {
            const kids = []
            let k = w.getFirstChild()
            while (k) {
              kids.push(k)
              k = k.getNextSibling()
            }
            return kids
          })()
        : []
      stack.push(...c)
    }
  }
  return scroll
})()
const textLabel = (() => {
  let l = null
  let k = panelSlot?.getFirstChild()
  const stack = k ? [k] : []
  while (stack.length) {
    const w = stack.pop()
    if (w.constructor.name === 'GtkLabel') {
      l = w
      break
    }
    let c = w.getFirstChild ? w.getFirstChild() : null
    while (c) {
      stack.push(c)
      c = c.getNextSibling()
    }
  }
  return l
})()
console.error(`[c] slot=${panelSlot?.constructor.name} text=${textLabel?.constructor.name}`)
// Horizontal: which piece demands the width (the floor warning at <410)?
{
  const h = (name, w, forSize) => {
    const [min, nat] = w.measure(Gtk.Orientation.HORIZONTAL, forSize)
    console.error(`[c] H ${name.padEnd(20)} min ${String(min).padStart(4)}  nat ${String(nat).padStart(5)}`)
  }
  textLabel.setLabel('Rw2 Fw2 U Lw2 D2 F2 Rw Uw F2 D L2 B2 R F2 U2 L'.slice(0, 60))
  h('TOAST', toast, -1)
  h('header (row)', header, -1)
  h('selectorBar', selectorBar, -1)
  h('typeButton', typeButton.widget, -1)
  h('scramblePanel', scramblePanel.widget, -1)
  h('timerView', timerView.widget, -1)
  h('statsStrip', statsStrip.widget, -1)
}
const forWidth = 505 - 36 // panel horizontal margins
for (const [name, text] of [
  ['empty', ''],
  ['3x3 (60ch)', 'Rw2 Fw2 U Lw2 D2 F2 Rw Uw F2 D L2 B2 R F2 U2 L'.slice(0, 60)],
  ['relay (~960ch)', 'Rw2 Fw2 U Lw2 D2 F2 '.repeat(48)],
]) {
  textLabel.setLabel(text)
  const [pMin, pNat] = scramblePanel.widget.measure(Gtk.Orientation.VERTICAL, forWidth)
  const [tMin] = toast.measure(Gtk.Orientation.VERTICAL, 505)
  console.error(`[c] text=${name.padEnd(12)} panel min ${pMin} nat ${pNat}   TOAST min ${tMin}`)
}
process.exit(0)
