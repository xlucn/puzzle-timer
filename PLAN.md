# cstimer-gtk — implementation plan

A native Linux cube timer that works like <https://cstimer.net/>, built with
GTK4 + libadwaita via node-gtk. This document is the durable plan and the
handoff artifact between sessions: a cold session should read this file and be
able to continue at the current milestone.

---

## 1. Scope

**MVP (M0–M5):** timers, scrambles, sessions, statistics.

**Scheduled next (M7–M14, decided 2026-10-05).** Order: size preferences
first (small and self-contained), then **i18n**, so every string the later
milestones add is written translated instead of swept afterwards (§7 notes
where that order is convention rather than dependency):

- **M7 — size preferences.** Timer readout, scramble text and scramble
  diagram sizes, each a *scale* handed to `layoutFor()` rather than a
  replacement for its tiers (decision 14).
- **M8 — i18n.** A `t()` over typed catalogs (`src/locales/en.ts` is the
  source of truth, `zh-CN.ts` is `Record<keyof typeof en, …>` so the compiler
  lists every missing translation), a `language` preference
  (`system | en | zh-CN`, restart to apply), and `Intl` for dates and counts.
- **M9 — csTimer-compatible import/export.** One JSON codec, both
  directions (was "dropped as not needed" on 2026-09-30; reinstated by
  decision 2026-10-05). Format evidence in §5, decisions 11–12 in §4.
- **M10 — records and statistics**: PB history (value, date, how long it
  stood), σ / best / worst / range, ao50/ao100/ao1000, per-day activity
  (solves/day, current + longest streak, best day). The Statistics dialog
  grows tabs (`Adw.ViewStack`).
- **M11 — charts** (time trend, distribution), moved out of the long-term
  list below by the same decision: `Gtk.DrawingArea` + Cairo line/path
  drawing; math ported from csTimer's `src/js/stats/trend.js` and
  `src/js/stats/distribution.js` (GPL — port the math, not the DOM). Stats
  already live in `core/`, so charts are rendering-only on top.
- **M12 — release readiness.** Start versioning and prepare a public source
  release: one version source of truth (`package.json`), a CHANGELOG, an
  About dialog that matches reality (it currently shows a *hardcoded*
  `0.1.0`, the wrong licence enum, and a **deprecated** widget), a user-first
  README that states plainly how AI/LLM assistance was used, plus an icon and
  a public name. The last two are gated on open decisions — see §6 M12.
- **M13 — touch input, and the narrow-window leftovers.** Today the app
  cannot start a solve without a Space key: there is **not one gesture or
  touch controller in `src/`**. Touch-hold on the timer mirrors Space exactly
  (decision 15), long press and swipe drive the solve list, and the known
  360×360 diagram/timer overlap gets fixed. Entirely desktop-verifiable with
  the existing harness — see §6.
- **M14 — phone runtime (an evaluation, not a port).** The verdict on
  whether this can run on a real Linux phone at all: arm64 Node ≥ 20.6, a
  node-gtk native binding build, audio without `pw-play`. Its deliverable is
  a written result plus a scoped packaging milestone — or a documented "not
  viable". **Only M14 may reopen the packaging line below.**

**Explicitly out of scope for now:**
- Bluetooth smart cube support (decided: not in v1)
- Virtual cube, solvers, batch generators, cross-session stats
- Packaging/distribution (personal use only for now) — **M14 may reopen
  this**, and no other milestone may.

**Long-term goals (added by decision, not scheduled):**
- **Stackmat support** — `serialport` npm package + udev rule; protocol logic
  ported from csTimer's `src/js/hardware/stackmat.js` (GPL). Input source
  feeds `core/timer.ts`, so it is purely additive.

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
│   ├── scrambleTypePicker.ts  shared Adw.Dialog chooser (opened by one button)
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

11. **i18n — catalogs are TypeScript modules, not JSON files.**
    `src/locales/en.ts` exports the message table `as const`; every other
    locale is typed `Record<keyof typeof en, Message>`, so an untranslated or
    misspelled key is a **compile error** rather than a raw key rendered in
    the UI. It also keeps `src/core/` pure (rule 1): no `fs`, no JSON loader,
    and `t()` is unit-testable by setting the locale and asserting. Plurals
    go through `Intl.PluralRules` (`one`/`other` for English, `other` only for
    Chinese). The runtime is a module-level locale plus `t(key, params?)` in
    `src/core/i18n.ts` — deliberately *not* a translator object threaded
    through every widget factory, which would touch every call site for no
    testability gain. The language lives in `Preferences` and applies at
    **startup**: headers and menus are built once, so changing it shows a
    "restart to apply" toast instead of a live re-render.

