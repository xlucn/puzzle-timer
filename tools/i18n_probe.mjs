/*
 * i18n_probe.mjs — the Chinese catalog reaches real widgets.
 *
 * The catalog typecheck says every key exists; this says the UI actually
 * calls `t()` while building. It sets the locale to zh-CN, builds the timer,
 * Preferences and the keyboard reference, and reads the labels back through
 * the widget tree.
 *
 * Usage:
 *   DISPLAY=:99 GDK_BACKEND=x11 node --import tsx --import node-gtk/register tools/i18n_probe.mjs
 */
import Adw from 'gi:Adw-1'
import Gio from 'gi:Gio-2.0'
import GLib from 'gi:GLib-2.0'
import Gtk from 'gi:Gtk-4.0'

import { setLocale } from '../src/core/i18n.js'
import { DEFAULT_PREFERENCES } from '../src/core/preferences.js'
import { Session } from '../src/core/session.js'
import { createPreferences } from '../src/ui/preferences.js'
import { createShortcutsDialog } from '../src/ui/shortcuts.js'
import { createStatsPanel } from '../src/ui/statsPanel.js'
import { createTimerView } from '../src/ui/timerLabel.js'

setLocale('zh-CN')

const log = (...args) => console.error('[i18n]', ...args)
let failures = 0
const check = (ok, what) => {
  log(`${ok ? 'PASS' : 'FAIL'} — ${what}`)
  if (!ok) failures += 1
}

const findRow = (root, title, typeName = null) => {
  if (root === null) return null
  const typeOk = typeName === null || root.constructor.name === typeName
  if (typeOk && root.getTitle?.() === title) return root
  let child = root.getFirstChild?.() ?? null
  while (child !== null) {
    const hit = findRow(child, title, typeName)
    if (hit !== null) return hit
    child = child.getNextSibling?.()
  }
  return null
}

const shownLabels = (root, out = []) => {
  if (root === null) return out
  if (root.visible === false) return out
  try {
    if (typeof root.label === 'string' && root.label.length > 0) out.push(root.label)
  } catch {
    /* not a label */
  }
  let child = root.getFirstChild?.() ?? null
  while (child !== null) {
    shownLabels(child, out)
    child = child.getNextSibling?.()
  }
  return out
}

const app = new Adw.Application({
  applicationId: 'io.github.xlucn.PuzzleTimer.probe.i18n',
  flags: Gio.ApplicationFlags.FLAGS_NONE,
})

app.on('activate', () => {
  const window = new Adw.ApplicationWindow({ application: app })
  window.setDefaultSize(900, 540)

  // ---- timer hint --------------------------------------------------------
  const timer = createTimerView()
  check(
    shownLabels(timer.widget).includes('按住空格或触摸屏幕开始'),
    `the idle hint is Chinese (${shownLabels(timer.widget).join(' | ')})`,
  )

  // ---- statistics tabs ---------------------------------------------------
  // The tab strip is the one part of the dialog that exists before any page
  // is visible, so it is a direct check that the new labels go through the
  // catalog, not just through the compiler.
  const statsDialog = createStatsPanel({
    app,
    window,
    getSession: () => new Session(),
  }).open()
  const statsChild = statsDialog.getChild?.() ?? null
  const statsLabels = shownLabels(statsChild)
  check(
    ['概览', '图表'].every((label) => statsLabels.includes(label)),
    `statistics tabs are Chinese (${statsLabels.filter((label) => ['概览', '图表'].includes(label)).join(' | ')})`,
  )
  statsDialog.close()

  // ---- preferences -------------------------------------------------------
  const { open } = createPreferences({
    app,
    window,
    get: () => DEFAULT_PREFERENCES,
    set: () => {},
  })
  const prefs = open()
  prefs.on('map', () => {
    check(prefs.title === '首选项', `dialog title is Chinese (${prefs.title})`)
    const page = prefs.getVisiblePage?.() ?? null
    check(page?.title === '计时器', `first page title is Chinese (${page?.title})`)
    const hold = findRow(prefs, '按住时长阈值')
    check(hold !== null, 'the hold-time row is found by its Chinese title')
    const language = findRow(prefs, '语言', 'AdwComboRow')
    check(language !== null, 'the language row is found by its Chinese title')
    if (language !== null) {
      check(
        shownLabels(language).includes('跟随系统'),
        `language choices are Chinese (${shownLabels(language).join(' | ')})`,
      )
    }

    // ---- shortcuts -------------------------------------------------------
    // The dialog renders its sections from a model when presented, so the
    // labels exist only after `map`.
    const shortcuts = createShortcutsDialog()
    let shortcutsDone = false
    const checkShortcuts = () => {
      if (shortcutsDone) return
      shortcutsDone = true
      const labels = shownLabels(shortcuts)
      check(shortcuts.title === '键盘快捷键', `shortcuts title is Chinese (${shortcuts.title})`)
      check(labels.includes('数据'), `the shortcuts dialog has the Data group (${labels.join(' | ')})`)
      check(
        labels.includes('从 csTimer 导入') && labels.includes('导出到 csTimer'),
        'the import and export shortcuts are listed',
      )
      finish()
    }
    shortcuts.on('map', checkShortcuts)
    GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 3000, () => {
      checkShortcuts()
      return false
    })
    shortcuts.present(window)
  })

  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`)
    app.quit()
  }

  window.on('close-request', () => false)
  window.present()
})

app.run([])
