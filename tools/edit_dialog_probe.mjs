// Edit-dialog probe v5 (2026-10-15): Adw.Dialog + header bar, boxed-list
// rows (Date+copy / Scramble → ExpanderRow when long / Penalty /
// Comment), title carrying the solve number, Return→save from outside the
// comment entry, discard path, and the form scroll view: the dialog clamps
// against a short parent (the window floor), the form scrolls beneath the
// fixed header, and the expander carries no scroller of its own.
//
// Usage: node --import tsx --import node-gtk/register tools/edit_dialog_probe.mjs
import Adw from 'gi:Adw-1'
import Gdk from 'gi:Gdk-4.0'
import Gtk from 'gi:Gtk-4.0'
import GLib from 'gi:GLib-2.0'
// The real formatter — the replica must not drift from the app's strings.
import { formatSolve } from '../src/core/time.js'
Gtk.init()
const app = new Adw.Application({ applicationId: 'io.github.xlucn.PuzzleTimer.probe.editdialog' })
const checks = []
const check = (name, ok) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${name}`)
const MAX_COMMENT_LENGTH = 500
// Relay-sized: 20 chars × 48 = 960, inside the measured 234567 range
// (943–1072, i.e. 17-19 wrapped lines) — drives the ExpanderRow path.
const SCRAMBLE_LONG = "Rw2 Fw2 U Lw' D2 F2 ".repeat(48)
// 3x3-sized — drives the plain-row path.
const SCRAMBLE_SHORT = "Rw Uw F2 D L2 B2 R' F2 U2 L'"

const walk = (root, fn) => {
  fn(root)
  let c = root.getFirstChild ? root.getFirstChild() : null
  while (c) {
    walk(c, fn)
    c = c.getNextSibling()
  }
}

const findCopy = (row) => {
  let btn = null
  walk(row, (w) => {
    if (w.constructor.name === 'GtkButton' && w.iconName === 'edit-copy-symbolic') btn = w
  })
  return btn
}

/** Replica of openEdit's dialog construction. */
function buildDialog(writes, win, scramble) {
  const TIME_MS = 12345 // formats to '12.34' (time.ts doc example)
  const datetime = '2026-10-10 21:03:15'
  const timeText = (penalty) =>
    penalty === 'dnf' ? `DNF(${formatSolve(TIME_MS)})` : formatSolve(TIME_MS, penalty)

  // mirror of openEdit's copy plumbing (main.ts's clipboard path)
  const copyToClipboard = (text) => {
    const bytes = GLib.Bytes.new(Array.from(new TextEncoder().encode(text)))
    win.getDisplay().getClipboard().setContent(Gdk.ContentProvider.newForBytes('text/plain;charset=utf-8', bytes))
  }
  const copySuffix = (text, tooltipText) => {
    const button = new Gtk.Button({
      iconName: 'edit-copy-symbolic',
      tooltipText,
      cssClasses: ['flat'],
      valign: Gtk.Align.CENTER,
    })
    button.on('clicked', () => copyToClipboard(text))
    return button
  }

  const penaltyGroup = new Adw.ToggleGroup({ valign: Gtk.Align.CENTER })
  penaltyGroup.add(new Adw.Toggle({ label: '_OK', name: 'ok', useUnderline: true }))
  penaltyGroup.add(new Adw.Toggle({ label: '+_2', name: 'plus2', useUnderline: true }))
  penaltyGroup.add(new Adw.Toggle({ label: '_DNF', name: 'dnf', useUnderline: true }))
  penaltyGroup.activeName = 'ok'
  const penaltyFromGroup = () => {
    const name = penaltyGroup.getActiveName()
    return name === 'plus2' || name === 'dnf' ? name : undefined
  }
  const penaltyRow = new Adw.ActionRow({ title: 'Penalty', halign: Gtk.Align.FILL })
  penaltyRow.addSuffix(penaltyGroup)

  const commentRow = new Adw.EntryRow({
    title: 'Comment',
    text: 'a bad lock',
    maxLength: MAX_COMMENT_LENGTH,
  })

  // mirrors timesList: plain row at/below EXPAND_SCRAMBLE_ABOVE (200),
  // ExpanderRow above it.
  const scrambleRow = (() => {
    if (scramble.length === 0) return null

    if (scramble.length <= 200) {
      const row = new Adw.ActionRow({
        title: 'Scramble',
        subtitle: scramble,
        halign: Gtk.Align.FILL,
        cssClasses: ['property'],
      })
      row.addSuffix(copySuffix(scramble, 'Copy the scramble'))
      return row
    }

    const row = new Adw.ExpanderRow({
      title: 'Scramble',
      subtitle: scramble,
      subtitleLines: 1,
      halign: Gtk.Align.FILL,
    })
    row.addSuffix(copySuffix(scramble, 'Copy the scramble'))
    row.addRow(
      new Gtk.ListBoxRow({
        child: new Gtk.Label({
          label: scramble,
          wrap: true,
          xalign: 0,
          marginStart: 12,
          marginEnd: 12,
          marginTop: 6,
          marginBottom: 6,
        }),
      }),
    )
    return row
  })()

  const dateRow = new Adw.ActionRow({
    title: 'Date',
    subtitle: datetime,
    halign: Gtk.Align.FILL,
    cssClasses: ['property'],
  })
  dateRow.addSuffix(copySuffix(datetime, 'Copy the date'))

  const formList = new Gtk.ListBox({ cssClasses: ['boxed-list'], selectionMode: Gtk.SelectionMode.NONE })
  formList.append(dateRow)
  if (scrambleRow !== null) formList.append(scrambleRow)
  formList.append(penaltyRow)
  formList.append(commentRow)

  const timeLabel = new Gtk.Label({
    label: timeText(undefined),
    halign: Gtk.Align.CENTER,
    cssClasses: ['title-1', 'numeric'],
  })
  penaltyGroup.on('notify::active', () => {
    timeLabel.label = timeText(penaltyFromGroup())
  })
  const form = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 12,
    marginStart: 12,
    marginEnd: 12,
    marginTop: 6,
    marginBottom: 12,
  })
  form.append(timeLabel)
  form.append(formList)

  const saveButton = new Gtk.Button({ label: 'Save', cssClasses: ['suggested-action'] })
  const header = new Adw.HeaderBar()
  header.packStart(saveButton)

  const scroller = new Gtk.ScrolledWindow({
    child: form,
    vexpand: true,
    hscrollbarPolicy: Gtk.PolicyType.NEVER,
    vscrollbarPolicy: Gtk.PolicyType.AUTOMATIC,
    propagateNaturalHeight: true,
  })
  const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
  box.append(header)
  box.append(scroller)

  const dialog = new Adw.Dialog({
    title: 'Edit solve #3',
    child: box,
    contentWidth: 480,
    defaultWidget: saveButton,
  })

  let closed = false
  dialog.on('closed', () => {
    closed = true
  })
  saveButton.on('clicked', () => {
    const activeName = penaltyGroup.getActiveName()
    const penalty = activeName === 'plus2' || activeName === 'dnf' ? activeName : undefined
    const text = commentRow.getText().trim().slice(0, MAX_COMMENT_LENGTH)
    writes.push({ penalty, comment: text.length > 0 ? text : undefined, t: Date.now() })
    console.error(
      `[e] save fired #${writes.length} t=${Date.now()} stack=${(new Error().stack || '').split('\n').slice(2, 5).join(' <- ')}`,
    )
    dialog.close()
  })

  return {
    dialog,
    saveButton,
    commentRow,
    penaltyGroup,
    penaltyRow,
    dateRow,
    scrambleRow,
    timeLabel,
    header,
    box,
    form,
    formList,
    scroller,
    isClosed: () => closed,
  }
}

