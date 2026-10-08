/*
 * scrambleTypePicker.ts — the scramble-type chooser: one dialog, two doors.
 *
 * As of 2026-10-04 the dialog is the only place a type is *chosen*. Both
 * layouts open it through the same `Gtk.Button` (src/ui/scrambleTypeButton.ts):
 * packed in the header while the window is wide, and in ToolbarView's bottom
 * bar at ≤600px together with refresh and copy. The button is reparented
 * rather than duplicated, and its text lives in the header's WindowTitle
 * (src/ui/scrambleTypeTitle.ts), so one dialog and one `onChange` path cover
 * every layout.
 *
 * The dialog is an `Adw.NavigationSplitView` used the way the widget is meant
 * to be used:
 *
 *   - Two `Adw.NavigationPage`s — "Category" sidebar, types content — each
 *     with its own `Adw.ToolbarView` + `Adw.HeaderBar`. The split view shows
 *     the page titles, and when collapsed it shows its own back button on the
 *     content page. No custom up button, no manual title chrome.
 *   - The sidebar is an `Adw.Sidebar`: it owns the navigation-sidebar list
 *     look, the selection pill, scrolling, and — flipped to
 *     `Adw.SidebarMode.PAGE` by the same breakpoint — the boxed-lists page it
 *     becomes when collapsed (the documented Adw.Sidebar pattern).
 *   - Collapse is an `Adw.Breakpoint` (`max-width: 600px`) on the dialog,
 *     applied to `collapsed` through the breakpoint's apply/unapply signals
 *     (node-gtk can't box the GValue `addSetter` needs — AGENTS.md). The
 *     dialog follows its own content size, so it is naturally narrow (one
 *     column) until the content makes it wider than 600px.
 *   - The sidebar is built once; the type list holds only the *browsed*
 *     category's rows (~19), refilled by a single `renderTypes()` when
 *     `browse` changes. Measured 2026-10-06: `setFilterFunc` re-evaluates
 *     its predicate for every row on each change through the node-gtk
 *     boundary — 206 rows ≈ 79ms *even with a trivial predicate*, which was
 *     most of the slow popup (open() ≈ 130ms) and made every category click
 *     pay it; rebuilding the visible rows is ≈3ms. Still exactly one render
 *     path, keyed on `browse` alone — layout state never reaches it. Selecting
 *     a category, collapsed, pushes to the content page; the split view's back
 *     button pops it.
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
import { SCRAMBLE_GROUPS, SCRAMBLE_SECTIONS } from '../core/scrambleTypes.js'

/*
 * The `gi:*` shims export a *value* namespace only (AGENTS.md), so widget
 * types come from InstanceType — this module only builds and presents its own
 * widgets, so the base types say enough.
 */
type Window = InstanceType<typeof Adw.ApplicationWindow>
type ListBoxRow = InstanceType<typeof Gtk.ListBoxRow>

/**
 * A type row carrying its own id — the easy way to keep the payload with the
 * row instead of a side Map.
 *
 * This is plain JS wrapper extension, not `registerClass`: the native object
 * stays a stock `AdwActionRow`, only the JS class is extended. Probed working
 * on 2026-10-05 (construction, `instanceof`, signal round-trip identity,
 * 500-row churn — see AGENTS.md invariant 5). If that probe ever fails, fall
 * back to a `Map<ListBoxRow, string>`.
 */