12. **csTimer file compatibility — a pure codec, and what the export must
    contain.** Parsing and serialising live in `src/core/csTimerFormat.ts`
    (pure, round-trip tested); only the file chooser and the toast are UI.
    Two findings from reading csTimer's `export.js` and `lib/storage.js`
    shape the export: `loadData()` runs `localStorage.clear()` when the file
    has a `properties` key, and `storage.importAll()` **overwrites** slots
    `1…sessionN` rather than merging. So the export must carry
    `properties = { sessionN, sessionData }` — omit it and csTimer keeps its
    settings but silently drops every session past *its* current count — and
    importing into csTimer is a **restore**, not an append. csTimer resets its
    own settings to defaults in that case; there is no way to preserve
    settings we were never given, so the confirmation dialog says so. Import
    *from* csTimer is the safe direction and creates one new session per file
    session (`SessionLibrary` already dedupes names).

13. **Statistics growth — one incremental sorted window, not repeated sorts.**
    `bestWindow()` currently sorts every window it inspects; adding ao1000
    would mean ~40 M comparisons over a few thousand solves, and
    `sessionStats()` runs on dialog open, where a 0.5 s freeze is not
    acceptable. M10 rewrites it as an **incrementally maintained sorted window**
    (binary-search insert/remove; `meanWindow` stays the plain-array
    reference implementation the tests speak to). Charts (M11) keep the split
    the rest of the app uses — binning and series math in `core/`, drawing in
    `ui/` — and no Cairo text (rule 6), so axis labels are `Gtk.Label`/Pango
    overlays.

14. **Size preferences scale the tier, they never replace it.** Three new
    preferences — timer readout, scramble text, scramble diagram — each a
    multiplier clamped by `normalizePreferences`. `layoutFor()` takes them and
    applies them to its *own* outputs, so `src/core/layout.ts` stays the only
    file that may hold a threshold (the rule its header already states): the
    tiers keep deciding relative growth and the no-clip invariant, and a
    preference only changes how much of it the user gets. What the scales do
    to each output — timer px = base (72/96/128) × scale;
    `scrambleChars` = base ÷ text scale, because a bigger font fits fewer
    characters in the same width, while `scrambleMaxHeight` (px) × scale
    because the same lines are taller; `diagramMax*` × scale. Two
    implementation notes: the timer's sizes are CSS classes
    (`.timer-display.size-s/m/l`) and GTK4 CSS has no custom properties, so a
    changed scale re-`add()`s that sheet (`styles.add()` returns a handle with
    `remove()`); and `scramblePanel.ts` already duplicates
    `IMAGE_MAX_WIDTH/HEIGHT` on top of the tier's `diagramMax*`, which M7
    removes — a third source of diagram size would be a bug waiting to happen.

15. **Touch is the same input model as the keyboard, not a second one.**
    `Timer` already speaks strings: `keyDown('space', now)` / `keyUp('space',
    now)` is what Space does and `keyDown('escape', now)` is what cancels an
    inspection. A `Gtk.GestureClick` on the timer emits *those same calls*, so
    the hold threshold, the inspection countdown, the +2/DNF grading and the
    "a press while running stops the solve" rule carry over with **no new
    state-machine code and no second set of timings to keep in step**. The
    guards the keyboard path already has must be mirrored — a focused text
    entry owns the press, and press-while-running outranks everything else.
    The same rule reaches the list: long press and swipe drive the selection
    and the delete that Shift/Ctrl-click and right-click drive today, ending
    in the same two-step `remove()`/`restore()` undo toast, so there stays
    exactly one deletion path and one undo. Mouse and touch share
    `Gtk.GestureClick`, which is why this also gives a desktop user
    click-and-hold to start — a behaviour change worth knowing about before
    it ships, not a side effect to discover after.

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

### csTimer data-file format (read from csTimer's source, 2026-10-05)

Read out of `cs0x7f/cstimer` @master — `src/js/export.js` (writes and loads
the file), `src/js/lib/storage.js` (`exportAll`/`importAll`),
`src/js/lib/tdconverter.js` (the importer's format sniffer). GPL; porting
the *format* is covered by the same "math, not the DOM" rule as the stats.
Not measured on a live csTimer — a real export file is wanted as a test
fixture (see §7) so the spec below is checked against a golden sample rather
than only against my reading of it.

**File = one JSON object.** Top level: `session1 … sessionN` (plain arrays)
plus a `properties` object.

```
sessionK: [ [[penalty, timeMs, …phaseSplits], scramble, comment, dateEpochSecs], … ]
properties: { sessionN: <int>,
              sessionData: "<JSON string of {1:{name, opt:{scrType, phases}, rank}, …}>" }
```

| Field | Rule |
|---|---|
| `val[0]` penalty | `0` = OK, `2000` = +2, `-1` = DNF — verified in three independent converters in `tdconverter.js` (BlockKeeper, TwistyTimer, DCTimer), all writing penalty at index 0 |
| `val[1]` time | **milliseconds**, raw and unpenalised → maps straight onto `Solve.timeMs` + `Solve.penalty` with no arithmetic |
| `val[2…]` | phase splits — we have no field for them; drop and count |
| index 1 / 2 | scramble / comment (empty string, not absent) |
| index 3 | date in **epoch seconds** → `createdAtMs = date * 1000` |
| `sessionData[i].opt.scrType` | csTimer's type id — *already* our id space (`333`, `444wca`, `pyrso`, …); validate against our 206-entry catalogue, fall back to the default |

**Import into csTimer is a restore, and it wipes its settings.**
`export.js:loadData()` does `if ('properties' in data) { localStorage.clear();
… }` before `storage.importAll(data)`; `importAll` then writes
`obj['session'+i]` for `i = 1…kernel.getProp('sessionN')` — so a missing
session key becomes empty rather than being left alone. Consequences:
`sessionN` **must** be present (else sessions past csTimer's current count are
dropped), and csTimer's own settings return to defaults (it shows a delta
confirmation first, and there is nothing we could put in `properties` to stop
it). Import *from* csTimer reads only, so it is the safe direction.

