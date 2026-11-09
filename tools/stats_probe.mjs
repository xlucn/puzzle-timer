/*
 * stats_probe.mjs — the Statistics dialog builds and holds its three tabs.
 *
 * Checks structure, not pixels (AGENTS.md): the averages table grew the long
 * windows, the Records tab has one expander per kind with a history inside,
 * and the Activity tab has the figures plus a thirteen-week calendar heat map
 * with a Less/More legend. Every tab carries a theme icon. It also switches tabs through Adw.ViewStack by
 * name, which is the plumbing a user's click goes through.
 *
 * Run:
 *   GDK_BACKEND=x11 node --import tsx --import node-gtk/register tools/stats_probe.mjs
 */
import Adw from 'gi:Adw-1'
import Gio from 'gi:Gio-2.0'
import GLib from 'gi:GLib-2.0'
import Gtk from 'gi:Gtk-4.0'

import { setLocale } from '../src/core/i18n.js'
import { Session } from '../src/core/session.js'
import { createStatsPanel } from '../src/ui/statsPanel.js'

setLocale('en')

const log = (...args) => console.error('[stats]', ...args)
let failures = 0
const check = (ok, what) => {
  log(`${ok ? 'PASS' : 'FAIL'} — ${what}`)
  if (!ok) failures += 1
}

const walk = (root, visit) => {
  if (root === null || root === undefined) return
  visit(root)
  let child = root.getFirstChild?.() ?? null
  while (child !== null) {
    walk(child, visit)
    child = child.getNextSibling?.() ?? null
  }
}

const labels = (root) => {
  const out = []
  walk(root, (node) => {
    if (node.constructor.name === 'GtkLabel' && typeof node.label === 'string') {
      if (node.label.length > 0) out.push(node.label)
    }
  })
  return out
}

const findAll = (root, typeName) => {
  const out = []
  walk(root, (node) => {
    if (node.constructor.name === typeName) out.push(node)
  })
  return out
}

const ancestorOf = (widget, typeName) => {
  let node = widget?.getParent?.() ?? null
  while (node !== null && node.constructor.name !== typeName) node = node.getParent?.() ?? null
  return node
}

const app = new Adw.Application({
  applicationId: 'io.github.xlucn.PuzzleTimer.probe.stats',
  flags: Gio.ApplicationFlags.FLAGS_NONE,
})