app.on('activate', () => {
  // Wide on purpose: without contentWidth the long scramble's natural
  // width would stretch the dialog toward ~800px — the width check below
  // is what catches a missing cap.
  const win = new Adw.ApplicationWindow({ application: app, defaultWidth: 1100, defaultHeight: 800 })
  win.setContent(new Gtk.Label({ label: 'timer' }))
  win.present()

  const writesA = []
  const A = buildDialog(writesA, win, SCRAMBLE_LONG)
  A.dialog.present(win)

  GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 300, () => {
    // ---------- structure ----------
    check(`dialog is AdwDialog (${A.dialog.constructor.name})`, A.dialog.constructor.name === 'AdwDialog')
    check(`dialog.title carries the solve number (${A.dialog.title})`, A.dialog.title === 'Edit solve #3')
    // no focusWidget (user call, 2026-10-11): the comment line must NOT
    // be grabbed on open — dialog.focusWidget mirrors live focus.
    {
      let n = A.dialog.focusWidget
      const seen = []
      let inComment = false
      while (n) {
        seen.push(n.constructor.name)
        if (n === A.commentRow || n.constructor.name === 'AdwEntryRow') {
          inComment = true
          break
        }
        n = n.getParent ? n.getParent() : null
      }
      check(`dialog does NOT focus commentRow (live focus: ${seen.join(' < ') || 'none'})`, !inComment)
    }
    check('defaultWidget = saveButton', A.dialog.defaultWidget === A.saveButton)

    const kids = []
    let k = A.box.getFirstChild()
    while (k) {
      kids.push(k.constructor.name)
      k = k.getNextSibling()
    }
    check(`box children = [${kids.join(', ')}] (header, scroller)`, kids.join(',') === 'AdwHeaderBar,GtkScrolledWindow')

    const formKids = []
    let f = A.form.getFirstChild()
    while (f) {
      formKids.push(f.constructor.name)
      f = f.getNextSibling()
    }
    check(`form children = [${formKids.join(', ')}] (time, list)`, formKids.join(',') === 'GtkLabel,GtkListBox')

    check(
      `time = centered title-1 number (label "${A.timeLabel.label}", halign ${A.timeLabel.halign}, classes ${A.timeLabel.cssClasses.join(',')})`,
      A.timeLabel.label === '12.34' &&
        A.timeLabel.halign === Gtk.Align.CENTER &&
        ['title-1', 'numeric'].every((c) => A.timeLabel.cssClasses.includes(c)),
    )
    // the number follows the penalty toggle live (user call, 2026-10-11)
    A.penaltyGroup.activeName = 'plus2'
    check(`time label follows +2 → "${A.timeLabel.label}"`, A.timeLabel.label === '14.34+')
    A.penaltyGroup.activeName = 'dnf'
    check(`time label follows DNF → "${A.timeLabel.label}" (solved time kept)`, A.timeLabel.label === 'DNF(12.34)')
    A.penaltyGroup.activeName = 'ok'
    check(`time label follows back to OK → "${A.timeLabel.label}"`, A.timeLabel.label === '12.34')

    // rows: Date, Scramble, Penalty, Comment
    const rows = []
    let r = A.formList.getFirstChild()
    while (r) {
      rows.push(r)
      r = r.getNextSibling()
    }
    check(
      `list rows = [${rows.map((w) => w.constructor.name).join(', ')}]`,
      rows.map((w) => w.constructor.name).join(',') === 'AdwActionRow,AdwExpanderRow,AdwActionRow,AdwEntryRow',
    )
    check(
      `row order Date → Scramble → Penalty → Comment (${rows.map((w) => w.title).join(' → ')})`,
      rows.map((w) => w.title).join(' → ') === 'Date → Scramble → Penalty → Comment',
    )
    check(
      `Date row first, property-classed (${rows[0]?.title} / ${rows[0]?.subtitle})`,
      rows[0].title === 'Date' &&
        rows[0].subtitle === '2026-10-10 21:03:15' &&
        rows[0].cssClasses.includes('property'),
    )
    check(
      `long scramble → collapsed ExpanderRow (type ${rows[1]?.constructor.name}, subtitleLines=${rows[1]?.subtitleLines})`,
      rows[1].constructor.name === 'AdwExpanderRow' &&
        rows[1].title === 'Scramble' &&
        rows[1].subtitle === SCRAMBLE_LONG &&
        rows[1].subtitleLines === 1 &&
        rows[1].expanded === false,
    )
    // The expander must hold the full text itself — no scroller of its own:
    // the dialog's form is the one scroll view.
    let innerScrollers = 0
    let plainFull = false
    walk(rows[1], (w) => {
      if (w.constructor.name === 'GtkScrolledWindow') innerScrollers++
      if (
        w.constructor.name === 'GtkListBoxRow' &&
        w.getChild?.()?.constructor.name === 'GtkLabel' &&
        w.getChild().label === SCRAMBLE_LONG
      ) {
        plainFull = true
      }
    })
    check(
      `expander holds the FULL scramble in a plain label, unscrolled (scrollers=${innerScrollers}, plain=${plainFull})`,
      innerScrollers === 0 && plainFull,
    )
    const boxH = A.box.getHeight()
    check(
      `collapsed dialog sizes to the form (box h=${boxH}px, header + form natural)`,
      boxH > 200 && boxH <= 460,
    )
    const dateCopy = findCopy(rows[0])
    check(
      `Date copy suffix (tooltip "${dateCopy?.tooltipText ?? 'none'}", valign=${dateCopy?.valign}, flat=${dateCopy ? dateCopy.cssClasses.includes('flat') : false})`,
      dateCopy !== null &&
        dateCopy.tooltipText === 'Copy the date' &&
        dateCopy.valign === Gtk.Align.CENTER &&
        dateCopy.cssClasses.includes('flat'),
    )
    const scrambleCopy = findCopy(rows[1])
    check(
      `Scramble copy suffix (tooltip "${scrambleCopy?.tooltipText ?? 'none'}", valign=${scrambleCopy?.valign}, flat=${scrambleCopy ? scrambleCopy.cssClasses.includes('flat') : false})`,
      scrambleCopy !== null &&
        scrambleCopy.tooltipText === 'Copy the scramble' &&
        scrambleCopy.valign === Gtk.Align.CENTER &&
        scrambleCopy.cssClasses.includes('flat'),
    )
    check(
      `Date row spans the card (rowW=${rows[0].computeBounds(A.formList)[1].getWidth().toFixed(0)} listW=${A.formList.getWidth()})`,
      Math.abs(rows[0].computeBounds(A.formList)[1].getWidth() - A.formList.getWidth()) <= 2,
    )

    check(
      `form insets 12/12/6/12 (${A.form.marginStart}/${A.form.marginEnd}/${A.form.marginTop}/${A.form.marginBottom})`,
      A.form.marginStart === 12 && A.form.marginEnd === 12 && A.form.marginTop === 6 && A.form.marginBottom === 12,
    )
    check(
      `formList class = boxed-list, not list (${A.formList.cssClasses.join(',') || 'none'})`,
      A.formList.cssClasses.includes('boxed-list') && !A.formList.cssClasses.includes('list'),
    )
    check(
      `penaltyGroup valign = CENTER (${A.penaltyGroup.valign})`,
      A.penaltyGroup.valign === Gtk.Align.CENTER,
    )

    // contentWidth: 480 sets the card's width, and the scroller no longer
    // propagates the label's one-line natural width, so the long scramble
    // cannot inflate the dialog's natural width either (dialogW is the
    // AdwDialog overlay layer filling the host).
    const dialogW = A.dialog.getWidth()
    const [boxMin, boxNat] = A.box.measure(Gtk.Orientation.HORIZONTAL, -1)
    check(
      `content capped at contentWidth (boxAlloc=${A.box.getWidth()} of nat ${boxNat}; overlay=${dialogW}, contentWidth=${A.dialog.contentWidth})`,
      A.box.getWidth() >= 475 &&
        A.box.getWidth() <= 485 &&
        boxNat < 600 &&
        A.dialog.contentWidth === 480,
    )

    // header title: exactly one label, filled by update_title
    const titles = []
    let closeBtn = null
    walk(A.header, (w) => {
      if (w.constructor.name === 'GtkLabel' && w.label === 'Edit solve #3') titles.push(w)
      if ((w.cssClasses || []).includes('close')) closeBtn = w
    })
    check(`header shows dialog title once (${titles.length} label)`, titles.length === 1)
    check(`dialog close button present (${closeBtn ? closeBtn.constructor.name : 'none'})`, closeBtn !== null)

    // geometry: Save left of title, close right of title (computeBounds needs
    // an ancestor: box is one)
    if (titles.length === 1 && closeBtn) {
      const [, saveRect] = A.saveButton.computeBounds(A.box)
      const [, titleRect] = titles[0].computeBounds(A.box)
      const [, closeRect] = closeBtn.computeBounds(A.box)
      check(
        `Save packed left of title (save x=${saveRect.getX().toFixed(0)} < title x=${titleRect.getX().toFixed(0)})`,
        saveRect.getX() < titleRect.getX(),
      )
      check(
        `close button right of title (close x=${closeRect.getX().toFixed(0)} > title x=${titleRect.getX().toFixed(0)})`,
        closeRect.getX() > titleRect.getX(),
      )
      check(
        `Save at the far left (save x=${saveRect.getX().toFixed(0)} >= 0)`,
        saveRect.getX() >= 0 && saveRect.getX() < titleRect.getX(),
      )
    } else {
      check('Save packed left of title (skipped: no title/close found)', false)
      check('close button right of title (skipped)', false)
      check('Save at the far left (skipped)', false)
    }

    // ---------- focus: natural default, comment line NOT grabbed ----------
    const focusWidget = win.getFocus ? win.getFocus() : win.focusWidget
    let n = focusWidget
    let inComment = false
    let stops = []
    while (n) {
      stops.push(n.constructor.name)
      if (n === A.commentRow || n.constructor.name === 'AdwEntryRow') {
        inComment = true
        break
      }
      n = n.getParent ? n.getParent() : null
    }
    check(`root focus NOT in commentRow on open (chain: ${stops.join(' < ') || 'none'})`, !inComment)

    // ---------- Save path: default.activate → Save — what Return fires
    // from *outside* the comment entry; the row itself no longer routes
    // Enter to the dialog (user call, 2026-10-11) ----------
    A.penaltyGroup.activeName = 'plus2'
    A.commentRow.text = '  padded comment  '
    A.dialog.activateDefault()

    GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 500, () => {
      check(
        `Save via default.activate wrote exactly one save (got ${writesA.length}: ${JSON.stringify(writesA)})`,
        writesA.length === 1,
      )
      check(
        `save carried +2 and the trimmed comment (${JSON.stringify(writesA[0] ?? null)})`,
        writesA.length === 1 && writesA[0].penalty === 'plus2' && writesA[0].comment === 'padded comment',
      )
      check(`save closed the dialog (closed=${A.isClosed()})`, A.isClosed())

      // ---------- expand test (long scramble), then discard path ----------
      const writesB = []
      const B = buildDialog(writesB, win, SCRAMBLE_LONG)
      B.dialog.present(win)
      GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 300, () => {
        const bRows = []
        let br = B.formList.getFirstChild()
        while (br) {
          bRows.push(br)
          br = br.getNextSibling()
        }
        const expander = bRows[1]
        const beforeH = B.box.getHeight()
        check(
          `B opens with a collapsed ExpanderRow (type ${expander?.constructor.name}, box h=${beforeH}px)`,
          expander?.constructor.name === 'AdwExpanderRow' && expander.expanded === false && beforeH <= 460,
        )
        expander.expanded = true
        GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 400, () => {
          const afterH = B.box.getHeight()
          // The dialog keeps its size — one scroll view, Save never moving —
          // and the unrolled text is laid out in full inside the scroller.
          let fullH = 0
          walk(expander, (w) => {
            if (w.constructor.name === 'GtkLabel' && w.label === SCRAMBLE_LONG && w.wrap) fullH = w.getHeight()
          })
          check(
            `expanding lays the full text into the scroller, dialog unchanged (label h=${fullH}px, box Δ=${afterH - beforeH}px)`,
            fullH > 300 && Math.abs(afterH - beforeH) <= 60,
          )
          let sc2 = 0
          walk(expander, (w) => {
            if (w.constructor.name === 'GtkScrolledWindow') sc2++
          })
          check(`expander holds no scroller when expanded (${sc2} found)`, sc2 === 0)
          // The form is the scroll view: expanded past the dialog's height,
          // the vadjustment must have something to scroll.
          const vadj = B.scroller.getVadjustment()
          check(
            `form scrolls when the expansion overflows (upper ${vadj.getUpper()} > page ${vadj.getPageSize()})`,
            vadj.getUpper() > vadj.getPageSize(),
          )
          const willClose = B.dialog.close()
          check(`dialog.close() accepted (returns ${willClose})`, willClose === true)
          GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 500, () => {
            check(`discard path wrote nothing (got ${writesB.length})`, writesB.length === 0)
            check(`discard path emitted closed (closed=${B.isClosed()})`, B.isClosed())

          // ---------- carry-over: the form itself ----------
          check(
            `penaltyRow halign=FILL, fills list (rowW=${A.penaltyRow.computeBounds(A.formList)[1].getWidth().toFixed(0)} listW=${A.formList.getWidth()})`,
            Math.abs(A.penaltyRow.computeBounds(A.formList)[1].getWidth() - A.formList.getWidth()) <= 2,
          )
          check(
            `group natural width, no hexpand (groupW=${A.penaltyGroup.getWidth()}, hexpand=${A.penaltyGroup.hexpand})`,
            A.penaltyGroup.getWidth() < 200 && A.penaltyGroup.hexpand === false,
          )
          check(
            `comment row does NOT route Enter to the dialog (activatesDefault=${A.commentRow.activatesDefault})`,
            A.commentRow.activatesDefault === false,
          )
          A.commentRow.text = 'x'.repeat(600)
          check(
            `maxLength caps over-long set text (len=${A.commentRow.getText().length})`,
            A.commentRow.getText().length <= MAX_COMMENT_LENGTH,
          )
          const kids2 = []
          let c2 = A.penaltyGroup.getFirstChild()
          while (c2) {
            kids2.push(c2)
            c2 = c2.getNextSibling()
          }
          const toggles = kids2.filter((w) => w.useUnderline === true)
          check(`mnemonics wired (${toggles.length} toggles + ${kids2.length - toggles.length} separators)`, toggles.length === 3)

          // ---------- short scramble stays a plain row (no presentation
          // needed — shape, class and subtitle are construction-time) ----------
          const C = buildDialog([], win, SCRAMBLE_SHORT)
          const cRows = []
          let cr = C.formList.getFirstChild()
          while (cr) {
            cRows.push(cr)
            cr = cr.getNextSibling()
          }
          check(
            `short scramble → plain row ([${cRows.map((w) => w.constructor.name).join(', ')}])`,
            cRows.map((w) => w.constructor.name).join(',') === 'AdwActionRow,AdwActionRow,AdwActionRow,AdwEntryRow',
          )
          check(
            `plain row keeps property + exact subtitle (${cRows[1]?.subtitle})`,
            cRows[1].cssClasses.includes('property') && cRows[1].subtitle === SCRAMBLE_SHORT,
          )
          check(
            `plain row copy suffix present (tooltip "${findCopy(cRows[1])?.tooltipText ?? 'none'}")`,
            findCopy(cRows[1]) !== null && findCopy(cRows[1]).tooltipText === 'Copy the scramble',
          )

          // ---------- the window floor: dialog clamps, form scrolls ----------
          const shortWin = new Adw.ApplicationWindow({
            application: app,
            defaultWidth: 1100,
            defaultHeight: 300,
          })
          shortWin.setContent(new Gtk.Label({ label: 'timer' }))
          shortWin.present()
          const D = buildDialog([], shortWin, SCRAMBLE_LONG)
          D.dialog.present(shortWin)
          GLib.timeoutAdd(GLib.PRIORITY_DEFAULT, 300, () => {
            const [, formNat] = D.form.measure(Gtk.Orientation.VERTICAL, D.box.getWidth())
            check(
              `short parent clamps the dialog below the form (box h=${D.box.getHeight()} < form nat ${formNat})`,
              D.box.getHeight() < formNat,
            )
            const dVadj = D.scroller.getVadjustment()
            check(
              `form is scrollable at the floor (upper ${dVadj.getUpper()} > page ${dVadj.getPageSize()})`,
              dVadj.getUpper() > dVadj.getPageSize(),
            )
            check(
              `header with Save stays allocated above the scroller (header h=${D.header.getHeight()})`,
              D.header.getHeight() > 20,
            )
            D.dialog.close()
            shortWin.close()

            for (const c of checks) console.error(`[e] ${c}`)
            const fails = checks.filter((c) => c.startsWith('FAIL'))
            console.error(
              `[e] RESULT: ${checks.length - fails.length}/${checks.length} ${fails.length === 0 ? 'ALL PASS' : 'FAILURES: ' + fails.join('; ')}`,
            )
            app.quit()
            return false
          })
          return false
        })
        return false
      })
      return false
    })
    return false
  })
  return false
})
})
app.run([])