---

## 6. Milestones

Each milestone ends with a runnable app.

Blocks are ordered **what's next first**: the scheduled M7–M14 come before
the landed M0–M6 log, so the milestone to pick up is the first block after
the table.

| # | Deliverable | Done when |
|---|---|---|
| **M0** | Scaffold via `npx node-gtk create`; `core/timer.ts` state machine; hold-space timing with µs precision and key-repeat handling | App times accurately; Vitest green on the state machine |
| **M1** | Scramble worker (`worker_threads`) + prefetch queue + scramble panel + scramble-type selector | 206 types, zero UI freezes |
| **M2** | Record solves → `Gtk.ColumnView` → atomic JSON in XDG data dir, restart-safe; undo/delete | A usable timer |
| **M3** | Sessions: create/rename/switch/delete, per-session lists and stats, header dropdown | Multi-session works |
| **M4** | Statistics ported from csTimer rules (ao5/ao12/mo3 trimming, DNF-as-∞, PB target), penalties `+2`/`DNF`, WCA inspection with beeps, per-session scramble type | Feature-complete core |
| **M5** | Preferences dialog, full shortcut set, scramble image (Rsvg), dark-mode theming, empty states/toasts, polish | Something to use daily |
| **M6** | Adaptive layout: `Adw.Breakpoint`-driven drawer sidebar on narrow windows (retiring the "drawer is M5 polish" note), a header that adapts instead of truncating, sidebar width bounds that grow with large windows instead of pinning at 320, timer/scramble that use the space they get | The layout looks deliberate at every window size |
| **M7** | Size preferences: timer readout / scramble text / scramble diagram scales, applied by `layoutFor()` rather than beside it; the duplicated diagram caps unified | A size slider changes the live UI and the 360×360 floor still holds |
| **M8** | i18n: `core/i18n.ts` (`t()` + `Intl.PluralRules`), typed catalogs in `src/locales/`, `language` preference, sweep of every existing UI string | Switch to 中文, restart, and the UI reads Chinese |
| **M9** | csTimer JSON import/export: pure `core/csTimerFormat.ts` codec, `Gtk.FileDialog` open/save, `app.importData`/`app.exportData` with `<Ctrl+O>` / `<Ctrl+Shift+S>` | A csTimer file imports into new sessions and exports back out |
| **M10** | Records & statistics: PB history, σ/best/worst/range, ao50/ao100/ao1000, per-day activity, `Adw.ViewStack` tabs in the Statistics dialog, incremental sorted window | The Statistics dialog answers "when did I set that, and for how long?" |
| **M11** | Charts: distribution histogram + time trend, math in `core/`, `Gtk.DrawingArea` in `ui/` | Both charts render and track the session |
| **M12** | Release readiness: version from `package.json`, CHANGELOG, `Adw.AboutDialog` with the right licence and credits, AI-assistance disclosure, user-first README, icon, public name | `git tag v0.x.y` on a repo a stranger can clone and run |
| **M13** | Touch input: `Gtk.GestureClick` on the timer (same `keyDown`/`keyUp` calls as Space), long-press + swipe on the solve list, inspection's missing cancel button, and the 360×360 overlap | A solve starts with a finger and the floor layout stops overlapping |
| **M14** | Phone runtime evaluation: arm64 Node, node-gtk native binding, audio, input — a verdict, not a port | A written result: a scoped packaging milestone, or "not viable" |

**Post-MVP backlog:** stackmat (§1), then packaging if ever needed.

### M7 — scheduled (size preferences)

Small and self-contained — deliberately the first thing scheduled (user call,
2026-10-05). Decisions: three scales, applied by the tier (decision 14).

- **Fields** — three multipliers on `Preferences`, default `1`, each clamped
  in `normalizePreferences` with a test alongside it: `timerScale` (the
  readout, base 72/96/128 px per tier), `scrambleScale` (the scramble text,
  base 18 px), `diagramScale` (the picture, tier caps 440×150 → 560×190).
  Range 0.75–1.5 (the diagram 0.5–1.5), step 0.05, shown as `Adw.SpinRow`s in
  a new **Sizes** group on the Appearance page — the same row pattern as
  Hold time.
