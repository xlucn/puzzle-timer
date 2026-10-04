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

**License:** GPL-3.0-or-later (LICENSE file). Required by `cstimer_module` and
permitted for porting
csTimer's GPL source. Compatible with GTK/Libadwaita (LGPL) and node-gtk (MIT).

---

## 3. Architecture

```
src/
├── main.ts              bootstrap: Adw.Application, window, header, actions
├── core/                ★ pure TypeScript — NO `gi:`, NO Node APIs
│   ├── timer.ts          state machine: idle → holding → ready → running → stopped
│   │                     (+ WCA inspection: 15 s → +2, 17 s → DNF, splits)
│   ├── time.ts           formatting, penalty math, DNF-as-∞, inspection clock
│   ├── stats.ts          ao5/ao12/mo3/aoX trimming, best single/avg, PB target
│   ├── session.ts        Solve & Session models, CRUD, undo, penalties, comments
│   ├── sessionLibrary.ts session index rules: names, ids, active, scramble type
│   ├── scrambleTypes.ts  206-type catalogue + 44-group menu (data-driven)
│   ├── scrambleFeed.ts   prefetch state machine: type switch / advance / ready
│   └── preferences.ts    Preferences shape, defaults, per-field validation
├── scramble/
│   ├── worker.ts         worker_threads host for cstimer_module
│   ├── protocol.ts       typed request/response messages worker ↔ main
│   ├── cstimerLang.ts    type-id → cstimer_module language-table mapping
│   └── service.ts        prefetch queue — next scramble is always warm
├── platform/
│   ├── store.ts          atomic JSON persistence in XDG data dir (Node fs)
│   ├── random.ts         CSPRNG seeding (crypto.getRandomValues)
│   └── audio.ts          inspection beeps — pre-rendered C6 WAV pulses played
│                         fire-and-forget: pw-play → paplay → gst → aplay
├── ui/                   GTK widgets only; talks to core via callbacks
│   ├── timerLabel.ts     monospace digits; gray/red/green/white + inspection
│   ├── scrambleTypeButton.ts  header: one flat button, label ellipsizes (J)
│   ├── scrambleTypeSelect.ts  two Gtk.DropDown selectors — UNHOOKED 2026-10-04
│   ├── scrambleTypePicker.ts  Adw.ButtonRow → Adw.Dialog chooser (both layouts)
│   ├── scramblePanel.ts  scramble text + Gtk.Picture diagram (overlay)
│   ├── timesList.ts      Gtk.ColumnView of solves
│   ├── statsStrip.ts     ao5/ao12 line under the timer
│   ├── statsPanel.ts     statistics (Adw.Dialog)
│   ├── sessionMenu.ts    session radio-menu (Gtk.MenuButton + Gio.Menu)
│   ├── shortcuts.ts      Adw.ShortcutsDialog (built fresh on app.shortcuts)
│   ├── preferences.ts    Adw.PreferencesDialog: Timer / Appearance / Scramble
│   └── stringExpression.ts  makeStringExpression() — ComboRow labels (decision 10)
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
   - Center column: scramble text (monospace, display only — copy lives on
     the header's copy button, `Ctrl+C`) → big timer →
     ao5/ao12 label strip.
   - Two headers (layout F, 2026-10-01): the **sidebar's** header carries
     the app name and the app menu (About / Keyboard Shortcuts / Quit),
     with the session switch as a row under it; the **content** header
     carries the sidebar toggle, the scramble type button (two dropdowns
     until 2026-10-04),
     refresh and an app-functions menu (empty until M4+ fills it).
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

10. **Scramble-type selector — two dropdowns, not one searchable list.**
    *Superseded for the header on 2026-10-04* — the header now shows one
    ellipsizing button (`scrambleTypeButton.ts`) — but the reasoning and the
    search gotcha still stand for any `Gtk.DropDown` holding strings, and the
    Preferences `ComboRow` is one. Mirrors
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
| Memory consumption report | **Checked at M3** (see §6): 10 000 solves cost ≈ +26 MB, scrolling adds nothing |
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
| **M4** | Statistics ported from csTimer rules (ao5/ao12/mo3 trimming, DNF-as-∞, PB target), penalties `+2`/`DNF`, WCA inspection with beeps, per-session scramble type | Feature-complete core |
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
`expression` pitfall that made search silently do nothing). *Both dropdowns
were unhooked 2026-10-04 in favour of one ellipsizing header button; the
module is kept and the pitfall still applies to the ComboRow.*

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

### M3 — landed 2026-10-01

Sessions. Core: `src/core/sessionLibrary.ts` owns the rules — names unique
case-insensitively, the library is never empty, the last session cannot be
deleted, `create()` switches to the new session, and a session's **id is its
file name, which never changes on rename** (22 tests). Storage:
`sessions/_index.json` + `sessions/<id>.json` under the XDG data dir, ids
validated `/^[a-z0-9][a-z0-9-]{0,63}$/` before they touch a path, a missing or
corrupt index rebuilt from the session files on disk — that rebuild *is* the
M2→M3 migration (`default.json` becomes the `default` session). Solves stay on
the debounced 250 ms atomic write; the index writes immediately (a crash right
after a delete must not leave a ghost entry), `flush()` on exit, and
`deleteSessionFile()` drops a pending write first (16 store tests). UI:
`src/ui/sessionMenu.ts` — one `Gtk.MenuButton` packed **after the sidebar
toggle** (`[toggle][session ▾][WCA][3x3x3][refresh] … title …`), its label the
active session, its `Gio.Menu` a radio-section of sessions plus
`New session… / Rename… / Delete…`. Name dialogs are `Adw.AlertDialog`s with
live duplicate validation (accept stays insensitive until the name is usable);
the delete confirm states the solve count. The sidebar follows the active
session and retitles itself (`name / N solves`); `main.ts` keeps one cached
`Session` per id with its own save subscription, so a change to a background
session still reaches disk — that is what lets an undo toast outlive the
switch that followed it.

Two findings worth carrying forward: `AdwAlertDialog`'s `default-response`
makes the accept button the dialog's default widget, which claims focus on
map — rename's accept is sensitive immediately, so the caret left the entry
(New only worked because an empty name keeps Create insensitive); the dialog
re-claims focus (and selects the initial text) on `map`. And the header grew
its default window to **1080×540**: measured at 900 the header had 660
logical against ~686 of natural demand, so GTK shrank the session label and
the window title (the math is in the `setDefaultSize` comment; staying right
when the window shrinks is M6).

Accelerators (real menu accelerators, GtkMenuButton draws them beside their
items): `<Ctrl+S>` session menu, `<Ctrl+N>` new, `F2` rename,
`<Ctrl>Delete` delete — plain Delete stays the solve list's key.

Evidence:

- **96 Vitest tests green** (M2's 58 + 22 sessionLibrary + 16 store);
  `npm run typecheck` clean.
- **Every flow driven end-to-end in the running app**, keyboard-only: create
  (`meet weekly` → id `meet-weekly`), switch (index `active` + header label +
  sidebar rows all follow), rename via `F2` (typed text *replaced* the old
  name — the focus fix — and the id stayed `default`), delete (confirm →
  file gone → active fell to its neighbour), duplicate name (Return produced
  no accept), and Delete being inert while only one session remains.
- **Cross-session undo:** deleted a solve in `scratch`, switched to
  `Default`, clicked Undo — the solve came back in `scratch.json` while
  `default.json` kept its 9.
- **Restart-safe:** relaunch restored `active: default`, the name and all 9
  solves.
- **Memory (§5 risk row), measured with 10 000 solves via `XDG_DATA_HOME`:**
  baseline (9 solves) 296.5 MB → 312 MB fresh, 327 MB after recording a
  solve, **322.6 MB after 15 wheel-scrolls** — ≈ +26 MB for 10k records, and
  scrolling *releases* rather than accumulates (the ColumnView stays
  virtualized). Trap for the next one: the store lives at
  `$XDG_DATA_HOME/cstimer-gtk/sessions/`, one directory deeper than a naive
  guess — a wrong path silently boots an empty `Default` instead of failing.

### M4 — landed 2026-10-02

Feature-complete core: statistics, penalties, comments, WCA inspection, and
the app-functions menu M3 left spec-empty — plus a queued feature
(per-session scramble type). Five stages, one feature commit.

**Statistics (stages 1–3).** `core/stats.ts` ports csTimer's rules — the *math*,
not the DOM (AGENTS): ao5/ao12/mo3 with trimming (best/worst dropped, DNF
scores ∞ so it lands in the worst slot and can kill a 3-of-5 average), aoX
generalised, best single/average and a PB target, all strictly per-session.
Penalties and comments join the model and the store: `+2` adds 2 000 ms at
read time, `DNF` scores ∞, a comment rides the solve. UI: an ao5/ao12 strip
under the timer, a `Statistics` `Adw.Dialog` (per-session aggregates + target),
both behind the content header's app-functions ⋮ — the section the handoff
flagged as empty — with `<Ctrl+T>` for the dialog.

**Edit dialog (stage 4).** `Adw.Dialog` over the selected solve: radio
`ok`/`+2`/`DNF` (with mnemonics), a comment `Gtk.TextView`, the solve's
scramble and full timestamp; the dialog re-claims focus on `map` (the M3
`default-response` trick) so typing lands in the comment box, not on the
default button. `<Ctrl+E>` opens it; `<Ctrl+1/2/3>` grade the selection
directly.

**WCA inspection (stage 5).** A sixth timer state, `inspecting`: the first
ready→release starts the 15 s countdown (`formatInspection`, orange, clamped),
the second starts the run graded by the inspection's age at release —
≥ 15 s → `+2`, ≥ 17 s → `DNF` — carried through `onSolved(elapsedMs, penalty)`
into `session.add()`. Esc cancels; releasing early during a mid-countdown hold
resumes the countdown; toggling off mid-countdown cancels, mid-hold drops the
grade. The 8 s and 12 s cues fire exactly once each (per-inspection dedup, so
pause/resume jumps cannot double-beep) — pre-rendered C6 WAV pulses via
`platform/audio.ts`, `pw-play → paplay → gst-launch → aplay`, first present
wins, fire-and-forget (§5's mitigation — no GI audio). `app.inspection`
starts ON and stays memory-only until M5's preferences.

**Per-session scramble type (feature, `8b30797`)** — queued by the user: the
type choice belongs to the active session. `SessionEntry.scrambleType?`
(absent = default `333`), `setScrambleType()` emits `retyped` into the
existing index-save subscription; `applySessionType` runs on every switch and
at startup, moving both controls (the header button and the row's chooser)
through `selectType()` **without**
re-announcing `onChange` (which would write the session's own value back onto
itself), and regenerating the feed only when the type actually differs.
`create()` inherits the active session's type; `loadIndex` shape-checks the
stored string (the index stays hand-editable).

Two findings worth carrying forward:

- **A stateful action with a `'b'` parameter type kills every no-argument
  activation** — GTK refuses them ("Trying to invoke action without
  arguments…") and the toggle dies silently. Plain toggles take `null`;
  only `sessionSwitch` is genuinely parameterized. User-caught; both
  directions verified after the fix.
- **Inspection hold behavior is environment, not code** — a physical
  long-hold in Xephyr bounces through the nested server's stock XKB
  auto-repeat (release/press pairs), faking a countdown-on-hold bug that
  never reproduced under GNOME with Wayland *or* `GDK_BACKEND=x11`
  (user-tested, both backends). Don't add timing heuristics; drive hold
  flows with synthetic input.

Evidence:

- **164 Vitest tests green** — 96 (M3) → 148 by stage 4 → 160 with stage 5 →
  164 with the per-session type; `npm run typecheck` clean.
- **User-verified on the live app:** `+2` and `DNF` from the edit dialog
  round-trip into list and store; Esc cancels inspection; both directions of
  the inspection toggle with a clean log; correct hold behavior under GNOME
  on both GDK backends; and the per-session type ("indeed default shows
  4x4x4") after automated round-trips.
- **Automation on Xephyr `:99`:** countdown/+2/DNF label states captured;
  both cue WAVs on disk; graded solves round-trip the store; the type
  round-trip checked with `jq` against `_index.json` after every switch
  (444 ↔ 555 on `Default`, distinct types per session, both restored on
  every switch).
- **Tooling lessons recorded in [`tools/README.md`](./tools/README.md):**
  `XGetImage` staleness is not XWayland-only — `shot` *and* `rootshot` on
  `:99` replayed minutes-old frames, so state claims were checked against
  the store or a human, not pixels; and the type chooser is driven through
  its dialog rather than a popup — see the recipe in
  [`tools/README.md`](./tools/README.md).

---

### M5 — landed 2026-10-02

What makes the app yours: a preferences dialog that owns every setting, dark
mode, the scramble diagram, and a shortcuts window that documents every
binding. Three feature commits (`9f2f59d`, `02d6ae1`, `cf0963c`), then the
shortcut sync and this record.

**Preferences (stage 1, `9f2f59d`).** `core/preferences.ts` is the pure model
— the `Preferences` shape (hold threshold, inspection, its sound cues, the
scramble image, colour scheme), defaults, per-field validation: a bad value
falls back, it never takes the file down. `prefs.json` lives beside the
sessions, quarantined on damage like the index, saved immediately and
atomically. `Timer.setHoldThreshold()` lands the dialog's value on the very
next hold (clamped, NaN-safe). The dialog is an `Adw.PreferencesDialog` built
fresh on open — Timer page first (`SpinRow`, seconds in, ms out, plus the
inspection and sound-cue switches) — reachable from the app-functions ⋮ via
the `app.preferences` action on `<Ctrl+comma>`. One `applyPreferences()` path
merges + persists + pushes, so the header check item, the timer and the file
cannot disagree; inspection is no longer memory-only.

**Dark mode (stage 2, `02d6ae1`).** The `colorScheme` preference (`system` /
`light` / `dark`) drives `Adw.StyleManager`, applied before the window is
presented — first paint is already right — and on every change through the
same `applyPreferences` path: `system` → `DEFAULT` (the default manager,
follows the desktop, light fallback), `light`/`dark` → `FORCE_*`. The dialog
gains its Appearance page: an `Adw.ComboRow` whose label factory is fed with
`setExpression(makeStringExpression())` — the positional/setter path, since
the expression *property* still aborts node-gtk (decision 10).

**Scramble diagram (stage 3, `cf0963c`).** The image rides the same worker
round trip as the text (`scrambleWithImage`), so both land in one frame; an
image `Map` in `main.ts` (keyed `type\0scramble`, capped at 16) feeds the
panel through a `getImage` getter that also covers the ghost. Images are
always fetched (~1 ms in the worker) — `prefs.scrambleImage` only gates
*display*, so the switch is instant and reflows nothing. The picture is
handed to `main.ts` as an **overlay child of the whole view**: GTK4 does not
count overlay children in the size request, so the diagram floats in the
bottom-right corner (user call) without ever moving the text or the timer, at
any window size. Transparent background (user call) — the SVGs arrive
transparent from `cstimer_module`; the white card of the first draft read as
a stray box. `Rsvg-2.0` joins the generated typelibs, and the dialog gains
its Scramble page (the image switch) in this stage.

**Shortcut sync (stage 4).** `src/ui/shortcuts.ts` now lists every binding,
cross-checked against each `setAccelsForAction` and the key controller — the
two that were missing are `<Ctrl+comma>` (preferences) and `Escape` (cancel
the inspection countdown); the header comment was rewritten to match.

**Parked out of M5 (user calls):** the golden-ratio timer position nudge — a
later task; and the diagram's thin outlines read low-contrast on the dark
theme (accepted for now, noted in a code comment).

Findings worth carrying forward:

- **Overlay children take no size-request space** (measured, stage 3) — the
  right home for anything that must float without shifting layout; expect to
  lean on it again in M6, where the timer and scramble finally use the space
  they get.
- **The probes need the whole runtime**: `prefs_probe` run under bare
  `--import tsx` dies with `ERR_UNSUPPORTED_ESM_URL_SCHEME` on the `gi:`
  protocol — always start it with `--import tsx --import node-gtk/register`.

Evidence:

- **180 Vitest tests green** — 164 (M4) → 180 with the preferences model,
  `prefs.json` round-trips and the hold-threshold clamping; `npm run
  typecheck` clean.
- **`prefs_probe` ALL PASS** — 18 checks against the real dialog (every
  row's read/write round-trip through `prefs.json`, including the ComboRow).
- **`scramble_probe` 206/206** — every type generates; 177 with images, 29
  without (`getImage` returns false, never throws).
- **User-verified on the live app:** it runs dark; `<Ctrl+comma>` opens the
  dialog and it is closed again; the diagram sits in the bottom-right corner
  with a transparent background.
- **Shortcuts window captured fresh** (stable double-shot, no stale-frame
  doubt) with both new chips rendering — `Escape` and `Ctrl+,`, no empty-chip
  parse failures.

### M6 — landed 2026-10-02

Adaptive layout. Every threshold and both decisions live in
`src/core/layout.ts` as pure functions (`layoutFor`, `timerMargins`,
`BREAKPOINTS`); `src/main.ts` only measures and applies. Five **disjoint**
width bands (S ≤480, C 481–600, B 601–800, M 1200–1599, L ≥1600) as
`Adw.BreakpointCondition`s written from those same constants, plus
`Gdk.Surface::layout` for what bands cannot see (height, in-between sizes)
and `Gdk.FrameClock::after-paint` for the timer nudge.

- **Drawer sidebar ≤800** — `Adw.OverlaySplitView.collapsed`, auto-hide on
  collapse / auto-show on uncollapse, wired exactly as libadwaita's own
  "Overlay Sidebar" demo: one bidirectional binding between `show-sidebar`
  and the header toggle, so the property *is* the state. `<Ctrl+B>`
  (`app.sidebar`) and `Escape` (drawer only) are the other two callers of
  `setShowSidebar()`; both are in the shortcuts window.
- **Selectors leave the header** for their own row at ≤600 — that width band
  is the whole rule (user call, 2026-10-04). It was previously two conditions:
  the band, **or when the measured labels stopped fitting** — `layoutFor` took
  the header's natural width and handed the row over when it exceeded the room
  by more than `headerSlack` (200). Measured then: the header asks **724px**
  with a 3x3x3 session and **1186px** with the catalogue's worst pair (FTO
  category + Diamond type), the second pushing the window controls off the edge
  of a 900px window, so the band alone could not be the rule. That second
  condition existed only because the two Gtk.DropDowns could *not* shrink; the
  header's selector is now one button whose label ellipsizes, so
  `headerSlack` and the demand measurement went with it.
- **Growing sidebar / scaling**: `maxSidebarWidth` 320 → 380 (≥1200) → 440
  (≥1600); timer `s`/`m`/`l` (also `s` below 480 wide *or* 480 tall);
  scramble slot 60/76/88 chars, 100/160/220 px tall; diagram cap 440×150 →
  500×170 → 560×190 (the last two only when tall).
- **The nudge** (user rule, 2026-10-02, **halved to a quarter the same
  day**): the timer block sits a quarter of a diagram's height *up* and a
  quarter of its width *left* of where it would otherwise centre — and
  nowhere else moves it (the golden-section rule was deleted). Both margins
  are clamped by `NUDGE_SLACK` (16) against the **window**, never against
  the content's own allocation.
  **Phone form factor (user call, 2026-10-03)**: at ≤600 (tiers C and S, the
  same `selectorRowMax` band that moves the selectors out) the sideways nudge
  is **dropped** — the timer stays horizontally centred — and the lift
  **doubles to half a diagram-height** (`phoneFormFor()` → `phoneForm`, read
  from the surface width like every other layout number). Clamping is
  unchanged, so the invariant still outranks the rule.

Decisions worth carrying forward:

- **No intent memory for the sidebar.** An earlier `sidebarWanted` +
  `notify::show-sidebar` override fought libadwaita's auto-show and ping-
  ponged (43 flips, two handler re-entries each, in one session). A closed
  list reappearing when the window grows back is the accepted price of the
  binding — and `Escape` still closes a drawer.
- **Ground truth is the surface, not a widget allocation.** Mid-resize the
  widgets answer with the *old* size (measured: surface 460, window 890,
  split 762 — three true numbers from three different moments), and a
  decision from any of them is a decision about a window that no longer
  exists. `groundWindowSize()` reads the surface minus the CSD shadow
  (measured 10×10) and feeds both `layoutFor` and the margin clamp.
- **Never clamp against a box that GTK has already given its minimum.** The
  content's allocation contains the margin being computed, so that clamp is
  a tautology that settles *above* the window and clips (439px of content in
  a 370px window, `libadwaita` then logging "snapshot … without a current
  allocation"). It is also what made the app look frozen: four shrinking
  passes in a row trip GDK's `layout continuously requested, giving up after
  4 tries`, and the frame that never comes looks like a hung UI.
- **A just-appeared widget reports 0.** The selector row is reparented into
  existence at ≤800 and has no allocation when `updateNudge` measures it —
  reading `getSize()` put the region 34px high and produced one frame of
  overflow per descent; take the row *natural* when it is 0.

Evidence:

- **203 Vitest tests green** (180 at M5 → 199 for the layout/nudge core →
  203 with the measured-header rule), `npm run typecheck` clean.
- **`breakpoint_probe` answers all four questions**: apply/unapply fire with
  current sizes, all five disjoint bands fire on every crossing up and down,
  `Gdk.Surface::layout` reports each resize, and `set_default_size` does
  *not* resize a presented window (so verification drives sizes with
  `xdotool windowsize`, in surface px: widget = surface − 10).
- **Full band walk, keyboard only, 0 warnings**: 900 → 700 → 550 → 460 →
  `<Ctrl+B>` → `<Ctrl+B>` → `Escape` → 400×360 (the floor *then*; it is
  360×360 since the HIG change in §7) → 1700 → 900,
  with an aliveness check after every step. The log shows exactly one
  `[sidebar]` line per state change (no ping-pong), `CSD shadow 10x10`, and
  `[layout] 390x350 (win 350)` at that floor — content under the window, no
  `AdwToastOverlay exceeds` line anywhere. Re-verified at the new floor:
  `350x350` (360×360) and `350x630` (360×640), still zero warnings — §7.
- **Thresholds re-checked against measurement**: at 801 side-by-side the
  header absorbs 163px (natural 724 in 560) with every control drawn, so
  800 stands; the selectors' own row fits from 531 (its natural with the
  longest labels is 521) so 600 stands; with those labels at 900 the
  controls *were* clipped (absorption 536) and at 950 fine (486) — which is
  what `headerSlack: 200` decided, switching to the row early rather
  than gambling on how much GTK will absorb. **The clipping above is the
  reason `headerSlack` existed, and it was removed 2026-10-04** along with
  the demand measurement, once the selector could ellipsize instead; the
  724/561/521 numbers remain the record of why 800 and 600 were chosen.
- **The nudge measures right**: at 900 the timer block's centre lands 1.5px
  from `content centre − diagram width / 4` (519 measured vs 520.5
  predicted, screenshot pixel scan), and the halving from /2 was visible in
  the same geometry — the old rule put it at 469 (vs 471 predicted), so the
  digits moved 50px right and 38px down, which is the 1/2 → 1/4 change on
  both axes. It moves with the diagram at every tier.

---

## 7. Session handoff

- Project rules live in [AGENTS.md](./AGENTS.md) (auto-loaded every session).
- This file is the plan of record; update §6 checkboxes/notes as milestones
  land so a cold session can pick up correctly.
- **M6 landed 2026-10-02** — adaptive layout is in and verified (the dated
  block in §6 has the decisions and the measurements). What a cold session
  needs to know: `src/core/layout.ts` owns every threshold, the sidebar's
  `show-sidebar` is a plain libadwaita binding (do not add intent memory
  back), and sizes are read from the *surface* because widgets lag a pass
  behind during a resize. `npm test` = **219 tests**; the manual band walk
  (keyboard, Xephyr `:99`) is in `tools/README.md` → Recipes.
  **Next milestone: none scheduled** — the agreed backlog is stackmat and
  charts (§1), then packaging if ever; M7+ should be picked, not assumed.
  Still open from earlier user calls: the diagram's thin outlines read
  low-contrast on the dark theme (accepted for now, noted in a code
  comment), and one startup-only `AdwToastOverlay exceeds` warning with the
  catalogue's longest labels (its stated cause was the first frame measuring
  the selectors in the header before any tier had run — that measurement went
  with `headerSlack` on 2026-10-04, so re-check whether it still reproduces).
  The stats
  rule stands: **per-session, always** (M3's scope), `src/core/` owns the
  math, and csTimer's GPL source may be ported for the *math*, not the DOM
  (AGENTS.md).
- **Layout: "F" (2026-10-01)** — the solve list is the **left** sidebar
  (`sidebarPosition: START`, width clamped 240–320 logical), and the sidebar
  owns the app chrome: its header reads `csTimer GTK … [app menu ⋮]`, the
  session switch is a full-width row under it (its label *is* the current
  session name), then the list. The content header reads
  `[toggle][WCA][3x3x3][refresh] … [app-functions ⋮][window controls]` with
  no title — the app name lives in the sidebar header; the window title still
  goes to the taskbar. This layout came out of the A–E mockup comparison
  (`mockups/`, GTK and HTML variants — deleted once F landed in the real
  app); the default window is back to **900×540**, since the header lost the
  title and session pill (math in the `setDefaultSize` comment). All three
  items deferred from here are **M6's and now landed**: the long
  category/type selections that outgrow the header (they move to their own
  row instead, §6 M6), the drawer breakpoint (≤800), and the sidebar width
  caps (320 → 380 → 440). About / Keyboard Shortcuts / Quit sit in the
  sidebar app menu — unreachable while the sidebar is closed, which is why
  `<Ctrl+Q>` stays the quit path that always works (`<Ctrl+B>` reopens the
  list, and `Escape` closes the drawer).
- **Solve list columns (user call, 2026-10-02)** — the sidebar reads
  `# | Time | ao5 | ao12`; the `Solved` timestamp column is gone (the moment
  is still spelled out year-to-second in the Edit dialog, which is where a
  solve is read individually). The averages are **as of their own solve** —
  the window *ending* there, not today's number repeated on every row — so
  the column reads as the history of a run. `rebuild()` computes them in one
  pass via `windowAtEach()` (src/core/stats.ts, 207 tests) and a row shows an
  em dash until its window fills, the same rule as the strip under the timer.
  Cross-check on the shipped session: the newest row reads 6.79 / 5.98 at the
  same moment the strip does, and row 9's ao5 (2.18) is its own five with the
  DNF trimmed away.
