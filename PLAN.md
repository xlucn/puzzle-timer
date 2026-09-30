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
│   └── eventbus.ts       minimal pub/sub the UI subscribes to
├── scramble/
│   ├── worker.ts         worker_threads host for cstimer_module
│   └── service.ts        prefetch queue — next scramble is always warm
├── platform/
│   ├── store.ts          atomic JSON persistence in XDG data dir (Node fs)
│   ├── random.ts         CSPRNG seeding (crypto.getRandomValues)
│   └── audio.ts          inspection beeps (GStreamer GI, pw-play fallback)
├── ui/                   GTK widgets only; subscribes to core via event bus
│   ├── window.ts         Adw.ApplicationWindow + OverlaySplitView
│   ├── timerLabel.ts     monospace digits; gray/red/green/white states
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
   - Header bar: session `Adw.DropDown`, scramble-type dropdown, stats button,
     menu.
   - Statistics in an `Adw.Dialog`; settings in `Adw.PreferencesDialog`.
   - `Adw.ToastOverlay` for undo ("Solve deleted [Undo]"), `Adw.StatusPage`
     for the empty state.

5. **`Gtk.ColumnView`, not `Gtk.ListBox`** — ListBox builds every row and a
   session can hold thousands of solves; ColumnView is virtualized.

6. **Storage** — one JSON file per session under `GLib.get_user_data_dir()`,
   atomic write (temp file + rename) after each solve, debounced. Revisit only
   if profiling shows a problem (`node:sqlite` is built into Node).

7. **Penalties / shortcuts** — context menu (`Gtk.PopoverMenu`) on a solve row
   for `+2`, `DNF`, comment, delete. Shortcuts mirror csTimer: `Ctrl+Z` undo,
   `Ctrl+1/2/3` = OK/+2/DNF on the latest solve, `Alt+1-7` scramble types.

8. **SVG scramble images** — GTK4 has no SVG support; use `Rsvg-2.0` via GI
   → `Gtk.Picture` (typelib confirmed present on this machine).

9. **Wayland** — no global key grabs. Hold-space works only while the window
   is focused (same as csTimer in a browser tab). GlobalShortcuts portal is a
   possible later addition, not in MVP.

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

**Post-MVP backlog:** stackmat, charts (see §1), then packaging if ever needed.

---

## 7. Session handoff

- Project rules live in [AGENTS.md](./AGENTS.md) (auto-loaded every session).
- This file is the plan of record; update §6 checkboxes/notes as milestones
  land so a cold session can pick up correctly.
- To resume: read this file + the current milestone row, check what exists in
  `src/`, continue from there.