- **Plumbing** — `layoutFor(width, height, sizes)` applies them to its own
  outputs: timer px = base × `timerScale`; `scrambleChars` = base ÷
  `scrambleScale` (a bigger font fits fewer characters in the same width)
  with `scrambleMaxHeight` × `scrambleScale`; `diagramMax*` ×
  `diagramScale`. `src/core/layout.ts` keeps its "no threshold outside this
  file" rule intact — nothing in `src/ui/` learns a size.
- **Applying** — a size change rides the existing `applyPreferences()` path
  and re-runs `applyLayout()`, so the timer, the nudge and the diagram
  re-measure in one pass rather than one each.
- **CSS** — the readout is `.timer-display.size-s/m/l` at fixed px and GTK4
  CSS has no custom properties, so a changed scale re-`add()`s that sheet and
  drops the old one (`styles.add()` hands back a handle with `remove()`).
  Confirm swapping sheets live does not flicker.
- **Unify the diagram caps** — `scramblePanel.ts`'s `IMAGE_MAX_WIDTH/HEIGHT`
  and the tier's `diagramMaxWidth/Height` are the same numbers written twice
  today; one of them goes before a scale can make them disagree.
- **What must still hold:** the 360×360 floor, the drawer at ≤800, the
  selector row at ≤600 — none of them may acquire a size constant of its own.

**Checkpoint for the user:** at default scale, 360×360 still reports
`350x350` with no app warnings; then push each scale to an end and confirm at
900×540 that the digits read the size asked for and the diagram still clears
the timer.

### M8 — scheduled (i18n)

Order settled 2026-10-05: i18n goes **before every feature that adds
strings** (M9 and M10), so they are written translated instead of swept
afterwards.

- **Runtime** — `src/core/i18n.ts` (pure: no `gi:*`, no Node): `setLocale(tag)`,
  `t(key, params?)`, plurals via `Intl.PluralRules`, `formatCount()` and
  `formatDate()` wrappers. A module-level locale, not a translator object
  passed to every widget factory (decision 11).
- **Catalogs** — `src/locales/en.ts` (`as const`, source of truth) and
  `src/locales/zh-CN.ts` typed `Record<keyof typeof en, Message>` so the
  compiler lists every missing translation. Key style: dotted by area
  (`menu.*`, `prefs.*`, `stats.*`, `transfer.*`).
- **Preference** — `language: 'system' | 'en' | 'zh-CN'` on `Preferences`,
  validated in `normalizePreferences` with a test; default `system`, resolved
  once in `main.ts` (before anything builds UI) and passed to `setLocale`.
  Changing it → "restart to apply" toast.
- **Sweep** — every literal in `src/ui/*`, plus `src/main.ts`'s menus,
  toasts and tooltips, plus `src/ui/shortcuts.ts`. Scramble *group* names
  (44) get translated; the 209 type names stay English for now.
- **Timestamps stay as they are** — `formatTimestamp`/`formatFullTimestamp`
  are deliberately compact and numeric (already locale-neutral, and the list
  column is narrow); `Intl.DateTimeFormat` is used for the new PB-history
  dates in M10, where there is room.
- **Probe first** — does GTK's own "Open"/"Cancel" localise under node-gtk?
  node-gtk never calls `setlocale`/`bindtextdomain` (grepped, no matches), so
  stock widget strings may stay English regardless of our catalogs. If so,
  that is a documented limitation of a handful of labels, not a blocker.

**Checkpoint for the user:** switch Language to 中文, restart, read back the
sidebar app menu, the app-functions menu, Preferences and Statistics.

### M9 — scheduled (csTimer import/export)

- **Codec** — `src/core/csTimerFormat.ts`: `parse(text) → { sessions, warnings }`
  and `format(sessions) → text`, following §5's format table exactly.
  Round-trip tests are the point of the file.
- **Import mapping** — penalty `0/2000/−1 → absent/'plus2'/'dnf'`;
  `date × 1000`; the session's `scrType` applied to every solve (validated
  against the catalogue, else the default); names truncated to 40 and deduped
  by `SessionLibrary`; comments truncated to 500 (**`MAX_COMMENT_LENGTH`** —
  a longer one passes our parser but is then rejected by `isSolve` on the
  next load and would vanish silently); phase splits dropped and counted.
  Sessions ordered by `rank`, each created via `SessionLibrary.create()` and
  seeded straight into `Session` + `scheduleSave()`.
- **Export** — all sessions, `properties = { sessionN, sessionData }`, with
  the restore/settings caveat stated in the confirmation (decision 12).
- **UI** — `app.importData` / `app.exportData` on the app-functions menu,
  `<Ctrl+O>` / `<Ctrl+Shift+S>` (both free as of 2026-10-05; verify with
  `Gtk.acceleratorParse`), entries in `Adw.ShortcutsDialog`.