- **Scramble is display-only, copy is a button (user call, 2026-10-02)** —
  the text is no longer selectable (`selectable: false`), so it left the
  focus chain with it; copy lives on the header beside refresh and on
  `<Ctrl+C>`, with a toast as the only proof the key did anything. GDK4 has
  no `clipboard.set_text`, so the clipboard takes a
  `Gdk.ContentProvider.newForBytes('text/plain;charset=utf-8', …)` — verified
  by pasting back through the edit dialog's comment box (no xclip on this
  box). Two follow-ups from measuring it: the header's demand went 724 →
  **808px** with the extra button, so the measured-header rule now switches
  the selectors to their own row below **848** wide instead of 764 (row at
  835, header at 850 — measured), and `Ctrl+C` inside the comment box still
  copies the *selection*: GTK gives a focused editable its own key bindings
  before the app's accelerators.
- **Keyboard drives the session UI** (useful for testing, shipped as real
  accelerators): `<Ctrl+S>` opens the session menu, `<Ctrl+N>` new, `F2`
  rename, `<Ctrl>Delete` delete — after opening the menu, `Down` + `Return`
  selects a session (the menu focuses its *first* item, not the checked one).
  The keyboard reference is a stock **`Adw.ShortcutsDialog`**
  (`src/ui/shortcuts.ts`, built fresh on `app.shortcuts`, no accelerator of
  its own) — it replaced `Gtk.ShortcutsWindow` (deprecated since GTK 4.18)
  on 2026-10-02: same sections/items shape, but it renders as a libadwaita
  dialog *inside the app's window* rather than as a toplevel, it brings its
  own search field, and it constructs and renders fine under node-gtk — so
  the planned fallback of putting the keys in the About dialog body was
  never needed and is now moot. Watch the key names: gdk_keyval names are
  case-sensitive (`space`, not `Space`), or the chip renders empty (checked
  with `Gtk.acceleratorParse`: all 18 entries parse).
