/*
 * stats_probe.mjs — the Statistics dialog builds and holds its three tabs.
 *
 * Checks structure, not pixels (AGENTS.md): the averages table grew the long
 * windows, the Records tab has one expander per kind with a history inside,
 * and the Activity tab has the summary grid plus fourteen day rows with level
 * bars. It also switches tabs through Adw.ViewStack by name, which is the
 * plumbing a user's click goes through.
 *
 * Run:
 *   GDK_BACKEND=x11 node --import tsx --import node-gtk/register tools/stats_probe.mjs
 */
import Adw from 'gi:Adw-1'
import Gio from 'gi:Gio-2.0'
import GLib from 'gi:GLib-2.0'

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
    check(stack?.getPages()?.getNItems() === 3, 'three stack pages')

    const switchers = findAll(dialog, 'AdwViewSwitcher')
    check(switchers.length === 1, 'one AdwViewSwitcher in the header')
    check(
      switchers[0]?.policy === Adw.ViewSwitcherPolicy.WIDE,
      'the switcher starts wide',
    )

    const text = labels(dialog)
    for (const wanted of ['Summary', 'Records', 'Activity', 'ao50', 'ao100', 'ao1000', 'Spread', 'Total time', 'Worst', 'Range', 'σ']) {
      check(text.includes(wanted), `label "${wanted}" is present`)
    }

    const groups = findAll(dialog, 'AdwPreferencesGroup')
    const groupTitles = groups.map((group) => group.title)
    check(groupTitles.includes('Personal bests'), `records group is present (${groupTitles.join(' | ')})`)
    check(groupTitles.includes('Recent days'), 'activity group is present')

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

    const bars = findAll(dialog, 'GtkLevelBar')
    check(bars.length === 14, `fourteen day bars (${bars.length})`)
    check(
      bars.every((bar) => bar.maxValue >= bar.value && bar.value >= 0),
      'every bar is within its range',
    )

    // Tab switching by name is what a click on the switcher does.
    for (const name of ['records', 'activity', 'summary']) {
      stack.setVisibleChildName(name)
      check(stack.visibleChildName === name, `switched to ${name}`)
    }

    check(
      text.includes('60 solves'),
      'the summary counts the whole session',
    )

    dialog.close()
    GLib.idleAdd(GLib.PRIORITY_DEFAULT, () => {
      if (failures > 0) log(`${failures} FAILURE(S)`)
      else log('ALL PASS')
      log(`exit ${failures === 0 ? 0 : 1}`)
      app.quit()
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