- **Probe first** — `Gtk.FileDialog.open/save` are typed
  (`node_modules/.node-gtk-types/Gtk-4.0.d.ts:25093`, `open`/`openFinish`,
  `save`/`saveFinish`) and `AsyncCallEnvironment` looks like exactly the
  machinery a GIO async callback needs, but no one here has called one.
  Fallback is `Gtk.FileChooserNative`.

**Checkpoint for the user:** import a csTimer file and watch the sessions
appear; export it back and open the result in csTimer.

### M10 — scheduled (records and statistics)

- **`core/stats.ts`** — add `ao50`, `ao100`, `ao1000` to `SPECS` (the trim
  rules stay csTimer's `[1,1]`), spread (σ over finite effective times,
  best/worst/range — cross-check csTimer's `timestat.js` while implementing),
  and the incremental sorted window of decision 13.
- **`core/records.ts`** (new) — `pbHistory(solves, kind)` →
  `{ value, setAtMs, solveId, heldUntilMs | null }[]`. Strict improvement
  only; DNF is ∞ so it can never be a record (and an all-DNF session is
  handled the way `bestWindow` already handles it); a window can improve
  without a new single, so both are tracked.
- **`core/activity.ts`** (new) — local-day buckets, current and longest
  streak, best day, rolling counts. Day boundaries come from `Date` getters
  (local time, no `gi:`/Node needed).
- **`ui/statsPanel.ts`** — `Adw.ViewStack` + `Adw.ViewSwitcher` tabs:
  Summary (today's table), Records, Activity. Charts tab arrives with M11.
- **`ui/statsStrip.ts`** and the list's ao5/ao12 columns are **unchanged** —
  the new windows are dialog-only.

**Checkpoint for the user:** the Records tab dates and "held for" figures
against what you remember of your own PBs.

### M11 — scheduled (charts)

- **Math in `core/`** — distribution bins and trend series, ported from
  csTimer's `src/js/stats/distribution.js` and `src/js/stats/trend.js`
  (GPL: port the math, attribute in the About dialog alongside the existing
  stats attribution).
- **Drawing in `ui/`** — `Gtk.DrawingArea` + a `draw`/`setDrawFunc` callback,
  Cairo line and path drawing only. **No Cairo text** (rule 6): axis labels
  are `Gtk.Label`/Pango overlays positioned by the widget layout.
- **Probe first** — `setDrawFunc` and a Cairo path under node-gtk have never
  been exercised here either.

### M12 — scheduled (release readiness)

Two halves. **A is decision-free and may be pulled forward at any time** —
it is what makes the release publishable; B is gated on the two open
decisions at the end of this block.

**A — versioning and disclosure**

- **One version, one place.** `package.json`'s `version` (SemVer, `0.x`
  while pre-1.0, one `git tag vX.Y.Z` per bump) becomes the source of truth.
  Today `src/main.ts` hardcodes `version: '0.1.0'` in the About dialog, so
  the first bump silently ships a wrong About page. Read it from
  `src/platform/meta.ts` via `fs` + `new URL('../../package.json',
  import.meta.url)` — `platform/` is the designated home for Node `fs`, and
  the module sits at the same depth under `src/` as under `dist/`, so one
  relative path serves both. The import-attribute option
  (`import pkg from '../package.json' with { type: 'json' }`) looks tidier
  but is ruled out by the current tsconfig: `resolveJsonModule` is off and
  `rootDir: "src"` would reject a file outside `src/`. Have `meta` carry
  `license` and the URLs too, so `package.json`, the README and the About
  dialog cannot drift apart.
- **CHANGELOG.md**, Keep a Changelog shape, one section per tag. The first
  section is `0.1.0` and describes what already exists; later milestones add
  theirs as they land.
- **`package.json`**: `description` is still the scaffold's ("An Adwaita
  application built with node-gtk."). `private: true` stays — a source
  release is a git tag and a repo, not an npm publish.
- **Fix the licence mismatch.** `package.json` and the README both say
  `GPL-3.0-or-later`; the About dialog passes `Gtk.License.GPL_3_0_ONLY`.
  The enum for "or later" is `Gtk.License.GPL_3_0` (typelib docs: *GNU
  General Public License, version 3.0 or later*).
- **About → `Adw.AboutDialog`.** `Adw.AboutWindow` carries
  `@deprecated Use AboutDialog` on this libadwaita (1.9.4); the comment in
  `main.ts` still says "works on 1.2+", which is why it was never revisited.
  `AboutDialog` is also what the rest of the app uses — Statistics,
  Preferences and the type picker are all dialogs, and About should not be
  the one different kind of toplevel. While there, fill in what the class
  already supports and the dialog leaves empty: `website`, `issueUrl`,
  `releaseNotes` + `releaseNotesVersion`, and `addAcknowledgementSection()`
  for csTimer / `cstimer_module` / node-gtk / GTK / libadwaita.
- **AI/LLM disclosure** (user call, 2026-10-05) — a plain statement in
  **both** places: a README section (*How this was written*) and one
  sentence in the About `comments`, so it is on the front page rather than
  behind a button. Shape: written with AI assistance (OpenCode), planned,
  reviewed and tested by a human — and it should say that the measurements
  in PLAN.md were actually run, since that is the claim a reader can check.
  Final wording is the user's to approve.
- **Decide whether the About dialog should publish the developer email** —
  it currently shows `Lu Xu <oliver_lew@outlook.com>`, which is a decision
  once the repo is public.

**B — gated on two open decisions**

- **Public name**, cheapest to most irreversible:
  - `APP_NAME` (`'csTimer GTK'`) is display only — window title, menus,
    sidebar, About. Free to change, any time.
  - `package.json.name` — free.
  - **App id** — `APP_ID = 'com.oliver.cstimergtk'` (note it already
    differs from the package name `cstimer-gtk`): it is the About
    `applicationIcon`, the `.desktop` filename and the `WM_CLASS`. Settle it
    *before* the first tag; afterwards changing it is a migration.
  - **XDG data dir — do not change.** `store.ts` hardcodes
    `APP_DIR = 'cstimer-gtk'` and the sessions live in
    `~/.local/share/cstimer-gtk`. Renaming the app must not silently repoint
    that at an empty directory: either leave it alone, or add a one-time
    migration that renames the old directory when the new one is absent.
- **Icon.** There is no artwork at all today — no SVG/PNG, no `.desktop`, no
  AppStream metainfo — and the About dialog already asks for
  `applicationIcon: APP_ID`, which resolves to nothing, so the About page
  shows the generic icon right now (drop the property until an icon exists,
  or point it at the chosen icon name). Deliverables once decided: a
  scalable SVG, `Gtk.IconTheme.add_search_path()` into the repo (a source
  checkout has no install prefix to drop hicolor icons into), a `.desktop`
  file with `Icon=`, and the icon name in `main.ts`. AppStream
  `metainfo.xml` belongs to packaging, which stays out of scope.

**Release checklist**

1. `npm run typecheck`, `npm test`, and the three probes
   (`scramble_probe`, `prefs_probe`, `breakpoint_probe`) all green.
2. README screenshots, taken by the user — AGENTS.md: the agent does not
   take screenshots; the nested-display recipe is in `tools/README.md`.
3. Version bumped, CHANGELOG section written, `git tag vX.Y.Z`.
4. `LICENSE`, README and About all read **GPL-3.0-or-later**.
5. Grep the tree for absolute paths, hostnames and anything else that is
   yours rather than the project's.
6. Confirm `.gitignore` keeps `node_modules/` (and the generated
   `node_modules/.node-gtk-types/`) out of the tag.

**Checkpoint for the user:** clone into a clean directory, read the README
as someone who has never seen the app, then run it and open About — name,
version, licence and credits should all be right, and the disclosure should
read the way you want it to.



### M13 — scheduled (touch input, and the narrow-window leftovers)

Desktop-verifiable with the harness that already exists — no touch device
needed (testing note below). The governing decision is 15: touch mirrors the
keyboard rather than becoming a second input model.

**A — touch**

- **The timer.** `Gtk.GestureClick` on the timer widget: press →
  `timer.keyDown(START_KEY, nowMs())`, release → `timer.keyUp(START_KEY,
  nowMs())` — the exact string `keyId()` produces for Space, so
  `core/timer.ts` is untouched. Mirror the keyboard path's two guards: a
  focused text entry owns the press (the check `key-pressed` already makes),
  and a press while `state === 'running'` stops the solve ahead of everything
  else (the `wasRunning` branch).
- **Mouse gets it too.** `GestureClick` reports pointer and touch alike, so
  click-and-hold on the timer would start a solve where today only Space
  does. Decision 15 says that is wanted — say so in the changelog rather
  than letting it arrive as a surprise.
- **Inspection has no way out without a keyboard.** Escape is the only
  cancel for the 15 s countdown and there is no button. Add a control that
  exists *only* while inspecting, calling `timer.keyDown('escape',
  nowMs())`.
- **The solve list** (`timesList.ts`):
  - `Gtk.GestureLongPress` on the `Gtk.ColumnView` → select the row under
    the finger and reveal the footer. Pointer multi-select is Shift/Ctrl-click,
    which a phone does not have.
  - While that mode is on, a plain tap toggles membership instead of
    replacing the selection — a flag in front of `Gtk.MultiSelection`, not a
    second selection model.
  - `Gtk.GestureSwipe` left → delete, straight into the existing
    `remove()` → undo toast → `restore()` path. No new deletion path.
- **Probe both risks before writing UI.** (1) Gesture competition: a
  `ColumnView` already owns click/selection gestures, and GTK gesture groups
  make a losing gesture *fail* rather than let both fire. (2) Swipe vs.
  kinetic scroll: it needs `|dx| ≫ |dy|` plus a travel threshold, or the
  scroll swallows every swipe. A `tools/*_probe` for each, before code.
- **Testing note:** XTEST already supplies this — button-down, sleep,
  button-up is a long-press; button-down plus motion is a swipe. No touch
  device, no portal, no screenshots. AGENTS.md's keybindings rule is about
  *driving* the app and keeps standing; it never said what input the app may
  accept.
- **Audit: every action needs a touch path.** Almost all have one already
  (footer Edit/Delete, every menu, the header toggles). The gaps:
  `Ctrl+1/2/3` grading has no button — it stays reachable through Edit →
  the penalty radios, which is enough — and Escape's jobs: closing dialogs
  and the drawer both have visible equivalents already, inspection does not.

**B — the narrow window still owes one fix**

- **360×360 overlap.** §7 records that the fixed 150 px diagram still sits
  on the timer at the floor, because the nudge clamp cannot make enough
  vertical room — the short-window overlay limit. The fix belongs in the
  tier (the smallest tier sheds or shrinks the diagram) and, per decision 14,
  must arrive **through `layoutFor()`**, never as a constant in `src/ui/`.
  It has to compose with M7's `diagramScale`, so do this *after* M7.
- **Re-check the startup-only `AdwToastOverlay exceeds …` warning.** Its
  stated cause (a first frame measuring the selectors before any tier ran)
  went away with `headerSlack` on 2026-10-04 — so either it is gone and the
  note closes, or it is something else and now has a name.
- **Dialog audit at the floor, both orientations:** Statistics, the type
  picker, the keyboard reference, rename/delete, and the edit dialog at
  **360×360** (portrait phone) and **640×360** (landscape phone — tier B
  drawer, timer `s`, `scrambleMaxHeight` 100).

**Checkpoint for the user:** click-and-hold the timer and release to start,
with no keyboard anywhere near it; swipe a row to delete and undo from the
toast; then resize to 360×360 and confirm the diagram is off the digits.

### M14 — scheduled (phone runtime — an evaluation, not a port)

A decision gate. Nothing here may change the architecture on its own.

- **The four questions.** Is there an arm64 Node ≥ 20.6 that runs `tsx` +
  `node-gtk`; does node-gtk's native binding build against the phone's GTK 4
  / libadwaita typelibs (it ships prebuilds for desktop Node majors only);
  does audio find a path (`pw-play` → `paplay` → `gst` → `aplay`, all
  desktop assumptions in `platform/audio.ts`); and how much of `tools/`
  survives when the target is Wayland with no Xephyr and no XTEST.
- **Not in scope here:** packaging itself, AppStream metainfo, a Flatpak
  manifest. Those become a milestone only if this reports yes.
- **Deliverable:** a written verdict in §6 with a *scoped* packaging
  milestone attached, or a documented "not viable" that lets the packaging
  line in §1 stay closed.

**Checkpoint for the user:** the verdict.

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
- **A just-revealed bottom bar may report 0.** Since 2026-10-04 the selector
  lives in `Adw.ToolbarView`'s bottom-bar slot. On the frame it is revealed,
  `getBottomBarHeight()` can still be 0; `updateNudge` therefore floors that
  animated height at the selector bar's natural height. During a hide, it uses
  the actual animated height down to 0. This is the ToolbarView equivalent of
  the old “just-reparented ListBox row reports 0” workaround above.

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
- **M7–M14 scheduled 2026-10-05** — size preferences → i18n → csTimer
  import/export → records & statistics → charts → release readiness → touch
  input → the phone-runtime verdict, in that order (the scope block in §1,
  the dated blocks in §6). M7 is deliberately
  first: three size scales, self-contained. Three decisions settle most of
  the "how": sizes **scale** `layoutFor()` instead of replacing its tiers
  (decision 14), i18n comes before every feature that adds strings so M9's
  and M10's are written translated rather than swept later (decision 11), and
  csTimer compatibility is one pure codec plus the two
  `properties`/`sessionN` findings in §5 (decision 12). Open before M9: a
  sanitized real csTimer export file would be the golden fixture — without
  one, the codec is only tested against my reading of csTimer's source.
  Open before M12: the **public name** and the **icon**, each recorded with
  what it costs in the M12 block — its first half (versioning, CHANGELOG,
  About, README, the AI disclosure) needs neither and may be pulled forward.
  Open before M7 and M8: nothing. Probes that gate M9, M11 and M13
  (`Gtk.FileDialog` async callbacks, `Gtk.DrawingArea.setDrawFunc`, gesture
  competition on the `ColumnView`, and swipe vs. kinetic scroll) are called
  out at the top of their milestone blocks. **Ordering caveat:** M13 (touch)
  lands after M12 (the release) by arrival order, not by dependency — if the
  first public tag should work without a keyboard, swap them.
- **M6 landed 2026-10-02** — adaptive layout is in and verified (the dated
  block in §6 has the decisions and the measurements). What a cold session
  needs to know: `src/core/layout.ts` owns every threshold, the sidebar's
  `show-sidebar` is a plain libadwaita binding (do not add intent memory
  back), and sizes are read from the *surface* because widgets lag a pass
  behind during a resize. `npm test` = **219 tests**; the manual band walk
  (keyboard, Xephyr `:99`) is in `tools/README.md` → Recipes.
  **Next milestone: M7 (size preferences)** — see the bullet above. The older
  "M7+ should be picked, not assumed" note now applies only beyond M14: M7–M14
  are scheduled above. The still-unscheduled backlog beyond M14 is stackmat,
  and packaging only if M14 reports yes (§1).
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
- **Narrow selector: ToolbarView bottom bar (user call, 2026-10-04)** — below
  600 the header's ellipsizing type button moves into `Adw.ToolbarView`'s
  **bottom toolbar**, full-width with the chevron at the right. `ToolbarView`
  owns the page structure: header in its top-bar slot, scramble/timer in its
  content slot, and a `.toolbar` `Gtk.Box` in its bottom-bar slot. The same
  button widget is reparented between the top and bottom bars; it expands only
  in the bottom bar, so the header's window controls are unaffected.
  `ToolbarView` supplies native flat-bar styling; its animated bottom-bar
  height is what `updateNudge` subtracts from the timer region and adds to the
  diagram's bottom clearance. The button itself owns activation, so the old
  `Gtk.ListBox` row-activated/key-controller workaround is gone. Both layouts
  open the same `Adw.Dialog`, whose body is an **`Adw.NavigationSplitView`**
  used natively (user call, 2026-10-05). Each `Adw.NavigationPage` carries its
  own `Adw.ToolbarView` + `Adw.HeaderBar`, so the split view itself provides
  the page titles and — collapsed — the back button (a real `AdwBackButton`,
  confirmed in the widget tree). Collapse is an **`Adw.Breakpoint`**
  (`max-width: 600px`) applied to `collapsed` via the breakpoint's
  apply/unapply signals (node-gtk can't box the GValue `addSetter` needs). The
  dialog is given only a default `contentWidth`/`contentHeight` (720×480) and
  clamps itself to the parent window — there is no parent-surface listener and
  no manual `contentWidth` chasing, so the switch follows the dialog's
  allocated width. (A breakpoint-bearing dialog also needs an explicit
  `width-request`/`height-request` minimum — AdwDialog docs — or it logs
  "does not have a minimum size" warnings.) The category list is built once;
  the type list is filtered in place to the browsed category with
  `Gtk.ListBox.setFilterFunc` — never rebuilt. Selecting a category updates
  the type filter and, collapsed, pushes to the content page
  (`showContent = true`); the split view's back button pops it. The active
  type carries a ✓ suffix (`object-select-symbolic`). There is no search
  entry (dropped 2026-10-05 — it was the messy part), and type rows show just
  the type name: the category is the selected row on the left and the content
  page's title, so prefixing it per-row was redundant. Navigation, selection
  and activation are the widgets' own. (Lesson — see
  AGENTS.md "Let adaptive widgets do their job": an earlier ~600-line version
  hand-rolled the collapse, back button, titles and per-state list rebuilds
  that this widget provides; the native rewrite is ~300 lines.)
  `AdwActionRow` titles are parsed as *markup*, so `useMarkup: false` (else
  `3x3x3 Roux - LSE <M, U>` logs a parse warning). Layout consequences: the
  bottom bar's animated slot height is subtracted from the timer region and
  added to the diagram clearance in `updateNudge`.
  Also: the first frame now takes its tier from the *asked-for* size
  before `present()`, because with `lsll` selected the old order asked **928px
  in an 890px window** on frame one (0 warnings since).
- **Window floor: 360 wide (user call, 2026-10-03)** — the GNOME HIG's
  minimum for the phone form factor (developer.gnome.org/hig/guidelines/
  adaptive.html); 400 was this project's own number, and the comment that
  justified it (the two dropdowns wanting ~282px) died with them. Height
  stays 360, so the floor is square, and the width now equals libadwaita's
  own `AdwWindow` default (360×200) — `minHeight` still performs the
  override the breakpoint docs ask for. The original floor measurements were
  with the `Adw.ButtonRow`; since 2026-10-04 it is the shared `Gtk.Button` in
  `ToolbarView`'s bottom bar. Reverified: **360×360 → `350x350 (win 350)`,
  drawer, selectors in their own row, timer s, WM minimum 360×360, no app
  warnings**; phone shape **360×640 → `350x630`**, full-width toolbar button
  at the bottom, timer and picture clear of the bar. At square 360×360 the
  fixed 150px diagram still overlaps the timer — the existing nudge clamp
  cannot create enough vertical room there; this is the short-window overlay
  limit, not a ToolbarView bar overlap. The `390x350` above is the old floor's
  number, kept for what it proved.
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