class TypeRow extends Adw.ActionRow {
  typeId?: string
}

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
    // Adw.Sidebar owns the whole look: sidebar mode is a navigation-sidebar
    // list with a persistent selection pill, page mode a boxed-lists
    // PreferencesPage — and it scrolls internally (probe: GtkScrolledWindow
    // in both modes), so no scroller or CSS class of ours.
    //
    // One Adw.SidebarSection per csTimer higher class (===WCA=== etc. in
    // scrdata): the section title and the separator between sections are the
    // widget's own. Probe-verified item indices are FLAT across sections, so
    // `browse` (a group index) remains the item index unchanged — sections
    // are contiguous slices of SCRAMBLE_GROUPS appended in order.
    const sidebar = new Adw.Sidebar()
    SCRAMBLE_SECTIONS.forEach((section) => {
      const sidebarSection = new Adw.SidebarSection({ title: section.name })
      section.groups.forEach((group) =>
        sidebarSection.append(new Adw.SidebarItem({ title: group.name })),
      )
      sidebar.append(sidebarSection)
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
    // The rows are built by renderTypes() below — only the browsed category's
    // exist at a time (see its doc for the measured filter-vs-rebuild cost).
    // The ✓ and the preselection depend only on `currentId` at render time; no
    // mark-and-move machinery.

    // --- Pages / split view --------------------------------------------------
    const SCROLLER_MIN_HEIGHT = 180
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
    sidebarToolbar.content = sidebar

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
    // apply/unapply, not addSetter: node-gtk can't box the GValue (AGENTS).
    // mode flips with collapsed — the documented Adw.Sidebar pattern: the
    // sidebar pane is a sidebar while expanded, a boxed-lists page collapsed.
    collapseBreakpoint.on('apply', () => {
      split.collapsed = true
      sidebar.mode = Adw.SidebarMode.PAGE
    })
    collapseBreakpoint.on('unapply', () => {
      split.collapsed = false
      sidebar.mode = Adw.SidebarMode.SIDEBAR
    })
    dialog.addBreakpoint(collapseBreakpoint)
    dialog.child = split

    // --- State + filtering ---------------------------------------------------
    /** Browsed category. */
    let browse = Math.max(0, groupIndex(currentId))

    /**
     * Fill the type list with the browsed category's types — the one render
     * path, keyed on `browse` alone (layout state never reaches it).
     *
     * Rebuilt rather than filtered: `Gtk.ListBox.setFilterFunc` re-evaluates
     * its predicate for *every* row on each invalidation, and each evaluation
     * crosses the node-gtk boundary — 206 rows cost ≈79ms even with a trivial
     * `() => true` predicate (measured 2026-10-06), which was most of the slow
     * popup and made each category click pay it, twice over (notify fires
     * before activated). The browsed category has ~19 rows; clear-and-refill
     * costs ≈3ms. The old "never rebuilt" doctrine guarded against render
     * paths keyed on *layout* state — this is still exactly one path.
     */
    const renderTypes = (): void => {
      let old = typeList.getRowAtIndex(0)
      while (old !== null) {
        typeList.remove(old)
        old = typeList.getRowAtIndex(0) // advance: removing the same wrapper twice warns "non-child" and never terminates
      }
      typePage.title = groups[browse].name
      let first: ListBoxRow | null = null
      let live: ListBoxRow | null = null
      for (const choice of groups[browse].choices) {
        // Just the type name: the category is the selected row on the left
        // and the content page's title, so prefixing it here is redundant.
        const row = new TypeRow({
          title: choice.label,
          activatable: true,
          useMarkup: false,
        })
        row.typeId = choice.id
        if (choice.id === currentId) {
          row.addSuffix(
            new Gtk.Image({ iconName: 'object-select-symbolic', valign: Gtk.Align.CENTER }),
          )
          live = row
        }
        typeList.append(row)
        first ??= row
      }
      typeList.selectRow(live ?? first)
    }

    // --- Activation ----------------------------------------------------------
    const activateType = (row: ListBoxRow | null): void => {
      const id = row === null ? undefined : (row as TypeRow).typeId
      if (id === undefined) return
      const changed = id !== currentId
      currentId = id
      // No ✓ to move here: the dialog closes on this line, and the next open
      // rebuilds and stamps the mark from `currentId`.
      if (changed) options.onChange(id)
      dialog.close()
    }

    typeList.on('row-activated', activateType)
    // Documented Adw.Sidebar pattern: activated → show the content pane.
    sidebar.on('activated', (index) => {
      if (index < 0) return
      const changed = browse !== index
      browse = index
      if (changed) renderTypes() // notify fired first in wide mode — guard
      // Collapsed: push to the content page. Expanded: both panes already show.
      // No grabFocus() here: GTK reassigns focus when the sidebar hides, and a
      // programmatic grab paints a focus ring without any keyboard intent.
      split.showContent = true
    })
    // Arrow-browsing in the expanded view updates the right pane live (the
    // old row-selected behavior); collapsed, selection is just a cursor on
    // the root page — only activation commits a category.
    sidebar.on('notify::selected', () => {
      if (split.collapsed) return
      const index = sidebar.selected
      if (index < 0 || index === browse) return // already the shown category
      browse = index
      renderTypes()
    })

    renderTypes()
    // Preselect the browsed category. Sidebar items are appended in group
    // order, so the group index is the item index (the notify handler's
    // `index === browse` guard makes this assignment a no-op render-wise).
    // Focus is left to the dialog itself — no explicit focusWidget, so no
    // focus ring is painted on open without keyboard intent.
    sidebar.selected = browse
    dialog.present(options.window)
  }

  /**
   * Point the dialog at `id` — same contract as the header title's
   * selectType (src/ui/scrambleTypeTitle.ts): silent (never announces the
   * choice back), idempotent, and false for an id this catalogue does not
   * have (a hand-edited session index), so the caller leaves the feed alone
   * too.
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
