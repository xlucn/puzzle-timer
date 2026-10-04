/*
 * scrambleTypePicker.ts — the scramble-type chooser: one dialog, two doors.
 *
 * As of 2026-10-04 the dialog is the only place a type is *chosen*. Both
 * layouts open it through the same `Gtk.Button` (src/ui/scrambleTypeButton.ts):
 * in the header while the window is wide, and in ToolbarView's bottom bar at
 * ≤600px. The button is reparented rather than duplicated, so one label, one
 * dialog and one `onChange` path cover every layout.
 *
 * The dialog is an `Adw.NavigationSplitView` used the way the widget is meant
 * to be used:
 *
 *   - Two `Adw.NavigationPage`s — "Category" sidebar, types content — each
 *     with its own `Adw.ToolbarView` + `Adw.HeaderBar`. The split view shows
 *     the page titles, and when collapsed it shows its own back button on the
 *     content page. No custom up button, no manual title chrome.
 *   - Collapse is an `Adw.Breakpoint` (`max-width: 600px`) on the dialog,
 *     applied to `collapsed` through the breakpoint's apply/unapply signals
 *     (node-gtk can't box the GValue `addSetter` needs — AGENTS.md). The
 *     dialog follows its own content size, so it is naturally narrow (one
 *     column) until the content makes it wider than 600px.
 *   - Both lists are populated once and the type list is filtered in place
 *     (`Gtk.ListBox.setFilterFunc`), never rebuilt. Selecting a category
 *     updates the type filter and, collapsed, pushes to the content page;
 *     the split view's back button pops it. There is no separate "narrow
 *     render" path.
 *
 * A type row shows just the type name (`ScrambleChoice.label`): the category
 * is the selected row on the left and the content page's title, so repeating
 * it on every row would be noise. (Search was dropped 2026-10-05 — it was
 * the messy part; the two-level browse covers the catalogue.)
 *
 * This module owns no presentation widget: it provides `{ open, selectType }`
 * for the shared button to call. `selectType` is silent and idempotent, so a
 * session switch updates which category the dialog opens on without
 * re-announcing the choice.
 *
 * The dialog is built fresh on every open (house pattern: Preferences,
 * Shortcuts) — an AdwDialog is gone when it closes.
 */
import Adw from 'gi:Adw-1'
import Gtk from 'gi:Gtk-4.0'

import { BREAKPOINTS } from '../core/layout.js'
import { SCRAMBLE_GROUPS, SCRAMBLE_TYPES } from '../core/scrambleTypes.js'

/*
 * The `gi:*` shims export a *value* namespace only (AGENTS.md), so widget
 * types come from InstanceType — this module only builds and presents its own
 * widgets, so the base types say enough.
 */
type Window = InstanceType<typeof Adw.ApplicationWindow>
type ActionRow = InstanceType<typeof Adw.ActionRow>
type ListBoxRow = InstanceType<typeof Gtk.ListBoxRow>

export interface ScrambleTypePickerOptions {
  /** Type the button opens on; must be the feed's starting type. */
  initialType: string
  /** Called whenever the user picks a different type (never for selectType). */
  onChange: (id: string) => void
  /** Toplevel the dialog is presented on. */
  window: Window
}