- **Narrow selector: one row at the bottom (user calls, 2026-10-03)** — below
  ~600 the header's type control gives way to an **`Adw.ButtonRow`** reading
  `Category - type`, pinned to the **bottom of the main area** (it used to sit
  under the header). **From 2026-10-04 both open the same `Adw.Dialog`**: the
  header holds one button (`scrambleTypeButton.ts`) rather than two
  dropdowns, so there is one list, one search and one `onChange` path for
  every layout. The dialog has the current
  category's types in a boxed list (✓ on the live one), an **up** button that
  swaps in all 44 categories — landing on *the category you came from*, not
  on WCA (it used to select the first every time; fixed) — and a search entry
  over all 206 types, labelled `Category - type` because "PLL" exists twice.
  What the measurements forced: a plain `AdwDialog` does **not** close on
  Escape (three Escapes with the search entry focused left it up), so Escape
  is bound in capture phase — first clears the query, second closes; GTK4's
  `GtkListBox` activates and moves **nothing** from the keyboard (Down and
  Return reach the controller, no `row-activated` ever follows), so arrows and
  Return are bound explicitly; `AdwActionRow` titles are parsed as *markup*,
  so `useMarkup: false` (else `3x3x3 Roux - LSE <M, U>` logs a parse
  warning). Layout consequences: the row's slot is subtracted from the timer's
  region in `updateNudge`, and the diagram — anchored to the same bottom edge
  — is lifted by exactly that slot, or the picture would be drawn over the
  row. Also: the first frame now takes its tier from the *asked-for* size
  before `present()`, because with `lsll` selected the old order asked **928px
  in an 890px window** on frame one (0 warnings since).