app.on('activate', () => {
  const window = new Adw.ApplicationWindow({ application: app })
  window.setDefaultSize(900, 540)

  // A small but non-trivial session: three local days, mixed times, a DNF,
  // and enough solves for an ao50 to exist.
  const session = new Session()
  const now = new Date()
  for (let i = 0; i < 60; i += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (i % 3), 12, 0, 0)
    session.add({
      // Mostly improving: every finite solve below sets a new single PB, so
      // the Records tab has a real history to expand, not one row.
      timeMs: 15_000 - i * 50,
      scramble: 'R U',
      scrambleType: '333',
      createdAtMs: day.getTime() + i,
      penalty: i === 7 ? 'dnf' : undefined,
    })
  }

  const { open } = createStatsPanel({ app, window, getSession: () => session })
  const dialog = open()

  dialog.on('map', () => {
    const stacks = findAll(dialog, 'AdwViewStack')
    check(stacks.length === 1, `one AdwViewStack (${stacks.length})`)
    const stack = stacks[0]
    check(stack?.getPages()?.getNItems() === 4, 'four stack pages')

    const pages = stack.getPages()
    const icons = []
    for (let i = 0; i < pages.getNItems(); i += 1) icons.push(pages.getItem(i).iconName)
    check(
      icons.join(' ') === 'view-grid-symbolic starred-symbolic document-open-recent-symbolic view-app-grid-symbolic',
      `each tab carries its icon (${icons.join(' ')})`,
    )
    const theme = Gtk.IconTheme.getForDisplay(dialog.getDisplay())
    check(
      icons.every((name) => theme.hasIcon(name)),
      `every tab icon resolves in the active theme (${theme.getThemeName()})`,
    )

    // AdwViewSwitcherBar carries its own internal AdwViewSwitcher, so find
    // the header one by its ancestor rather than by count.
    const headerSwitcher = findAll(dialog, 'AdwViewSwitcher').find(
      (widget) => ancestorOf(widget, 'AdwHeaderBar') !== null,
    )
    const switcherBars = findAll(dialog, 'AdwViewSwitcherBar')
    check(headerSwitcher !== undefined, 'one AdwViewSwitcher in the header')
    check(switcherBars.length === 1, `one AdwViewSwitcherBar at the bottom (${switcherBars.length})`)
    check(headerSwitcher?.visible === true, 'the header switcher starts visible')
    check(
      headerSwitcher?.policy === Adw.ViewSwitcherPolicy.WIDE,
      `the header switcher is wide (${headerSwitcher?.policy})`,
    )
    check(switcherBars[0]?.reveal === false, 'the bottom bar starts hidden')
    check(
      headerSwitcher?.stack === stack && switcherBars[0]?.stack === stack,
      'both switchers point at the same stack',
    )
    const headerBar = ancestorOf(headerSwitcher, 'AdwHeaderBar')
    check(headerBar?.getTitleWidget?.() === headerSwitcher, 'the header owns the switcher at first')

    const text = labels(dialog)
    for (const wanted of ['Summary', 'Records', 'Activity', 'Charts', 'Time distribution', 'Time trend', 'ao50', 'ao100', 'ao1000', 'Total time', 'Recent days', 'Overview', 'Less', 'More']) {
      check(text.includes(wanted), `label "${wanted}" is present`)
    }

    const tables = findAll(dialog, 'GtkColumnView')
    check(tables.length === 1, `one summary ColumnView (${tables.length})`)
    const table = tables[0]
    if (table !== undefined) {
      check(table.getColumns().getNItems() === 4, 'the summary has four columns')
      const titles = []
      for (let i = 0; i < table.getColumns().getNItems(); i += 1) {
        titles.push(table.getColumns().getItem(i).title)
      }
      check(
        titles.join('|') === '|Current|Best|Target',
        `the column titles are Current, Best and Target (${titles.join('|')})`,
      )
      check(table.getModel()?.getNItems() === 8, 'the table has seven kinds plus the mean')
      check(table.getShowRowSeparators() === true, 'the table shows row separators')
      check(table.getHexpand() === true, 'the table expands to both sides')
      const expands = []
      for (let i = 0; i < table.getColumns().getNItems(); i += 1) {
        expands.push(table.getColumns().getItem(i).getExpand())
      }
      check(
        expands.join('|') === 'false|true|true|true',
        `the three value columns take the extra width (${expands.join('|')})`,
      )
    }

    const groups = findAll(dialog, 'AdwPreferencesGroup')
    const groupTitles = groups.map((group) => group.title)
    check(groupTitles.includes('Summary'), `summary group is present (${groupTitles.join(' | ')})`)
    check(groupTitles.includes('Personal bests'), `records group is present (${groupTitles.join(' | ')})`)

    // The Activity tab is two Adw.PreferencesGroup sections: the heat map,
    // then the figures.
    const activitySections = groups.filter(
      (group) => group.title === 'Recent days' || group.title === 'Overview',
    )
    check(activitySections.length === 2, `two Activity sections (${activitySections.length})`)
    check(
      activitySections[0]?.title === 'Recent days' &&
        activitySections[1]?.title === 'Overview',
      `Recent days leads the tab (${activitySections.map((group) => group.title).join(' | ')})`,
    )

    const activityList = findAll(dialog, 'GtkListBox').find((list) => {
      for (let i = 0; ; i += 1) {
        const row = list.getRowAtIndex(i)
        if (row === null) return false
        if (row.constructor.name === 'AdwActionRow' && row.title === 'Solves') return true
      }
    })
    check(activityList !== undefined, 'the overview figures are a Gtk.ListBox')
    if (activityList !== undefined) {
      let rows = 0
      while (activityList.getRowAtIndex(rows) !== null) rows += 1
      check(rows === 10, `it holds the ten figures (${rows})`)
      check(
        activityList.selectionMode === Gtk.SelectionMode.NONE,
        'the list is not selectable',
      )
      const firstRow = activityList.getRowAtIndex(0)
      check(
        firstRow?.constructor.name === 'AdwActionRow' && firstRow?.title === 'Solves',
        'the figures start with the solve count',
      )
      const timeRow = activityList.getRowAtIndex(1)
      check(
        timeRow?.constructor.name === 'AdwActionRow' && timeRow?.title === 'Total time',
        'total time moved to the Activity figures',
      )
    }

    const expanders = findAll(dialog, 'AdwExpanderRow')
    check(expanders.length === 7, `one ExpanderRow per record kind (${expanders.length})`)
    check(
      expanders.every((row) => typeof row.subtitle === 'string' && row.subtitle.length > 0),
      'every record row has a status line',
    )
    const single = expanders[0]
    check(
      single !== undefined && /Set .*still standing/.test(single.subtitle),
      `single PB reads as set and current (${single?.subtitle})`,
    )
    check(single?.enableExpansion === true, 'the single PB has a history to expand')
    if (single !== undefined) {
      const before = findAll(single, 'AdwActionRow').length
      single.expanded = true
      const after = findAll(single, 'AdwActionRow').length
      check(single.expanded === true, 'the single PB expands')
      check(after > before, `expanding builds its history rows (${before} → ${after})`)
    }

    const heatCells = findAll(dialog, 'GtkBox').filter(
      (box) =>
        box.getCssClasses().includes('heatmap-cell') &&
        box.getParent()?.constructor.name === 'GtkGrid',
    )
    check(heatCells.length === 91, `a 13-week heat map has 91 cells (${heatCells.length})`)
    check(
      heatCells.every((box) =>
        box.getCssClasses().some((name) => /^level-[0-4]$/.test(name)),
      ),
      'every heat-map cell has a level class',
    )
    const future = heatCells.filter((box) => box.getCssClasses().includes('future'))
    const dated = heatCells.filter((box) => !box.getCssClasses().includes('future'))
    check(
      dated.every((box) => typeof box.getTooltipText() === 'string' && box.getTooltipText().length > 0),
      'every in-range cell has a dated tooltip',
    )
    check(
      dated.some((box) => !box.getCssClasses().includes('level-0')),
      'at least one cell is coloured',
    )
    check(future.length < 91 && future.every((box) => box.getCssClasses().includes('level-0')), 'future days stay blank')
    const legendCells = findAll(dialog, 'GtkBox').filter(
      (box) => box.widthRequest === 11 && box.getCssClasses().includes('heatmap-cell'),
    )
    check(legendCells.length === 5, `the legend has five swatches (${legendCells.length})`)

    const drawings = findAll(dialog, 'GtkDrawingArea')
    check(drawings.length === 2, `two chart canvases (${drawings.length})`)
    check(
      drawings.map((area) => area.name).sort().join('|') === 'histogram-chart|trend-chart',
      `the chart canvases are named (${drawings.map((area) => area.name).join(', ')})`,
    )
    check(
      drawings.every((area) => area.heightRequest === 170),
      'both charts reserve their drawing height',
    )

    // Tab switching by name is what a click on the switcher does.
    for (const name of ['records', 'activity', 'charts', 'summary']) {
      stack.setVisibleChildName(name)
      check(stack.visibleChildName === name, `switched to ${name}`)
    }

    check(
      text.some((label) => label.includes('60 solves')),
      'the summary counts the whole session',
    )

    // Narrow the dialog and let the breakpoint run: the header switcher must
    // give way to the bottom bar, the pattern AdwViewSwitcher documents.
    dialog.contentWidth = 360
    GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 500, () => {
      const narrowTitle = findAll(dialog, 'AdwWindowTitle')[0]
      check(narrowTitle?.title === 'Statistics', 'the narrow header has a title')
      check(
        headerBar?.getTitleWidget?.() === narrowTitle,
        'narrowing shows the Statistics title in the header',
      )
      check(switcherBars[0]?.reveal === true, 'narrowing reveals the bottom bar')
      // The Activity page is hidden while Summary is selected, so it has no
      // allocation yet: show it, let GTK lay it out, then measure the cells.
      stack.setVisibleChildName('activity')
      GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 300, () => {
        let sizes = [...new Set(heatCells.map((box) => `${box.getWidth()}x${box.getHeight()}`))]
        check(
          sizes.length === 1 &&
            heatCells[0].getWidth() === heatCells[0].getHeight() &&
            heatCells[0].getWidth() >= 14,
          `every heat-map cell is one size and square (${sizes.join(', ')})`,
        )
        const narrowCell = heatCells[0].getWidth()
        const grid = heatCells[0]?.getParent()
        const heatBox = grid?.getParent()
        check(grid?.getHexpand() === true, 'the heat map fills its card width')
        check(
          grid !== null && grid !== undefined && grid.getWidth() > 280,
          `the grid spreads into the extra width (${grid?.getWidth()})`,
        )
        check(
          heatBox?.getHalign() === Gtk.Align.FILL,
          'the heat map box stretches from side to side',
        )
        dialog.contentWidth = 480
        GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 500, () => {
          check(
            headerBar?.getTitleWidget?.() === headerSwitcher,
            'widening restores the switcher in the header',
          )
          check(switcherBars[0]?.reveal === false, 'widening hides the bottom bar')
          sizes = [...new Set(heatCells.map((box) => `${box.getWidth()}x${box.getHeight()}`))]
          check(
            sizes.length === 1 &&
              heatCells[0].getWidth() === heatCells[0].getHeight() &&
              heatCells[0].getWidth() > narrowCell,
            `widening grows the squares, not the gaps (${narrowCell} → ${heatCells[0].getWidth()})`,
          )
          stack.setVisibleChildName('charts')
          GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 500, () => {
            check(
              drawings.every((area) => area.getWidth() > 0 && area.getHeight() > 0),
              `both charts are laid out and draw (${drawings.map((area) => `${area.getWidth()}x${area.getHeight()}`).join(', ')})`,
            )
            dialog.close()
            GLib.idleAdd(GLib.PRIORITY_DEFAULT, () => {
              if (failures > 0) log(`${failures} FAILURE(S)`)
              else log('ALL PASS')
              log(`exit ${failures === 0 ? 0 : 1}`)
              app.quit()
              return GLib.SOURCE_REMOVE
            })
            return GLib.SOURCE_REMOVE
          })
          return GLib.SOURCE_REMOVE
        })
        return GLib.SOURCE_REMOVE
      })
      return GLib.SOURCE_REMOVE
    })
    return false
  })

  // node-gtk requires the close-request emission to yield a Boolean; without
  // it the probe ends in a TypeError after the PASSes (same as prefs_probe).
  window.on('close-request', () => false)
  window.present()
})

app.run(['stats_probe'])