export function createScrambleTypePicker(options: ScrambleTypePickerOptions) {
  const groups = SCRAMBLE_GROUPS
  /** The group a level of types is *browsing* (may differ from the live one). */
  const groupIndex = (id: string): number =>
    groups.findIndex((group) => group.choices.some((choice) => choice.id === id))

  let currentId = options.initialType

  const openDialog = (): void => {
    const dialog = new Adw.Dialog({
      title: 'Scramble type',
      // A default size, not a managed one: the dialog clamps itself to the
      // parent window, and the 600px breakpoint collapses the split whenever
      // the allocated width is too narrow. No surface listener, no manual
      // contentWidth chasing — the dialog uses the space available to it.
      contentWidth: 720,
      contentHeight: 480,
      // A dialog with a breakpoint has no implicit minimum size (AdwDialog
      // docs); give it one so the one-column sheet never collapses to nothing.
      widthRequest: 300,
      heightRequest: 240,
    })

    // --- Categories (sidebar) ------------------------------------------------
    const categoryList = new Gtk.ListBox({
      selectionMode: Gtk.SelectionMode.SINGLE,
      activateOnSingleClick: true,
      cssClasses: ['navigation-sidebar'],
    })
    // Map a category row to its group index; rows are built once, below.
    const categoryGroup = new Map<ListBoxRow, number>()
    groups.forEach((group, index) => {
      const row = new Adw.ActionRow({ title: group.name, activatable: true, useMarkup: false })
      row.addSuffix(new Gtk.Image({ iconName: 'go-next-symbolic', valign: Gtk.Align.CENTER }))
      categoryGroup.set(row, index)
      categoryList.append(row)
    })

    // --- Types (content) -----------------------------------------------------
    const typeList = new Gtk.ListBox({
      selectionMode: Gtk.SelectionMode.SINGLE,
      activateOnSingleClick: true,
      cssClasses: ['boxed-list'],
      // The card frame floats inside the content pane: boxed-list draws it,
      // and these margins give it breathing room on every side. Without them
      // the list stretches edge-to-edge and the frame is invisible.
      marginTop: 12,
      marginBottom: 12,
      marginStart: 12,
      marginEnd: 12,
    })
    const typeId = new Map<ListBoxRow, string>()
    const typeRows: ActionRow[] = []
    /** The ✓ suffix lives on the live type's row; moved by markCurrent. */
    const currentCheck = new Gtk.Image({
      iconName: 'object-select-symbolic',
      valign: Gtk.Align.CENTER,
    })
    let currentRow: ActionRow | null = null
    const markCurrent = (id: string): void => {
      if (currentRow !== null) currentRow.remove(currentCheck)
      const row = typeRows.find((r) => typeId.get(r) === id) ?? null
      if (row !== null) row.addSuffix(currentCheck)
      currentRow = row
    }
    for (const type of SCRAMBLE_TYPES) {
      const row = new Adw.ActionRow({
        // Just the type name: the category is the selected row on the left
        // and the content page's title, so prefixing it here is redundant.
        title: type.name,
        activatable: true,
        useMarkup: false,
      })
      typeId.set(row, type.id)
      typeRows.push(row)
      typeList.append(row)
    }
    markCurrent(currentId)

    // --- Pages / split view --------------------------------------------------
    const SCROLLER_MIN_HEIGHT = 180
    const categoryScroller = new Gtk.ScrolledWindow({
      child: categoryList,
      hexpand: true,
      vexpand: true,
      hscrollbarPolicy: Gtk.PolicyType.NEVER,
      minContentWidth: 180,
      minContentHeight: SCROLLER_MIN_HEIGHT,
      // No 'view' class here: the navigation-sidebar rows are flat and meant
      // to sit on the split view's muted .sidebar-pane background. An opaque
      // .view scroller would cover that and make the rail read as a plain box.
    })
    const typeScroller = new Gtk.ScrolledWindow({
      child: typeList,
      hexpand: true,
      vexpand: true,
      hscrollbarPolicy: Gtk.PolicyType.NEVER,
      minContentWidth: 180,
      minContentHeight: SCROLLER_MIN_HEIGHT,
      // No 'view' class: the boxed-list card supplies its own background, and
      // an opaque .view slab behind it would hide the card's rounded frame.
    })

    const sidebarHeader = new Adw.HeaderBar({
      showBackButton: false,
      showStartTitleButtons: false,
      showEndTitleButtons: false,
    })
    const sidebarToolbar = new Adw.ToolbarView()
    sidebarToolbar.addTopBar(sidebarHeader)
    sidebarToolbar.content = categoryScroller

    const contentHeader = new Adw.HeaderBar()
    const contentToolbar = new Adw.ToolbarView()
    contentToolbar.addTopBar(contentHeader)
    contentToolbar.content = typeScroller

    const categoryPage = new Adw.NavigationPage({ title: 'Category', child: sidebarToolbar })
    const typePage = new Adw.NavigationPage({ title: 'Scramble type', child: contentToolbar })
    const split = new Adw.NavigationSplitView({
      sidebar: categoryPage,
      content: typePage,
      sidebarPosition: Gtk.PackType.START,
      sidebarWidthFraction: 0.4,
      minSidebarWidth: 220,
      maxSidebarWidth: 320,
      sidebarWidthUnit: Adw.LengthUnit.PX,
      showContent: true,
      hexpand: true,
      vexpand: true,
    })

    const collapseBreakpoint = Adw.Breakpoint.new(
      Adw.BreakpointCondition.newLength(
        Adw.BreakpointConditionLengthType.MAX_WIDTH,
        BREAKPOINTS.selectorRowMax,
        Adw.LengthUnit.PX,
      ),
    )
    collapseBreakpoint.on('apply', () => { split.collapsed = true })
    collapseBreakpoint.on('unapply', () => { split.collapsed = false })
    dialog.addBreakpoint(collapseBreakpoint)
    dialog.child = split

    // --- State + filtering ---------------------------------------------------
    /** Browsed category. */
    let browse = Math.max(0, groupIndex(currentId))

    /** Show only the browsed category's types; title the page after it. */
    const applyTypeFilter = (): void => {
      typeList.setFilterFunc((row) => {
        const id = typeId.get(row)
        return id === undefined ? true : groupIndex(id) === browse
      })
      typePage.title = groups[browse].name
    }

    // --- Activation ----------------------------------------------------------
    const activateType = (row: ListBoxRow | null): void => {
      const id = row === null ? undefined : typeId.get(row)
      if (id === undefined) return
      const changed = id !== currentId
      currentId = id
      markCurrent(id)
      if (changed) options.onChange(id)
      dialog.close()
    }
    const showCategory = (row: ListBoxRow | null): void => {
      const index = row === null ? undefined : categoryGroup.get(row)
      if (index === undefined) return
      browse = index
      applyTypeFilter()
      // Collapsed: push to the content page. Expanded: both panes already show.
      // No grabFocus() here: GTK reassigns focus when the sidebar hides, and a
      // programmatic grab paints a focus ring without any keyboard intent.
      split.showContent = true
    }

    typeList.on('row-activated', activateType)
    categoryList.on('row-activated', showCategory)
    // Browsing categories in the expanded view updates the right pane live.
    categoryList.on('row-selected', (row) => {
      if (split.collapsed) return
      const index = row === null ? undefined : categoryGroup.get(row)
      if (index === undefined) return
      browse = index
      applyTypeFilter()
    })

    applyTypeFilter()
    // Preselect the browsed category and the live type. Focus is left to the
    // dialog itself — no explicit focusWidget, so no focus ring is painted on
    // open without keyboard intent.
    const browsedRow =
      Array.from(categoryGroup.entries()).find(([, i]) => i === browse)?.[0] ?? null
    if (browsedRow !== undefined) categoryList.selectRow(browsedRow)
    if (currentRow !== null) typeList.selectRow(currentRow)
    dialog.present(options.window)
  }

  /**
   * Point the dialog at `id` — same contract as the button's selectType:
   * silent (never announces the choice back), idempotent, and false for an id
   * this catalogue does not have (a hand-edited session index), so the caller
   * leaves the feed alone too.
   */
  const selectType = (id: string): boolean => {
    if (id === currentId) return true
    if (groupIndex(id) < 0) return false
    currentId = id
    return true
  }

  /** The dialog's way in and silent session-sync hook. */
  return { open: openDialog, selectType }
}
