# cstimer-gtk — implementation plan

A native Linux cube timer that works like <https://cstimer.net/>, built with
GTK4 + libadwaita via node-gtk. This document is the durable plan and the
handoff artifact between sessions: a cold session should read this file and be
able to continue at the current milestone.

---

## 1. Scope

**MVP (M0–M5):** timers, scrambles, sessions, statistics.

**Explicitly out of scope for now:**
- Bluetooth smart cube support (decided: not in v1)
- Virtual cube, solvers, batch generators, cross-session stats
- csTimer backup import/export (dropped as not needed)
- Packaging/distribution (personal use only for now)

**Long-term goals (added by decision, not scheduled):**
- **Stackmat support** — `serialport` npm package + udev rule; protocol logic
  ported from csTimer's `src/js/hardware/stackmat.js` (GPL). Input source
  feeds `core/timer.ts`, so it is purely additive.
- **Charts (time trend, distribution)** — `Gtk.DrawingArea` + Cairo line/path
  drawing; math ported from csTimer's `src/js/stats/trend.js` and
  `src/js/stats/distribution.js`. Stats already live in `core/`, so charts are
  rendering-only on top.

---

## 2. Stack decision (resolved)

| Choice | Verdict |
|---|---|
| `node-gtk` + libadwaita | **Chosen.** Active (last push 2026-07), Adwaita first-class, TypeScript scaffold, CSS hot-reload, prebuilds for Node 22/24/26. |
| `cstimer_module` npm | **Chosen.** Official (author `cs0x7f`), v0.1.5 released 2026-02, pure JS, GPL-3.0, 206 scramble types + SVG images. |
| GJS (GNOME's JS runtime) | **Rejected**, despite better long-term maintainability (GNOME-backed, no ABI churn). See evidence in §5. |
| Electron / WebView wrapper | Rejected — user wants native GTK only, no web stack. |
| Python + PyGObject / Rust | Rejected — awkward fit for the JS scramble module. |

**License:** GPL-3.0. Required by `cstimer_module` and permitted for porting
csTimer's GPL source. Compatible with GTK/Libadwaita (LGPL) and node-gtk (MIT).

---

## 3. Architecture

```
src/
├── main.ts              bootstrap: Adw.Application, window, header, actions
├── core/                ★ pure TypeScript — NO `gi:`, NO Node APIs
│   ├── timer.ts          state machine: idle → holding → ready → running → stopped
│   │                     (+ WCA inspection: 15 s → +2, 17 s → DNF, splits)
│   ├── time.ts           formatting, penalty math, DNF-as-∞
│   ├── stats.ts          ao5/ao12/mo3/aoX trimming, best single/avg, PB target
│   ├── session.ts        Solve & Session models, CRUD, undo, penalties, comments
│   ├── scrambleTypes.ts  206-type catalogue + 44-group menu (data-driven)
│   ├── scrambleFeed.ts   prefetch state machine: type switch / advance / ready
│   └── eventbus.ts       minimal pub/sub the UI subscribes to
├── scramble/
│   ├── worker.ts         worker_threads host for cstimer_module
│   ├── protocol.ts       typed request/response messages worker ↔ main
│   ├── cstimerLang.ts    type-id → cstimer_module language-table mapping
│   └── service.ts        prefetch queue — next scramble is always warm
├── platform/
│   ├── store.ts          atomic JSON persistence in XDG data dir (Node fs)
│   ├── random.ts         CSPRNG seeding (crypto.getRandomValues)
│   └── audio.ts          inspection beeps (GStreamer GI, pw-play fallback)
├── ui/                   GTK widgets only; subscribes to core via event bus
│   ├── window.ts         Adw.ApplicationWindow + OverlaySplitView
│   ├── timerLabel.ts     monospace digits; gray/red/green/white states
│   ├── scrambleTypeSelect.ts  two Gtk.DropDown selectors (category → type)
│   ├── scramblePanel.ts  scramble text + Gtk.Picture (image in M5)
│   ├── timesList.ts      Gtk.ColumnView of solves
│   ├── statsPanel.ts     statistics (Adw.Dialog)
│   ├── sessionBar.ts     Adw.DropDown session selector
│   └── preferences.ts    Adw.PreferencesDialog
└── test/                 Vitest against src/core
```

### Why the boundary matters
- `core/` purity makes the timer state machine and stats math testable with
  Vitest without a display server.
- It is also the insurance policy: if node-gtk ever becomes unmaintainable
  (single maintainer, per-Node-major prebuilds), a GJS port would touch only
  `ui/` + `platform/` + `scramble/`, carrying `core/` and its tests untouched.

---

## 4. Key technical decisions

1. **Timing precision** — capture start/stop with `GLib.get_monotonic_time()`
   (µs) inside the key handler, never in the paint callback. Display is just
   formatting an interval, refreshed on a 16 ms `GLib.timeout_add` while
   running. csTimer itself only shows milliseconds, so this is parity.

2. **Hold-space logic** — GTK4 does not expose keyboard auto-repeat, so track
   held keys locally and ignore repeat presses. Configurable hold threshold
   before the timer turns green (csTimer's "time of keeping space down").

3. **Scramble prefetch** — worker thread + queue. Generate the *next* scramble
   while the user is solving so it is ready the instant they finish.

4. **Native layout (not the csTimer webpage layout):**
   - `Adw.OverlaySplitView`: solve list as a sliding sidebar over the content,
     auto-collapsing on narrow windows.
   - Center column: scramble text (monospace, selectable) → big timer →
     ao5/ao12 label strip.
   - Header bar: session `Adw.DropDown`, scramble category + type dropdowns,
     stats button, menu.
   - Statistics in an `Adw.Dialog`; settings in `Adw.PreferencesDialog`.
   - `Adw.ToastOverlay` for undo ("Solve deleted [Undo]"), `Adw.StatusPage`
     for the empty state.

5. **`Gtk.ColumnView`, not `Gtk.ListBox`** — ListBox builds every row and a
   session can hold thousands of solves; ColumnView is virtualized.

6. **Storage** — one JSON file per session under `GLib.get_user_data_dir()`,
   atomic write (temp file + rename) after each solve, debounced. Revisit only
   if profiling shows a problem (`node:sqlite` is built into Node).

7. **Where per-solve actions live — the toolbar, not a context menu.**
   Select row(s) and act from the footer bar under the list (a
   `Gtk.ActionBar` revealed on selection); M4 puts `+2`, `DNF`, comment and
   delete there, acting on the whole multi-row selection. Deliberately **no
   `Ctrl+Z`**: a shortcut that *deletes* a record is not intuitive (user
   call, 2026-10-01) — deletions are undone from their toast instead. The
   other csTimer-parity shortcuts stay: `Ctrl+1/2/3` = OK/+2/DNF on the
   latest solve, `Alt+1-7` scramble types.

8. **SVG scramble images** — GTK4 has no SVG support; use `Rsvg-2.0` via GI
   → `Gtk.Picture` (typelib confirmed present on this machine).

9. **Wayland** — no global key grabs. Hold-space works only while the window
   is focused (same as csTimer in a browser tab). GlobalShortcuts portal is a
   possible later addition, not in MVP.

10. **Scramble-type selector — two dropdowns, not one searchable list.** Mirrors
    csTimer's own two-level menu: 44 categories → plain type names (names are
    unique *within* a group, verified — 0 intra-group duplicates, so no
    `group · name` prefixes needed). GTK search gotcha: `Gtk.DropDown`'s search
    is a no-op unless an `expression` is set — `newFromStrings()` passes NULL
    and `set_enable_search(true)` alone silently does nothing. Setting the
    `expression` *property* from node-gtk aborts the process
    (`Unhandled GValue type: GtkExpression`), so build it in the constructor:
    `Gtk.DropDown.new(model, Gtk.PropertyExpression.new(GObject.typeFromName('GtkStringObject'), null, 'string'))`,
    plus `setSearchMatchMode(SUBSTRING)` (the default PREFIX misses "roux" in
    "3x3x3 Roux"). Swapping a level-2 model from JS resets `selected` → 0 and
    emits `notify::selected`; guard the callback while swapping.

---

## 5. Research evidence (measured, not assumed)

### System environment (verified on this machine)
| Item | Value |
|---|---|
| GTK4 | 4.22.5 |
| libadwaita | 1.9.4 (has OverlaySplitView, Adw.Dialog, PreferencesDialog) |
| Typelibs present | Gtk-4.0, Adw-1, Rsvg-2.0, Gst-1.0 (full GStreamer), Pango, Gio, GLib |
| Node | v26.10.0 (node-gtk ships a Node 26 prebuild) |
| GJS | 1.88.1 installed (used for the comparison below) |

Nothing needs to be installed before starting.

### `cstimer_module` (v0.1.5, tested locally)
- Full API surface: `getScrambleTypes`, `getScramble`, `setSeed`, `setGlobal`,
  `getImage`. **Scrambles and SVG images only** — no timer, stats, sessions,
  or solvers. The other ~90% of the app is written here.
- Loads in Node in 33 ms, 206 scramble types.
- **Blocking measurements (reason for the worker):**

  | scramble | time |
  |---|---|
  | 3x3 random-state | ~51 ms |
  | 4x4 WCA random-state | **~1194 ms** |
  | 5x5 / 7x7 / clock (random-move) | <1 ms |

- Pure JS, CommonJS bundle, no native deps. Also ships a `postMessage`
  worker protocol in the bundle.

### GJS vs node-gtk (why node-gtk won)
Ran against GJS 1.88.1 installed locally:
- `import cstimer_module` → `ReferenceError: $ is not defined`; with shims →
  `$.isArray` → `$.UDPOLY_RE`. The bundle only takes its clean export path
  under CommonJS; under ESM it expects csTimer's *extended* jQuery. Not a
  config fix — a porting project.
- `typeof Worker === 'undefined'` → no workers, so the 1.2 s 4x4 scramble
  would freeze the GJS main loop with no escape hatch.
- `globalThis.crypto === undefined` → `cstimer_module` would fall back to
  timestamp seeding (weak/predictable scrambles) unless seeded manually.
- Plus: no npm (stackmat needs `serialport`), no stock TS/test tooling.

GJS wins on maintainability (GNOME-backed, no ABI churn, ships with the
desktop); node-gtk wins on capability for this app's dependencies. The pure
`core/` boundary is what keeps the GJS option open.

### node-gtk risks and how this plan dodges them
| Open issue class | Mitigation |
|---|---|
| Segfaults in custom widget subclassing | Stock widgets + CSS only (rule 5) |
| Cairo toy text API broken (`textExtents` returns `{}`) | Pango / `Gtk.Label` (rule 6) |
| GStreamer unref issue | Audio isolated in `platform/audio.ts`; `pw-play` subprocess fallback |
| Memory consumption report | Check RSS around M3 (thousands of records) |
| Single maintainer / per-Node ABI prebuilds | Pure `core/` keeps a runtime swap cheap |
| Key events eaten by the focused widget (found in M0: the header `MenuButton` swallowed Space, so the timer never saw it) | `EventControllerKey` in **CAPTURE** phase on the window |
| `@dim_label_color` silently renders white in GTK4/libadwaita (found in M0: dim text was invisible) | Dim text with `alpha(@window_fg_color, 0.55)`; stick to `@window_fg_color`, `@success_color`, `@error_color`, `@warning_color` |
| X11 window screenshots go stale under XWayland (found in M0: `XGetImage` kept returning an old frame while the app painted fine) | For visual checks, force a repaint (resize the window) before capturing, and trust tick logs over screenshots for timing |

---

## 6. Milestones

Each milestone ends with a runnable app.

| # | Deliverable | Done when |
|---|---|---|
| **M0** | Scaffold via `npx node-gtk create`; `core/timer.ts` state machine; hold-space timing with µs precision and key-repeat handling | App times accurately; Vitest green on the state machine |
| **M1** | Scramble worker (`worker_threads`) + prefetch queue + scramble panel + scramble-type selector | 206 types, zero UI freezes |
| **M2** | Record solves → `Gtk.ColumnView` → atomic JSON in XDG data dir, restart-safe; undo/delete | A usable timer |
| **M3** | Sessions: create/rename/switch/delete, per-session lists and stats, header dropdown | Multi-session works |
| **M4** | Statistics ported from csTimer rules (ao5/ao12/mo3 trimming, DNF-as-∞, PB target), penalties `+2`/`DNF`, WCA inspection with GStreamer beeps | Feature-complete core |
| **M5** | Preferences dialog, full shortcut set, scramble image (Rsvg), dark-mode theming, empty states/toasts, polish | Something to use daily |
| **M6** | Adaptive layout: `Adw.Breakpoint`-driven drawer sidebar on narrow windows (retiring the "drawer is M5 polish" note), a header that adapts instead of truncating, sidebar width bounds that grow with large windows instead of pinning at 320, timer/scramble that use the space they get | The layout looks deliberate at every window size |

**Post-MVP backlog:** stackmat, charts (see §1), then packaging if ever needed.

### M0 — landed 2026-09-30

Scaffold at the repo root (`npx node-gtk create .`, app id `com.oliver.cstimergtk`),
plus `src/core/timer.ts` (5-state machine — idle → holding → ready → running →
stopped — with auto-repeat dedup living in core so it is testable),
`src/core/time.ts`, `src/ui/timerLabel.ts` and the wiring in `src/main.ts`.
`src/welcome.ts` from the scaffold was removed. **22 Vitest tests green.**

Verified by driving the real app with synthetic X11 keys (python ctypes + XTest):
all five states painted correctly (red "Keep holding…", green "Release to start",
dark counting value, frozen result, dim idle), and the 16 ms tick beat steadily
from 17 ms to 1481 ms with the stopped result matching the last beat.
Two M0 bugs were found and fixed this way — see the risk table in §5. The
harness that did it now lives in [`tools/`](./tools/README.md), so later
milestones can re-verify the same way.

### M1 — landed 2026-10-01

Scramble worker (`src/scramble/worker.ts`, `worker_threads` + `cstimer_module`
v0.1.5) behind a typed protocol, `service.ts` request queue, and a pure
`src/core/scrambleFeed.ts` state machine that keeps the next scramble warm and
hands it over the instant a solve finishes (also regenerates on type switch and
on refresh). UI: `src/ui/scramblePanel.ts` (scramble text, "Generating…"
spinner) and the two-dropdown selector `src/ui/scrambleTypeSelect.ts` —
category → type, both searchable (see decision 10 in §4 for the GTK
`expression` pitfall that made search silently do nothing).

Evidence:

- `node --import tsx tools/scramble_probe.ts --quiet` → **206/206 types
  generate** (slowest `444bld` 1.79 s — runs in the worker, not the UI thread).
- **40 Vitest tests green** (timer 22 + scrambleFeed + two-level scrambleTypes).
- **Zero freezes, measured:** synthetic keys ran hold-space 0.35 s → release →
  stop at 0.40 s and the timer displayed exactly **0.40** — the main thread
  never stalled; the scramble advanced after the solve.
- Manually verified: type switch (4x4x4) generates without blocking, refresh,
  long relay scramble doesn't resize the window, category/type dropdowns both
  search (`roux`, `pyra`).

### M2 — landed 2026-10-01

Solve recording: `timer.onSolved` reads the scramble that was on screen,
writes `{timeMs, scramble, scrambleType, createdAtMs}` into
`src/core/session.ts` (chronological, **ids never reused**), then advances the
feed. UI: `src/ui/timesList.ts` — a `Gtk.ColumnView` sidebar (never
`Gtk.ListBox`: sessions reach thousands of solves) whose model is a
`Gtk.StringList` of solve *ids* newest-first, rebuilt in one `splice()` per
change; cells read their text from the session in `bind`, so a delete (and the
undo toast that follows it) can never point at the wrong row. Columns size
themselves: `fixed-width` stays at its default of `-1` (GTK's native
content-fit — an explicit width is used "regardless of the size of its
content"), they are **not** resizable (GTK's drag is a bare 1:1 gesture with
no sensitivity setting; user call — this list is a log, not a spreadsheet),
and `Time` + `Solved` have `expand` set — GTK splits the extra width equally
between them, so the columns span the full sidebar — while the digit-only
`#` column keeps its content-fit floor instead of wasting an equal share on
one glyph. All cells are left-aligned (`xalign: 0`): GTK never offers a way
to move a ColumnView header off the left edge, so the cells go under their
headers rather than stranding them (user call, 2026-10-01). Hosted in
`Adw.OverlaySplitView` beside the timer with a header toggle (`collapsed`
stays false — the drawer breakpoint is M6). Sidebar width is in
*logical* px: on this scale-2 session the default 900-logical window puts it
at the `minSidebarWidth` floor (240; `0.25 × 900 < 240`), rising to at most
`maxSidebarWidth` 320 once the window reaches 1280 logical — verified against
libadwaita's source and a live probe, not assumed; see `tools/README.md`
trap 6 before quoting any pixel count from a screenshot. Persistence:
`src/platform/store.ts` writes `{version: 1, solves: [...]}` to
`~/.local/share/cstimer-gtk/sessions/default.json` — debounced 250 ms, atomic
`.tmp` + rename, `flush()` on quit; an unreadable file is quarantined to
`<file>.corrupt-<ts>` behind a toast rather than being overwritten.

Deleting: rows select with a click (Shift/Ctrl-click extends — GTK's own
multi-select behaviour on a `Gtk.MultiSelection`), which reveals the sidebar's
footer bar — a stock `Gtk.ActionBar`, the same bottom bar Warehouse and other
libadwaita apps hang under a list; Adwaita paints its inner box with the
headerbar background + a top shade line, and `revealed=false` collapses it to
nothing, so the bar costs list height only while something is selected. The
bar shows `#8 · 0.60` (one row) or `3 selected`, plus a 🗑 **Delete** button;
the Delete key takes the very same `deleteSelected()` path, so button and key
cannot drift apart. One call carries the whole selection, and one `Adw.Toast`
with **Undo** puts the lot back (`session.restore()` per removal, **in
reverse removal order**, each at the index recorded when it happened).
There is no right-click menu (replaced by this bar — it also took the
popover-blink bug with it) and no Ctrl+Z (removed as unintuitive);
`Session.undo()` went with it, hence 58 tests rather than 59.

Evidence:

- **58 Vitest tests green** (M1's 40 + 14 session + 4 `formatTimestamp`; the
  `undo()` test left with Ctrl+Z).
- **Restart-safe, end to end:** recorded solves → `Ctrl+Q` → file still holds
  them → relaunch → same rows with the same chronological `#`s. Deletions
  during the session left ids 1, 5, 6 in the file — proof ids don't get
  recycled.
- Row click + Delete removed exactly that solve from disk and renumbered the
  rest; the toast's **Undo** put it back at its original position.
- **The footer bar, three states** (screenshots): nothing selected → no bar
  at all (no leftover strip); one row clicked → row highlighted, bar reads
  `#8 · 0.60` + Delete; click Delete → count drops, `Solve deleted` toast
  appears, bar collapses.
- **Multi-select + batch:** click + Shift+Down ×2 highlighted three rows with
  `3 selected` in the bar; Delete removed all three (6 → 3 solves) behind a
  single `3 solves deleted` toast, and its Undo restored all three at their
  original positions. `Ctrl+Z` afterwards changed nothing (action, menu entry
  and `Session.undo()` are gone) and the app log stayed clean.
- The sidebar toggle round-trips and GTK moves the window controls to the
  surviving header by itself.
- `tools/colview_probe.mjs` covers what screenshots can't: factory
  setup/bind, `getPosition()` → id → row text, the `isSelected()` selection
  walk returning exactly the selected ids (`[3, 1]`), and the ActionBar
  revealing (`2 selected`) then collapsing again once a rebuild clears the
  selection.

---

## 7. Session handoff

- Project rules live in [AGENTS.md](./AGENTS.md) (auto-loaded every session).
- This file is the plan of record; update §6 checkboxes/notes as milestones
  land so a cold session can pick up correctly.
- **Next milestone: M3** — sessions: create/rename/switch/delete, per-session
  lists and stats, header dropdown. (M0, M1 and M2 are landed — see the dated
  blocks in §6.) M2 left the single session in
  `~/.local/share/cstimer-gtk/sessions/default.json`, `{version: 1, solves}`
  — M3 is what gives that file a session list around its solves.
- **Layout M3 inherits:** the solve list is the **left** sidebar
  (`sidebarPosition: START`, width clamped 240–320 logical); the sidebar
  toggle is the content header's first `packStart`, so the header reads
  `[toggle][WCA][3x3x3][refresh] … title … [menu][window controls]` — M3's
  session dropdown joins that row and needs a placement call. Adaptive
  layout (drawer breakpoint, header shedding, width caps) is M6's job, not
  M3's.
- To resume: read this file + the current milestone row, check what exists in
  `src/`, continue from there.
- Before trusting a screenshot of the running app, read
  [`tools/README.md`](./tools/README.md): X captures on XWayland are often
  stale, and the duplicate-instance rule means a second `npm start` silently
  attaches to the first.