- **Window floor: 360 wide (user call, 2026-10-03)** — the GNOME HIG's
  minimum for the phone form factor (developer.gnome.org/hig/guidelines/
  adaptive.html); 400 was this project's own number, and the comment that
  justified it (the two dropdowns wanting ~282px) died with them. Height
  stays 360, so the floor is square, and the width now equals libadwaita's
  own `AdwWindow` default (360×200) — `minHeight` still performs the
  override the breakpoint docs ask for. Measured on the new floor:
  **360×360 → `[layout] 350x350 (win 350): drawer, selectors in their own
  row, timer s`**, all seven header glyphs present, **0 warnings**; phone
  shape **360×640 → `350x630`** (height clears `shortMax`, so the scramble
  slot keeps its 160), timer at y277–386 and the diagram at y419–564 —
  clear of each other and of the bottom row — with the chooser's sheet
  growing to eight visible rows; and with the longest label in the
  catalogue (`FTO (Face-Turning Octahedron) - Diamond random state`) the
  ButtonRow ellipsizes to `… - D…` **and the window still reaches 350
  wide**, i.e. the label never raises the floor. The `390x350` above is
  the old floor's number, kept for what it proved.
- **Scramble panel stability (2026-10-01)** — the timer must not move when
  the scramble updates, in either direction. The spinner/status row is a
  `Gtk.Overlay` child of the text slot, never stacked under it (stacked cost
  +22 px against a one-line scramble — measured 86 vs 64; GTK4 does not
  measure overlay children). And while the feed is busy the last scramble
  stays on screen as a dimmed ghost (`.scramble-text.pending`, opacity 0.4),
  so a tall text's slot never collapses: the panel height is the text's, in
  every state. First load has no ghost (bare slot); a warm failure still
  reports *under* visible text — the one status that shares the panel with a
  scramble. User-verified live on 4x4.
- To resume: read this file + the current milestone row, check what exists in
  `src/`, continue from there.
- Before trusting a screenshot of the running app, read
  [`tools/README.md`](./tools/README.md): X captures are often stale — on
  XWayland *and* on the nested server (M4 saw `shot` and `rootshot` on `:99`
  replay minutes-old frames) — and the duplicate-instance rule means a second
  `npm start` silently attaches to the first.
